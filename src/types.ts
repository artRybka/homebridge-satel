import type { PlatformConfig } from 'homebridge';

export type ZoneSensorType =
  | 'motion'
  | 'contact'
  | 'smoke'
  | 'leak'
  | 'co'
  | 'occupancy';

export type ArmMode = 0 | 1 | 2 | 3;

export interface PartitionConfig {
  id: number;
  name: string;
  armHomeMode: ArmMode;
  armNightMode: ArmMode;
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
  travelTimeSec: number;
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
  partitions: PartitionConfig[];
  zones: ZoneConfig[];
  shutters: ShutterConfig[];
  switches: SwitchConfig[];
  locks: LockConfig[];
  temperatures: TemperatureConfig[];
}
