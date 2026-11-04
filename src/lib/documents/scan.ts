import { connect } from 'node:net';

import { log } from '@/lib/log';

/**
 * Virus scanning, by a ClamAV daemon this deployment runs itself.
 *
 * Self-hosted rather than a scanning API, because the files are signed
 * contracts and forensic reports, and sending each one to somebody else's
 * service to be checked would be a disclosure of its own. clamd sits on the
 * deployment's private network and the bytes never leave it.
 *
 * Off unless `CLAMAV_HOST` is set, so development, the tests and anybody
 * running their own copy without a scanner carry on as before — and the
 * security page says files are not scanned. Once it is set, it is relied on:
 * a scanner that cannot be reached refuses the upload (fail closed) rather
 * than letting an unchecked file through because a container restarted.
 *
 * Speaks clamd's INSTREAM command directly over TCP. It is a dozen lines of
 * protocol, and a client library would be a dependency for the sake of them.
 * Logged by shape only: sizes, durations, outcomes — never a filename, and a
 * signature only in the audit trail, where the organisation can see it.
 */

const DEFAULT_PORT = 3310;
/** A 10MB file scans in well under a second; this is for a daemon that has stopped answering. */
const TIMEOUT_MS = 30_000;
/** clamd reads a stream in chunks; its own default buffer is the same size. */
const CHUNK = 64 * 1024;

export type ScannerConfig = { host: string; port: number; timeoutMs: number };

export function scannerConfig(
  env: Record<string, string | undefined> = process.env
): ScannerConfig | null {
  const host = env.CLAMAV_HOST?.trim();
  if (!host) return null;
  const port = Number(env.CLAMAV_PORT?.trim() || DEFAULT_PORT);
  return {
    host,
    port: Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT,
    timeoutMs: TIMEOUT_MS
  };
}

/** Whether uploads are scanned on this deployment. What the security page asks. */
export function scanningEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return scannerConfig(env) !== null;
}

export type ScanVerdict =
  | { outcome: 'clean'; scanner: string }
  | { outcome: 'infected'; signature: string; scanner: string };

/** The scanner could not give an answer. Treated as "not checked", never as "clean". */
export class ScannerUnavailable extends Error {
  constructor(public readonly reason: 'unreachable' | 'timeout' | 'error') {
    super(`Virus scanner ${reason}`);
    this.name = 'ScannerUnavailable';
  }
}

/**
 * One request to clamd, answered by one NUL-terminated reply.
 *
 * The `z` prefix asks for NUL-terminated replies, so the end of the answer is
 * unambiguous whatever the reply contains.
 */
function request(config: ScannerConfig, frames: Buffer[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: config.host, port: config.port });
    const received: Buffer[] = [];
    let settled = false;
    const finish = (error: ScannerUnavailable | null, reply?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(reply!);
    };
    const timer = setTimeout(
      () => finish(new ScannerUnavailable('timeout')),
      config.timeoutMs
    );

    socket.on('connect', () => {
      for (const frame of frames) socket.write(frame);
    });
    socket.on('data', (chunk) => {
      received.push(chunk);
      const all = Buffer.concat(received);
      const end = all.indexOf(0);
      if (end >= 0) finish(null, all.subarray(0, end).toString('utf8').trim());
    });
    socket.on('error', (cause: NodeJS.ErrnoException) => {
      const refused = [
        'ECONNREFUSED',
        'ENOTFOUND',
        'EAI_AGAIN',
        'EHOSTUNREACH',
        'ENETUNREACH'
      ];
      finish(
        new ScannerUnavailable(
          refused.includes(cause.code ?? '') ? 'unreachable' : 'error'
        )
      );
    });
    socket.on('close', () => finish(new ScannerUnavailable('error')));
  });
}

/** INSTREAM framing: each chunk led by its length, big-endian, then a zero length to end. */
function instream(content: Buffer): Buffer[] {
  const frames: Buffer[] = [Buffer.from('zINSTREAM\0')];
  for (let at = 0; at < content.byteLength; at += CHUNK) {
    const chunk = content.subarray(at, at + CHUNK);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(chunk.byteLength);
    frames.push(length, chunk);
  }
  frames.push(Buffer.alloc(4));
  return frames;
}

/**
 * The engine and signature database, e.g. "ClamAV 1.4.1/27450".
 *
 * Recorded against each file, so "scanned" can be read later as "scanned
 * against signatures as of then" — a file clean on Monday's database may not
 * be on Friday's.
 */
async function scannerVersion(config: ScannerConfig): Promise<string> {
  const reply = await request(config, [Buffer.from('zVERSION\0')]);
  return reply.split('/').slice(0, 2).join('/').slice(0, 100);
}

/**
 * Scan one file. Throws `ScannerUnavailable` when there is no answer; the
 * caller decides what that means (an upload is refused, the sweep tries later).
 */
export async function scanBuffer(
  content: Buffer,
  config: ScannerConfig | null = scannerConfig()
): Promise<ScanVerdict> {
  if (!config) throw new Error('Scanning is not configured');
  const started = Date.now();
  try {
    const [reply, scanner] = await Promise.all([
      request(config, instream(content)),
      scannerVersion(config)
    ]);

    // "stream: OK", "stream: <signature> FOUND", or "<message> ERROR".
    const found = /^stream: (.+) FOUND$/.exec(reply);
    if (found) {
      log('warn', 'scan.infected', {
        bytes: content.byteLength,
        ms: Date.now() - started
      });
      return {
        outcome: 'infected',
        signature: found[1].slice(0, 200),
        scanner
      };
    }
    if (reply === 'stream: OK') {
      log('info', 'scan.clean', {
        bytes: content.byteLength,
        ms: Date.now() - started
      });
      return { outcome: 'clean', scanner };
    }
    throw new ScannerUnavailable('error');
  } catch (cause) {
    const reason = cause instanceof ScannerUnavailable ? cause.reason : 'error';
    log('error', 'scan.failed', {
      reason,
      bytes: content.byteLength,
      ms: Date.now() - started
    });
    throw cause instanceof ScannerUnavailable
      ? cause
      : new ScannerUnavailable('error');
  }
}
