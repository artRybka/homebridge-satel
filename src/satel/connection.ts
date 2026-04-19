import { EventEmitter } from 'node:events';
import { createConnection, Socket } from 'node:net';
import type { Logging } from 'homebridge';
import { decodeMessage, type SatelMessage } from 'satel-integra-integration-protocol';
// Subpath access to the internal decoder + CRC for raw-mode commands whose
// responses the top-level decodeMessage() does not dispatch (e.g. 0xEE).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RawDecoder = require('satel-integra-integration-protocol/decoder');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RawCrc = require('satel-integra-integration-protocol/crc');
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_RECONNECT_MAX_MS,
  DEFAULT_RECONNECT_MIN_MS,
} from '../settings';
import { FrameSplitter } from './framing';

export interface SatelConnectionOptions {
  host: string;
  port: number;
  integrationKey?: string;
  commandTimeoutMs?: number;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  log: Logging;
}

export interface SatelConnectionEvents {
  connected: () => void;
  disconnected: (err?: Error) => void;
  message: (msg: SatelMessage) => void;
  error: (err: Error) => void;
}

type DecodedEntry = {
  mode: 'decoded';
  frame: Buffer;
  resolve: (m: SatelMessage) => void;
  reject: (err: Error) => void;
  timer?: NodeJS.Timeout;
};

type RawEntry = {
  mode: 'raw';
  frame: Buffer;
  resolve: (payload: Buffer) => void;
  reject: (err: Error) => void;
  timer?: NodeJS.Timeout;
};

type QueueEntry = DecodedEntry | RawEntry;

export class SatelConnection extends EventEmitter {
  private socket: Socket | null = null;
  private splitter = new FrameSplitter();
  private queue: QueueEntry[] = [];
  private inflight: QueueEntry | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private connected = false;

  private readonly commandTimeoutMs: number;
  private readonly reconnectMinMs: number;
  private readonly reconnectMaxMs: number;

  constructor(private readonly opts: SatelConnectionOptions) {
    super();
    this.commandTimeoutMs = opts.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.reconnectMinMs = opts.reconnectMinMs ?? DEFAULT_RECONNECT_MIN_MS;
    this.reconnectMaxMs = opts.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS;

    if (opts.integrationKey) {
      opts.log.warn('Satel: klucz szyfrowania ustawiony, ale AES nie jest jeszcze zaimplementowany — łączę bez szyfrowania.');
    }
  }

  connect(): void {
    this.closed = false;
    if (this.socket || this.reconnectTimer) return;
    this.doConnect();
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.rejectAllPending(new Error('Connection closed by platform'));
    this.socket?.destroy();
    this.socket = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  sendCommand(frame: Buffer): Promise<SatelMessage> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error('Connection is closed'));
        return;
      }
      this.queue.push({ mode: 'decoded', frame, resolve, reject });
      this.processQueue();
    });
  }

  /**
   * Send a command and resolve with the raw destuffed, CRC-verified payload
   * (command byte + data, no CRC, no framing). Use for protocol commands the
   * upstream library doesn't dispatch via decodeMessage() — notably 0xEE.
   */
  sendRawCommand(frame: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error('Connection is closed'));
        return;
      }
      this.queue.push({ mode: 'raw', frame, resolve, reject });
      this.processQueue();
    });
  }

  private doConnect(): void {
    if (this.closed) return;
    const { host, port, log } = this.opts;
    log.debug('Satel: łączę z %s:%d', host, port);

    const socket = createConnection({ host, port });
    this.socket = socket;

    socket.once('connect', () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      log.info('Satel: połączono z %s:%d', host, port);
      this.emit('connected');
      this.processQueue();
    });

    socket.on('data', (chunk: Buffer) => this.onData(chunk));

    socket.on('error', (err: Error) => {
      log.debug('Satel: socket error: %s', err.message);
      // 'close' follows; handle cleanup there.
    });

    socket.once('close', (hadError: boolean) => {
      this.connected = false;
      this.socket = null;
      this.splitter.reset();
      if (this.inflight) {
        clearTimeout(this.inflight.timer);
        this.inflight.reject(new Error('Connection closed'));
        this.inflight = null;
      }
      this.emit('disconnected', hadError ? new Error('Socket closed with error') : undefined);
      if (!this.closed) {
        this.scheduleReconnect();
      }
    });
  }

  private onData(chunk: Buffer): void {
    this.splitter.append(chunk);
    for (const frame of this.splitter.drainAll()) {
      const item = this.inflight;
      if (item?.mode === 'raw') {
        const payload = decodeRawFrame(frame);
        this.inflight = null;
        clearTimeout(item.timer);
        if (!payload) {
          item.reject(new Error('Bad frame (raw mode): CRC or framing failed'));
        } else {
          item.resolve(payload);
        }
        this.processQueue();
        continue;
      }
      const msg = decodeMessage(frame);
      if (!msg) {
        const err = new Error(`Bad frame received (${frame.length} bytes)`);
        this.opts.log.warn('Satel: %s', err.message);
        this.emit('error', err);
        continue;
      }
      this.emit('message', msg);
      if (item) {
        this.inflight = null;
        clearTimeout(item.timer);
        (item as DecodedEntry).resolve(msg);
        this.processQueue();
      }
    }
  }

  private processQueue(): void {
    if (this.inflight) return;
    if (!this.socket || !this.connected || !this.socket.writable) return;
    const item = this.queue.shift();
    if (!item) return;
    this.inflight = item;
    item.timer = setTimeout(() => this.onCommandTimeout(item), this.commandTimeoutMs);
    try {
      this.socket.write(item.frame);
    } catch (err) {
      this.inflight = null;
      clearTimeout(item.timer);
      item.reject(err as Error);
      this.socket.destroy();
    }
  }

  private onCommandTimeout(item: QueueEntry): void {
    if (this.inflight !== item) return;
    this.inflight = null;
    item.reject(new Error(`Satel command timeout after ${this.commandTimeoutMs} ms`));
    this.opts.log.warn('Satel: timeout oczekiwania na odpowiedź, zrywam połączenie.');
    this.socket?.destroy();
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    const delay = Math.min(
      this.reconnectMaxMs,
      this.reconnectMinMs * Math.pow(2, this.reconnectAttempts),
    );
    this.reconnectAttempts += 1;
    this.opts.log.info('Satel: reconnect za %d ms (próba %d)', delay, this.reconnectAttempts);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect();
    }, delay);
  }

  private rejectAllPending(err: Error): void {
    if (this.inflight) {
      clearTimeout(this.inflight.timer);
      this.inflight.reject(err);
      this.inflight = null;
    }
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      item?.reject(err);
    }
  }
}

function decodeRawFrame(frame: Buffer): Buffer | null {
  const d = new RawDecoder();
  for (const b of frame.values()) {
    if (d.addByte(b)) break;
  }
  const destuffed: Buffer = d.frame();
  if (destuffed.length < 3) return null;
  const c = new RawCrc();
  c.addBytes(destuffed.subarray(0, destuffed.length - 2));
  const expected =
    (destuffed[destuffed.length - 2] << 8) | destuffed[destuffed.length - 1];
  if (c.crc !== expected) return null;
  return destuffed.subarray(0, destuffed.length - 2);
}
