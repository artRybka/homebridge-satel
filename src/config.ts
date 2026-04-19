import type { Logging, PlatformConfig } from 'homebridge';
import {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_PORT,
} from './settings';
import type {
  ArmMode,
  HomekitMode,
  LockConfig,
  PartitionConfig,
  SatelPlatformConfig,
  ShutterConfig,
  SwitchConfig,
  TemperatureConfig,
  ZoneConfig,
  ZoneSensorType,
} from './types';

const VALID_ZONE_TYPES: ZoneSensorType[] = [
  'motion', 'contact', 'smoke', 'leak', 'co', 'occupancy',
];

const VALID_ARM_MODES: ArmMode[] = [0, 1, 2, 3];
const VALID_HK_MODES: HomekitMode[] = ['off', 'home', 'night', 'away'];

export class ConfigError extends Error {}

export function parseConfig(raw: PlatformConfig, log: Logging): SatelPlatformConfig {
  const name = asString(raw.name, 'name') ?? 'Satel Integra';
  const host = asString(raw.host, 'host');
  if (!host) {
    throw new ConfigError('Missing required field "host" (IP of ETHM module).');
  }
  const userCode = asString(raw.userCode, 'userCode');
  if (!userCode) {
    throw new ConfigError('Missing required field "userCode".');
  }
  if (!/^[0-9]{4,8}$/.test(userCode)) {
    throw new ConfigError('"userCode" must be 4–8 digits.');
  }

  const port = asInt(raw.port, 'port', DEFAULT_PORT, 1, 65535);
  const pollIntervalMs = asInt(raw.pollIntervalMs, 'pollIntervalMs', DEFAULT_POLL_INTERVAL_MS, 250, 60_000);
  const integrationKey = asString(raw.integrationKey, 'integrationKey') ?? undefined;
  const autoDiscover = raw.autoDiscover === undefined ? true : Boolean(raw.autoDiscover);

  const partitions = parsePartitions(raw.partitions, log);
  const zones = parseZones(raw.zones, log);
  const shutters = parseShutters(raw.shutters, log);
  const switches = parseSwitches(raw.switches, log);
  const locks = parseLocks(raw.locks, log);
  const temperatures = parseTemperatures(raw.temperatures, log);

  warnOnOutputConflicts({ shutters, switches, locks, temperatures }, log);

  const total =
    partitions.length + zones.length + shutters.length +
    switches.length + locks.length + temperatures.length;
  if (total === 0) {
    log.warn('Plugin nie ma żadnych skonfigurowanych urządzeń.');
  }

  return {
    ...raw,
    platform: raw.platform ?? 'SatelIntegra',
    name,
    host,
    port,
    userCode,
    integrationKey,
    pollIntervalMs,
    autoDiscover,
    partitions,
    zones,
    shutters,
    switches,
    locks,
    temperatures,
  };
}

function parsePartitions(raw: unknown, log: Logging): PartitionConfig[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<number>();
  const out: PartitionConfig[] = [];
  for (const entry of raw) {
    const id = asInt(entry?.id, 'partition.id', NaN, 1, 32);
    const name = asString(entry?.name, 'partition.name');
    if (!Number.isFinite(id) || !name) {
      log.error('Pominięto nieprawidłowy wpis w "partitions": %j', entry);
      continue;
    }
    if (seen.has(id)) {
      log.error('Zduplikowana strefa id=%d — pomijam.', id);
      continue;
    }
    seen.add(id);
    out.push({
      id,
      name,
      armHomeMode: asArmMode(entry?.armHomeMode, 2),
      armNightMode: asArmMode(entry?.armNightMode, 3),
      homekitModes: asHomekitModes(entry?.homekitModes),
    });
  }
  return out;
}

function parseZones(raw: unknown, log: Logging): ZoneConfig[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<number>();
  const out: ZoneConfig[] = [];
  for (const entry of raw) {
    const id = asInt(entry?.id, 'zone.id', NaN, 1, 256);
    const name = asString(entry?.name, 'zone.name');
    const type = asZoneType(entry?.type);
    if (!Number.isFinite(id) || !name || !type) {
      log.error('Pominięto nieprawidłowy wpis w "zones": %j', entry);
      continue;
    }
    if (seen.has(id)) {
      log.error('Zduplikowane wejście id=%d — pomijam.', id);
      continue;
    }
    seen.add(id);
    out.push({ id, name, type, invert: Boolean(entry?.invert) });
  }
  return out;
}

function parseShutters(raw: unknown, log: Logging): ShutterConfig[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seenPairs = new Set<string>();
  const out: ShutterConfig[] = [];
  for (const entry of raw) {
    const name = asString(entry?.name, 'shutter.name');
    const outputUp = asInt(entry?.outputUp, 'shutter.outputUp', NaN, 1, 256);
    const outputDown = asInt(entry?.outputDown, 'shutter.outputDown', NaN, 1, 256);
    const fallback = asInt(entry?.travelTimeSec, 'shutter.travelTimeSec', 25, 1, 600);
    const travelUpSec = asInt(entry?.travelUpSec, 'shutter.travelUpSec', fallback, 1, 600);
    const travelDownSec = asInt(entry?.travelDownSec, 'shutter.travelDownSec', fallback, 1, 600);
    const extraPulseSec = asInt(entry?.extraPulseSec, 'shutter.extraPulseSec', 2, 0, 30);
    const pulseMs = asInt(entry?.pulseMs, 'shutter.pulseMs', 500, 0, 10_000);
    if (!name || !Number.isFinite(outputUp) || !Number.isFinite(outputDown)) {
      log.error('Pominięto nieprawidłowy wpis w "shutters": %j', entry);
      continue;
    }
    if (outputUp === outputDown) {
      log.error('Roleta "%s": outputUp i outputDown muszą być różne — pomijam.', name);
      continue;
    }
    const key = `${outputUp}:${outputDown}`;
    if (seenPairs.has(key)) {
      log.error('Zduplikowana para wyjść rolety %s — pomijam.', key);
      continue;
    }
    seenPairs.add(key);
    out.push({
      name,
      outputUp,
      outputDown,
      travelTimeSec: fallback,
      travelUpSec,
      travelDownSec,
      extraPulseSec,
      pulseMs,
    });
  }
  return out;
}

