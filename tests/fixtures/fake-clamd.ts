import {
  createServer,
  type AddressInfo,
  type Server,
  type Socket
} from 'node:net';

/**
 * A stand-in for clamd, speaking just enough of its protocol to test against:
 * zVERSION, and zINSTREAM with its length-prefixed chunks.
 *
 * `behaviour` decides the answer to a scan: "detect" reports FOUND for any
 * stream containing the EICAR marker and OK otherwise; "error" answers as clamd
 * does when it cannot scan; "silent" reads everything and never answers.
 */
export type FakeClamd = {
  port: number;
  scans: number;
  close: () => Promise<void>;
};

export const EICAR =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export async function fakeClamd(
  behaviour: 'detect' | 'error' | 'silent' = 'detect'
): Promise<FakeClamd> {
  const state = { scans: 0 };
  const open = new Set<Socket>();
  const server: Server = createServer((socket) => {
    open.add(socket);
    socket.on('close', () => open.delete(socket));
    let buffer = Buffer.alloc(0);
    let command: string | null = null;
    const streamed: Buffer[] = [];

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (command === null) {
        const end = buffer.indexOf(0);
        if (end < 0) return;
        command = buffer.subarray(0, end).toString();
        buffer = buffer.subarray(end + 1);
        if (command === 'zVERSION') {
          socket.end('ClamAV 1.4.1/27450/Mon Nov  2 09:00:00 2026\0');
          return;
        }
      }
      if (command !== 'zINSTREAM') return;
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);
        if (length === 0) {
          state.scans += 1;
          const content = Buffer.concat(streamed).toString('latin1');
          if (behaviour === 'silent') return;
          if (behaviour === 'error')
            socket.end('INSTREAM size limit exceeded. ERROR\0');
          else if (content.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'))
            socket.end('stream: Eicar-Test-Signature FOUND\0');
          else socket.end('stream: OK\0');
          return;
        }
        if (buffer.length < 4 + length) return;
        streamed.push(buffer.subarray(4, 4 + length));
        buffer = buffer.subarray(4 + length);
      }
    });
    socket.on('error', () => {});
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    get scans() {
      return state.scans;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        // Drop any connection a "silent" scan left open.
        for (const socket of open) socket.destroy();
      })
  };
}
