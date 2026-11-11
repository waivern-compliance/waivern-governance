import { inflateRawSync } from 'node:zlib';

/**
 * Read a whole zip into memory, for tests: path to contents.
 *
 * Deliberately independent of the writer in `src/lib/zip.ts`, reading the
 * central directory as any other unzip program would, so a test passing means
 * the archive is readable rather than that the writer agrees with itself.
 */
export function unzip(archive: Buffer): Map<string, Buffer> {
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('No end of central directory');
  let count = archive.readUInt16LE(end + 10);
  let offset = archive.readUInt32LE(end + 16);
  if (count === 0xffff || offset === 0xffffffff) {
    const record = Number(archive.readBigUInt64LE(end - 20 + 8));
    count = Number(archive.readBigUInt64LE(record + 32));
    offset = Number(archive.readBigUInt64LE(record + 48));
  }

  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('Bad central directory header');
    }
    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    let local = archive.readUInt32LE(offset + 42);
    const name = archive.toString(
      'utf8',
      offset + 46,
      offset + 46 + nameLength
    );
    if (local === 0xffffffff) {
      local = Number(archive.readBigUInt64LE(offset + 46 + nameLength + 4));
    }
    const dataStart =
      local +
      30 +
      archive.readUInt16LE(local + 26) +
      archive.readUInt16LE(local + 28);
    const data = archive.subarray(dataStart, dataStart + compressedSize);
    files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
