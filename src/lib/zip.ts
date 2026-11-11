import { Readable } from 'node:stream';
import { crc32, createDeflateRaw } from 'node:zlib';

/**
 * A zip archive written as it is read, for downloads too large to hold.
 *
 * Entries are taken one at a time and each entry's data is consumed before the
 * next is asked for, so the caller can produce the archive lazily and nothing
 * is buffered beyond one chunk. Sizes are not known when an entry starts, so
 * each carries a data descriptor after its data (general purpose bit 3), which
 * every mainstream reader supports.
 *
 * ZIP64 is used for the archive itself (offsets and entry counts) as soon as
 * it is needed, so an archive may pass 4 GB. A single entry may not: its sizes
 * are written in 32-bit fields because the local header had to be sent before
 * they were known, and nothing written here comes near that.
 */

export type ZipEntry = {
  /** Path inside the archive, forward slashes, no leading slash. */
  name: string;
  data: string | Uint8Array | AsyncIterable<Uint8Array>;
  /** Deflate the data. Off for files that are already compressed. */
  compress: boolean;
  modifiedAt?: Date;
};

const MAX_32 = 0xffffffff;
const MAX_16 = 0xffff;
/** Data descriptor follows, and the name is UTF-8. */
const FLAGS = 0x0008 | 0x0800;
const UNIX_FILE = 0o100644 << 16;

type Written = {
  name: Buffer;
  method: number;
  time: number;
  date: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
};

export async function* zip(
  entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>
): AsyncGenerator<Uint8Array> {
  const written: Written[] = [];
  let offset = 0;

  for await (const entry of entries) {
    assertSafeName(entry.name);
    const name = Buffer.from(entry.name, 'utf8');
    const method = entry.compress ? 8 : 0;
    const { time, date } = dosDateTime(entry.modifiedAt ?? new Date());

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(FLAGS, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    // crc and sizes stay zero: they follow the data in the descriptor.
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const entryOffset = offset;
    yield local;
    yield name;
    offset += local.length + name.length;

    let crc = 0;
    let size = 0;
    let compressedSize = 0;
    const raw = chunks(entry.data);
    const counted = (async function* () {
      for await (const chunk of raw) {
        crc = crc32(chunk, crc);
        size += chunk.length;
        yield chunk;
      }
    })();
    for await (const chunk of entry.compress ? deflate(counted) : counted) {
      compressedSize += chunk.length;
      yield chunk;
    }
    offset += compressedSize;

    if (size > MAX_32 || compressedSize > MAX_32) {
      throw new Error(`${entry.name} is larger than a single entry may be`);
    }

    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc >>> 0, 4);
    descriptor.writeUInt32LE(compressedSize, 8);
    descriptor.writeUInt32LE(size, 12);
    yield descriptor;
    offset += descriptor.length;

    written.push({
      name,
      method,
      time,
      date,
      crc: crc >>> 0,
      compressedSize,
      size,
      offset: entryOffset
    });
  }

  const directoryOffset = offset;
  for (const w of written) {
    const header = centralHeader(w);
    yield header;
    offset += header.length;
  }
  const directorySize = offset - directoryOffset;

  const needs64 =
    written.length > MAX_16 ||
    directoryOffset > MAX_32 ||
    directorySize > MAX_32;
  if (needs64) {
    yield zip64End(written.length, directorySize, directoryOffset, offset);
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  const count = needs64 ? MAX_16 : written.length;
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(needs64 ? MAX_32 : directorySize, 12);
  end.writeUInt32LE(needs64 ? MAX_32 : directoryOffset, 16);
  yield end;
}

function centralHeader(w: Written): Buffer {
  const offset64 = w.offset > MAX_32;
  const extra = Buffer.alloc(offset64 ? 12 : 0);
  if (offset64) {
    extra.writeUInt16LE(0x0001, 0);
    extra.writeUInt16LE(8, 2);
    extra.writeBigUInt64LE(BigInt(w.offset), 4);
  }
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  // Made by: Unix, spec 4.5, so readers apply the file mode below.
  header.writeUInt16LE((3 << 8) | 45, 4);
  header.writeUInt16LE(offset64 ? 45 : 20, 6);
  header.writeUInt16LE(FLAGS, 8);
  header.writeUInt16LE(w.method, 10);
  header.writeUInt16LE(w.time, 12);
  header.writeUInt16LE(w.date, 14);
  header.writeUInt32LE(w.crc, 16);
  header.writeUInt32LE(w.compressedSize, 20);
  header.writeUInt32LE(w.size, 24);
  header.writeUInt16LE(w.name.length, 28);
  header.writeUInt16LE(extra.length, 30);
  header.writeUInt32LE(UNIX_FILE >>> 0, 38);
  header.writeUInt32LE(offset64 ? MAX_32 : w.offset, 42);
  return Buffer.concat([header, w.name, extra]);
}

function zip64End(
  count: number,
  directorySize: number,
  directoryOffset: number,
  recordOffset: number
): Buffer {
  const record = Buffer.alloc(56);
  record.writeUInt32LE(0x06064b50, 0);
  record.writeBigUInt64LE(BigInt(44), 4);
  record.writeUInt16LE((3 << 8) | 45, 12);
  record.writeUInt16LE(45, 14);
  record.writeBigUInt64LE(BigInt(count), 24);
  record.writeBigUInt64LE(BigInt(count), 32);
  record.writeBigUInt64LE(BigInt(directorySize), 40);
  record.writeBigUInt64LE(BigInt(directoryOffset), 48);

  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(recordOffset), 8);
  locator.writeUInt32LE(1, 16);
  return Buffer.concat([record, locator]);
}

async function* chunks(data: ZipEntry['data']): AsyncGenerator<Uint8Array> {
  if (typeof data === 'string') {
    yield Buffer.from(data, 'utf8');
  } else if (data instanceof Uint8Array) {
    yield data;
  } else {
    for await (const chunk of data) {
      if (chunk.length > 0) yield chunk;
    }
  }
}

async function* deflate(
  source: AsyncIterable<Uint8Array>
): AsyncGenerator<Uint8Array> {
  const input = Readable.from(source, { objectMode: false });
  const deflater = createDeflateRaw();
  input.on('error', (error) => deflater.destroy(error));
  input.pipe(deflater);
  for await (const chunk of deflater) yield chunk as Buffer;
}

/** Zip stores local wall-clock time; UTC is the honest choice for a server. */
function dosDateTime(at: Date): { time: number; date: number } {
  const year = Math.max(at.getUTCFullYear(), 1980);
  return {
    time:
      (at.getUTCHours() << 11) |
      (at.getUTCMinutes() << 5) |
      Math.floor(at.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate()
  };
}

function assertSafeName(name: string) {
  if (
    name.length === 0 ||
    name.startsWith('/') ||
    name.includes('\\') ||
    name.split('/').some((part) => part === '..' || part === '')
  ) {
    throw new Error(`Unsafe path in archive: ${name}`);
  }
}