function parseSwitches(raw: unknown, log: Logging): SwitchConfig[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<number>();
  const out: SwitchConfig[] = [];
  for (const entry of raw) {
    const name = asString(entry?.name, 'switch.name');
    const output = asInt(entry?.output, 'switch.output', NaN, 1, 256);
    const mode = entry?.mode === 'pulse' ? 'pulse' : 'toggle';
    const pulseMs = asInt(entry?.pulseMs, 'switch.pulseMs', 500, 50, 10_000);
    if (!name || !Number.isFinite(output)) {
      log.error('Pominięto nieprawidłowy wpis w "switches": %j', entry);
      continue;
    }
    if (seen.has(output)) {
      log.error('Zduplikowane wyjście przełącznika %d — pomijam.', output);
      continue;
    }
    seen.add(output);
    out.push({ name, output, mode, pulseMs });
  }
  return out;
}

function parseLocks(raw: unknown, log: Logging): LockConfig[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<number>();
  const out: LockConfig[] = [];
  for (const entry of raw) {
    const name = asString(entry?.name, 'lock.name');
    const output = asInt(entry?.output, 'lock.output', NaN, 1, 256);
    const pulseMs = asInt(entry?.pulseMs, 'lock.pulseMs', 1500, 50, 10_000);
    if (!name || !Number.isFinite(output)) {
      log.error('Pominięto nieprawidłowy wpis w "locks": %j', entry);
      continue;
    }
    if (seen.has(output)) {
      log.error('Zduplikowane wyjście zamka %d — pomijam.', output);
      continue;
    }
    seen.add(output);
    out.push({ name, output, pulseMs });
  }
  return out;
}

function parseTemperatures(raw: unknown, log: Logging): TemperatureConfig[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<number>();
  const out: TemperatureConfig[] = [];
  for (const entry of raw) {
    const name = asString(entry?.name, 'temperature.name');
    const output = asInt(entry?.output, 'temperature.output', NaN, 1, 256);
    if (!name || !Number.isFinite(output)) {
      log.error('Pominięto nieprawidłowy wpis w "temperatures": %j', entry);
      continue;
    }
    if (seen.has(output)) {
      log.error('Zduplikowane wyjście czujnika temperatury %d — pomijam.', output);
      continue;
    }
    seen.add(output);
    out.push({ name, output });
  }
  return out;
}

function warnOnOutputConflicts(
  cfg: {
    shutters: ShutterConfig[];
    switches: SwitchConfig[];
    locks: LockConfig[];
    temperatures: TemperatureConfig[];
  },
  log: Logging,
): void {
  const byOutput = new Map<number, string[]>();
  const add = (out: number, label: string) => {
    const list = byOutput.get(out) ?? [];
    list.push(label);
    byOutput.set(out, list);
  };
  for (const s of cfg.shutters) {
    add(s.outputUp, `shutter "${s.name}" (up)`);
    add(s.outputDown, `shutter "${s.name}" (down)`);
  }
  for (const s of cfg.switches) add(s.output, `switch "${s.name}"`);
  for (const l of cfg.locks) add(l.output, `lock "${l.name}"`);
  for (const t of cfg.temperatures) add(t.output, `temperature "${t.name}"`);

  for (const [output, labels] of byOutput) {
    if (labels.length > 1) {
      log.warn('Konflikt: wyjście %d użyte wielokrotnie przez: %s', output, labels.join(', '));
    }
  }
}

function asString(v: unknown, _field: string): string | undefined {
  if (typeof v === 'string' && v.length > 0) return v;
  return undefined;
}

function asInt(
  v: unknown,
  _field: string,
  def: number,
  min: number,
  max: number,
): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : def;
  if (!Number.isFinite(n)) return def;
  if (n < min || n > max) return def;
  return Math.trunc(n);
}

function asArmMode(v: unknown, def: ArmMode): ArmMode {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : def;
  return (VALID_ARM_MODES as number[]).includes(n) ? (n as ArmMode) : def;
}

function asZoneType(v: unknown): ZoneSensorType | undefined {
  return typeof v === 'string' && (VALID_ZONE_TYPES as string[]).includes(v)
    ? (v as ZoneSensorType)
    : undefined;
}

function asHomekitModes(v: unknown): HomekitMode[] {
  const all: HomekitMode[] = [...VALID_HK_MODES];
  if (!Array.isArray(v)) return all;
  const filtered = v.filter((x): x is HomekitMode => typeof x === 'string' && (VALID_HK_MODES as string[]).includes(x));
  // Deduplicate while preserving order.
  const seen = new Set<HomekitMode>();
  const out: HomekitMode[] = [];
  for (const m of filtered) {
    if (!seen.has(m)) { seen.add(m); out.push(m); }
  }
  return out.length === 0 ? all : out;
}
