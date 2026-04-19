import type { PlatformConfig } from 'homebridge';

export type ZoneSensorType =
  | 'motion'
  | 'contact'
  | 'smoke'
  | 'leak'
  | 'co'
  | 'occupancy';

export type ArmMode = 0 | 1 | 2 | 3;

/** HomeKit-facing arm modes the user allows the Home app to show. */
export type HomekitMode = 'off' | 'home' | 'night' | 'away';

export interface PartitionConfig {
  id: number;
  name: string;
  armHomeMode: ArmMode;
  armNightMode: ArmMode;
  homekitModes: HomekitMode[];
}

export interface ZoneConfig {
  id: number;
  name: string;
  type: ZoneSensorType;
  invert: boolean;
}

export interface ShutterConfig {
  name: string;
  outputUp: number;
  outputDown: number;
  /** @deprecated use travelUpSec / travelDownSec */
  travelTimeSec?: number;
  /** Time for a full open (0 → 100%), seconds. */
  travelUpSec: number;
  /** Time for a full close (100 → 0%), seconds. */
  travelDownSec: number;
  /** Extra runtime appended when the target is 0% or 100% to ensure the
   *  blind reaches the endpoint even if the estimate is slightly off. */
  extraPulseSec: number;
  pulseMs: number;
}

export interface SwitchConfig {
  name: string;
  output: number;
  mode: 'toggle' | 'pulse';
  pulseMs: number;
}

export interface LockConfig {
  name: string;
  output: number;
  pulseMs: number;
}

export interface TemperatureConfig {
  name: string;
  output: number;
}

export interface SatelPlatformConfig extends PlatformConfig {
  host: string;
  port: number;
  userCode: string;
  integrationKey?: string;
  pollIntervalMs: number;
  autoDiscover: boolean;
  partitions: PartitionConfig[];
  zones: ZoneConfig[];
  shutters: ShutterConfig[];
  switches: SwitchConfig[];
  locks: LockConfig[];
  temperatures: TemperatureConfig[];
}
