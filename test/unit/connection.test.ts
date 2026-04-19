import { strict as assert } from 'node:assert';
import { createServer, Server, Socket } from 'node:net';
import { describe, it, afterEach, beforeEach } from 'node:test';
import {
  encodeArmedPartitionsReallyCommand,
  encodeNewDataCommand,
  ArmedPartitionsReallyAnswer,
  NewDataAnswer,
} from 'satel-integra-integration-protocol';
import { SatelConnection } from '../../src/satel/connection';

type LogFn = (...args: unknown[]) => void;
const silentLog = {
  info: (() => { /* noop */ }) as LogFn,
  warn: (() => { /* noop */ }) as LogFn,
  error: (() => { /* noop */ }) as LogFn,
  debug: (() => { /* noop */ }) as LogFn,
  log: (() => { /* noop */ }) as LogFn,
  success: (() => { /* noop */ }) as LogFn,
} as any;

interface Harness {
  server: Server;
  port: number;
  sockets: Socket[];
  latest(): Socket | undefined;
}

async function startServer(onConnect?: (s: Socket) => void): Promise<Harness> {
  const sockets: Socket[] = [];
  const server = createServer((s) => {
    sockets.push(s);
    onConnect?.(s);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (typeof addr !== 'object' || addr === null) throw new Error('no address');
  return { server, port: addr.port, sockets, latest: () => sockets.at(-1) };
}

function stopServer(h: Harness): Promise<void> {
  for (const s of h.sockets) s.destroy();
  return new Promise((resolve) => h.server.close(() => resolve()));
}

function waitFor(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('SatelConnection', () => {
  let h: Harness;

  beforeEach(async () => {
    h = await startServer();
  });

  afterEach(async () => {
    await stopServer(h);
  });

  it('sends a command and resolves with the decoded response', async () => {
    const echoed: Buffer[] = [];
    h.server.on('connection', (s) => {
      s.on('data', (buf) => {
        echoed.push(buf);
        // Respond with a fabricated ArmedPartitionsReally "4 zero bytes" frame.
        const reply = buildArmedPartitionsReallyAllZeros();
        s.write(reply);
      });
    });

    const conn = new SatelConnection({ host: '127.0.0.1', port: h.port, log: silentLog });
    conn.connect();
    await once(conn, 'connected');

    const req = encodeArmedPartitionsReallyCommand();
    const reply = await conn.sendCommand(req);

    assert.ok(reply instanceof ArmedPartitionsReallyAnswer);
    assert.deepEqual(echoed[0], req);
    conn.close();
  });

  it('serialises commands: second waits for first response', async () => {
    let received = 0;
    let firstSocket: Socket | undefined;
    h.server.on('connection', (s) => {
      firstSocket = s;
      s.on('data', () => {
        received += 1;
        // Delay the reply so we can assert sequencing.
        setTimeout(() => s.write(buildArmedPartitionsReallyAllZeros()), 30);
      });
    });

    const conn = new SatelConnection({ host: '127.0.0.1', port: h.port, log: silentLog });
    conn.connect();
    await once(conn, 'connected');

    const req = encodeArmedPartitionsReallyCommand();
    const p1 = conn.sendCommand(req);
    const p2 = conn.sendCommand(req);

    // Wait a tick: only the first should have been written.
    await waitFor(10);
    assert.equal(received, 1);
    await p1;
    await waitFor(10);
    assert.equal(received, 2);
    await p2;

    assert.ok(firstSocket);
    conn.close();
  });

  it('times out when the server is silent and rejects the command', async () => {
    // Server accepts connection but never responds.
    const conn = new SatelConnection({
      host: '127.0.0.1',
      port: h.port,
      log: silentLog,
      commandTimeoutMs: 50,
      reconnectMinMs: 100_000,
      reconnectMaxMs: 100_000,
    });
    conn.connect();
    await once(conn, 'connected');

    const req = encodeNewDataCommand();
    await assert.rejects(conn.sendCommand(req), /timeout/i);
    conn.close();
  });

  it('reconnects after the server drops the socket', async () => {
    const conn = new SatelConnection({
      host: '127.0.0.1',
      port: h.port,
      log: silentLog,
      reconnectMinMs: 20,
      reconnectMaxMs: 100,
    });
    let connects = 0;
    conn.on('connected', () => { connects += 1; });

    conn.connect();
    await once(conn, 'connected');
    assert.equal(connects, 1);

    // Kill the client-side socket on the server.
    h.sockets[0]?.destroy();

    await once(conn, 'connected');
    assert.equal(connects, 2);

    conn.close();
  });
});

function once(ee: SatelConnection, event: 'connected' | 'disconnected'): Promise<void> {
  return new Promise((resolve) => {
    const handler = () => {
      ee.off(event, handler);
      resolve();
    };
    ee.on(event, handler);
  });
}

function buildArmedPartitionsReallyAllZeros(): Buffer {
  // Construct a valid response frame: 0x0A + 4 zero bytes + CRC + framing.
  // Mirror what the library does internally so the test doesn't depend on
  // having an encodeAnswer helper.
  const Encoder = require('satel-integra-integration-protocol/encoder') as {
    new (): { addByte: (b: number) => void; addBytes: (b: Buffer) => void; frame: () => Buffer };
  };
  const enc = new Encoder();
  enc.addByte(0x0a);
  enc.addBytes(Buffer.from([0, 0, 0, 0]));
  return enc.frame();
}

// Sanity check: NewDataAnswer import for type flow.
void NewDataAnswer;
