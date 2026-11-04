import assert from 'node:assert/strict';
import { createServer, type AddressInfo } from 'node:net';
import { describe, it } from 'node:test';

import {
  scanBuffer,
  scannerConfig,
  ScannerUnavailable,
  scanningEnabled
} from '@/lib/documents/scan';

import { EICAR, fakeClamd } from './fixtures/fake-clamd';

/**
 * The clamd client, against a stand-in daemon on a local port. Each way an
 * answer can come back, and each way it can fail to.
 */
const config = (port: number, timeoutMs = 2_000) => ({
  host: '127.0.0.1',
  port,
  timeoutMs
});

describe('whether scanning is on', () => {
  it('is off unless a host is given', () => {
    assert.equal(scanningEnabled({}), false);
    assert.equal(scanningEnabled({ CLAMAV_HOST: '  ' }), false);
    assert.equal(scannerConfig({}), null);
  });

  it("defaults to clamd's port", () => {
    assert.equal(
      scannerConfig({ CLAMAV_HOST: 'clamav.railway.internal' })?.port,
      3310
    );
    assert.equal(
      scannerConfig({ CLAMAV_HOST: 'clamav', CLAMAV_PORT: '3311' })?.port,
      3311
    );
    assert.equal(
      scannerConfig({ CLAMAV_HOST: 'clamav', CLAMAV_PORT: 'nonsense' })?.port,
      3310
    );
  });
});

describe('scanning a file', () => {
  it('reports a clean file, with the engine and signature version', async () => {
    const clamd = await fakeClamd();
    try {
      const verdict = await scanBuffer(
        Buffer.from('%PDF-1.7\nan ordinary agreement\n'),
        config(clamd.port)
      );
      assert.deepEqual(verdict, {
        outcome: 'clean',
        scanner: 'ClamAV 1.4.1/27450'
      });
    } finally {
      await clamd.close();
    }
  });

  it('names the signature it found', async () => {
    const clamd = await fakeClamd();
    try {
      const verdict = await scanBuffer(Buffer.from(EICAR), config(clamd.port));
      assert.deepEqual(verdict, {
        outcome: 'infected',
        signature: 'Eicar-Test-Signature',
        scanner: 'ClamAV 1.4.1/27450'
      });
    } finally {
      await clamd.close();
    }
  });

  it('streams a file larger than one chunk whole', async () => {
    // The marker sits past the first 64KB chunk, so it is found only if every
    // chunk arrives.
    const clamd = await fakeClamd();
    try {
      const big = Buffer.concat([
        Buffer.alloc(200 * 1024, 0x41),
        Buffer.from(EICAR)
      ]);
      const verdict = await scanBuffer(big, config(clamd.port));
      assert.equal(verdict.outcome, 'infected');
    } finally {
      await clamd.close();
    }
  });

  it('treats an ERROR reply as no answer, never as clean', async () => {
    const clamd = await fakeClamd('error');
    try {
      await assert.rejects(
        scanBuffer(Buffer.from('anything'), config(clamd.port)),
        (e: unknown) => e instanceof ScannerUnavailable && e.reason === 'error'
      );
    } finally {
      await clamd.close();
    }
  });

  it('gives up on a daemon that stops answering', async () => {
    const clamd = await fakeClamd('silent');
    try {
      const started = Date.now();
      await assert.rejects(
        scanBuffer(Buffer.from('anything'), config(clamd.port, 300)),
        (e: unknown) =>
          e instanceof ScannerUnavailable && e.reason === 'timeout'
      );
      assert.ok(Date.now() - started < 2_000, 'the timeout should be honoured');
    } finally {
      await clamd.close();
    }
  });

  it('reports a daemon that is not there as unreachable', async () => {
    // A port that was just free: listen, note it, close.
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    await assert.rejects(
      scanBuffer(Buffer.from('anything'), config(port)),
      (e: unknown) =>
        e instanceof ScannerUnavailable && e.reason === 'unreachable'
    );
  });

  it('reports a connection dropped without an answer as an error', async () => {
    const rude = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) => rude.listen(0, '127.0.0.1', resolve));
    try {
      await assert.rejects(
        scanBuffer(
          Buffer.from('anything'),
          config((rude.address() as AddressInfo).port)
        ),
        ScannerUnavailable
      );
    } finally {
      await new Promise<void>((resolve) => rude.close(() => resolve()));
    }
  });
});
