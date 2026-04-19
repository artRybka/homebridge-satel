import type { Logging } from 'homebridge';
import type { SatelConnection } from './connection';
// Use the library's Encoder directly to build 0xEE frames; the library does
// not export a helper for this command. Subpath require is stable for this
// package (no "exports" field in package.json).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Encoder = require('satel-integra-integration-protocol/encoder');

/**
 * Device type codes for the 0xEE "read device name" command.
 * (Partition, zone, and output are the three we enumerate.)
 */
const DEVICE_TYPE = {
  partition: 0x00,
  zone: 0x05,
  output: 0x04,
} as const;

export type DiscoveryKind = keyof typeof DEVICE_TYPE;

export interface DiscoveredDevice {
  id: number;
  name: string;
  kind: number;
}

export interface DiscoveryResult {
  partitions: DiscoveredDevice[];
  zones: DiscoveredDevice[];
  outputs: DiscoveredDevice[];
}

export interface DiscoveryOptions {
  connection: SatelConnection;
  log: Logging;
  partitionCount?: number; // default 32
  zoneCount?: number;      // default 128 (Integra 256 owners can raise)
  outputCount?: number;    // default 128
  /** Optional delay between queries to avoid congesting the ETHM. */
  interQueryMs?: number;
}

export class SatelDiscovery {
  constructor(private readonly opts: DiscoveryOptions) {}

  async discover(): Promise<DiscoveryResult> {
    const partitionCount = this.opts.partitionCount ?? 32;
    const zoneCount = this.opts.zoneCount ?? 128;
    const outputCount = this.opts.outputCount ?? 128;

    this.opts.log.info(
      'Satel: start auto-discovery (partycje 1..%d, wejścia 1..%d, wyjścia 1..%d). To może potrwać kilkadziesiąt sekund...',
      partitionCount, zoneCount, outputCount,
    );

    const partitions = await this.scan('partition', partitionCount);
    const zones = await this.scan('zone', zoneCount);
    const outputs = await this.scan('output', outputCount);

    this.opts.log.info(
      'Satel: discovery zakończone — partycje: %d, wejścia: %d, wyjścia: %d.',
      partitions.length, zones.length, outputs.length,
    );

    return { partitions, zones, outputs };
  }

  private async scan(kind: DiscoveryKind, count: number): Promise<DiscoveredDevice[]> {
    const found: DiscoveredDevice[] = [];
    for (let id = 1; id <= count; id++) {
      try {
        const device = await this.queryName(kind, id);
        if (device && device.name.length > 0) {
          found.push(device);
        }
      } catch (err) {
        this.opts.log.debug('Satel: discovery %s #%d skip: %s',
          kind, id, (err as Error).message);
      }
      if (this.opts.interQueryMs) {
        await wait(this.opts.interQueryMs);
      }
    }
    return found;
  }

  private async queryName(
    kind: DiscoveryKind,
    number: number,
  ): Promise<DiscoveredDevice | null> {
    const type = DEVICE_TYPE[kind];
    const enc = new Encoder();
    enc.addByte(0xee);
    enc.addByte(type);
    enc.addByte(number & 0xff);
    const frame = enc.frame() as Buffer;

    const payload = await this.opts.connection.sendRawCommand(frame);
    return parseNameResponse(payload, kind, number);
  }
}

/**
 * Response payload (starting with the echoed 0xEE command byte):
 *   [0]  0xEE
 *   [1]  device type (echoed)
 *   [2]  device number (echoed)
 *   [3]  device kind/subtype (Satel-internal — partition type, zone type, etc.)
 *   [4..19] 16-byte name (padded with spaces), Windows-1250 for Polish chars
 *   [20..] optional extras (partition flags, etc.) — ignored here
 *
 * Exported for unit tests.
 */
export function parseNameResponse(
  payload: Buffer,
  kind: DiscoveryKind,
  expectedNumber: number,
): DiscoveredDevice | null {
  if (payload.length < 20) return null;
  if (payload[0] !== 0xee) return null;
  if (payload[1] !== DEVICE_TYPE[kind]) return null;
  const echoedNumber = payload[2];
  // For the 256-variant the echoed byte is (number & 0xff); we only compare
  // the low byte to keep the check loose.
  if (echoedNumber !== (expectedNumber & 0xff)) return null;
  const deviceKind = payload[3];
  const nameBytes = payload.subarray(4, 20);
  const name = decodeWin1250(nameBytes).trimEnd();
  return { id: expectedNumber, name, kind: deviceKind };
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Lightweight Windows-1250 → Unicode decoder for Polish characters plus the
 * ASCII range. Non-mapped bytes pass through as latin1.
 */
const WIN1250_POLISH: Record<number, string> = {
  0x8c: 'Ś', 0x8f: 'Ź',
  0x9c: 'ś', 0x9f: 'ź',
  0xa3: 'Ł', 0xa5: 'Ą', 0xaf: 'Ż',
  0xb3: 'ł', 0xb9: 'ą', 0xbf: 'ż',
  0xc6: 'Ć', 0xca: 'Ę', 0xd1: 'Ń', 0xd3: 'Ó',
  0xe6: 'ć', 0xea: 'ę', 0xf1: 'ń', 0xf3: 'ó',
};

function decodeWin1250(buf: Buffer): string {
  let out = '';
  for (const byte of buf) {
    if (byte < 0x80) {
      out += String.fromCharCode(byte);
      continue;
    }
    const polish = WIN1250_POLISH[byte];
    if (polish) {
      out += polish;
      continue;
    }
    // Fallback: latin1 interpretation (visually close to win-1250 for most
    // remaining printable bytes). Non-printable bytes show as their latin1
    // char but get trimmed by trimEnd on spaces/NULs.
    out += String.fromCharCode(byte);
  }
  return out;
}

/**
 * Format a discovery result as a block the user can paste into config.json
 * (keys match the plugin's schema). Zone/output typing still has to be made
 * by hand because the protocol doesn't expose HomeKit-ready types.
 */
export function formatDiscoveryAsConfig(
  result: DiscoveryResult,
): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('============================================================');
  lines.push('  Satel Integra — auto-discovery result');
  lines.push('  Skopiuj te sekcje do configu (Config UI X → plugin Settings)');
  lines.push('  i uzupełnij typy czujek (motion / contact / smoke / leak / co / occupancy).');
  lines.push('============================================================');

  lines.push('"partitions": [');
  lines.push(
    result.partitions
      .map((p) => `  { "id": ${p.id}, "name": ${JSON.stringify(p.name)} }`)
      .join(',\n'),
  );
  lines.push('],');

  lines.push('"zones": [');
  lines.push(
    result.zones
      .map((z) => `  { "id": ${z.id}, "name": ${JSON.stringify(z.name)}, "type": "motion" }`)
      .join(',\n'),
  );
  lines.push('],');

  lines.push('"switches": [');
  lines.push(
    result.outputs
      .map((o) => `  { "output": ${o.id}, "name": ${JSON.stringify(o.name)}, "mode": "toggle" }`)
      .join(',\n'),
  );
  lines.push(']');

  lines.push('============================================================');
  return lines.join('\n');
}
