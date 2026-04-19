import { EventEmitter } from 'node:events';
import type { Logging } from 'homebridge';
import type { ArmMode } from '../types';
import type { SatelCommands } from './commands';
import type { SatelConnection } from './connection';

/**
 * Periodically polls the Satel ETHM with the NewData command (0x7F) and
 * requests detailed state only for categories flagged as changed.
 *
 * Emits a narrow set of semantic events that accessories subscribe to.
 */
export interface StatePollerEvents {
  /** Fired when a partition's armed state or arm mode changes. */
  partitionArmed: (id: number, mode: ArmMode | null) => void;
  partitionAlarm: (id: number, alarm: boolean) => void;
  outputState: (id: number, on: boolean) => void;
  zoneViolation: (id: number, violated: boolean) => void;
  /** Full state sync completed (initial or post-reconnect). */
  synced: () => void;
}

type EventName = keyof StatePollerEvents;

export class StatePoller extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private needsFullSync = true;

  private partitionsArmed = new Set<number>();
  private partitionsArmedInMode2 = new Set<number>();
  private partitionsArmedInMode3 = new Set<number>();
  private partitionsAlarm = new Set<number>();
  private outputs = new Set<number>();
  private zonesViolation = new Set<number>();

  private partitionModes = new Map<number, ArmMode>();

  constructor(
    private readonly conn: SatelConnection,
    private readonly cmds: SatelCommands,
    private readonly intervalMs: number,
    private readonly log: Logging,
  ) {
    super();
    this.conn.on('connected', () => { this.needsFullSync = true; });
    this.conn.on('disconnected', () => { this.needsFullSync = true; });
  }

  override on<K extends EventName>(event: K, listener: StatePollerEvents[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override emit<K extends EventName>(event: K, ...args: Parameters<StatePollerEvents[K]>): boolean {
    return super.emit(event, ...args);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Current snapshot for accessories to read initial state. */
  isPartitionArmed(id: number): boolean { return this.partitionsArmed.has(id); }
  getPartitionArmMode(id: number): ArmMode | null {
    return this.partitionsArmed.has(id) ? (this.partitionModes.get(id) ?? 0) : null;
  }
  isPartitionAlarm(id: number): boolean { return this.partitionsAlarm.has(id); }
  isOutputOn(id: number): boolean { return this.outputs.has(id); }
  isZoneViolated(id: number): boolean { return this.zonesViolation.has(id); }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    if (!this.conn.isConnected()) return;
    this.ticking = true;
    try {
      if (this.needsFullSync) {
        await this.fullSync();
        this.needsFullSync = false;
        this.emit('synced');
      } else {
        const nd = await this.cmds.readNewData();
        const armChanged =
          nd.armedPartitionsReallyChanged() ||
          nd.partitionsArmedInMode2Changed() ||
          nd.partitionsArmedInMode3Changed();
        if (armChanged) await this.syncPartitionsArmed();
        if (nd.partitionsAlarmChanged()) await this.syncPartitionsAlarm();
        if (nd.outputsStateChanged()) await this.syncOutputs();
        if (nd.zonesViolationChanged()) await this.syncZonesViolation();
      }
    } catch (err) {
      this.log.debug('Satel: poller tick error: %s', (err as Error).message);
    } finally {
      this.ticking = false;
    }
  }

  private async fullSync(): Promise<void> {
    await this.syncPartitionsArmed();
    await this.syncPartitionsAlarm();
    await this.syncOutputs();
    await this.syncZonesViolation();
  }

  private async syncPartitionsArmed(): Promise<void> {
    const armed = await this.cmds.readPartitionsArmed();
    const mode2 = await this.cmds.readPartitionsArmedInMode2();
    const mode3 = await this.cmds.readPartitionsArmedInMode3();
    const nextModes = new Map<number, ArmMode>();
    for (const id of armed) {
      if (mode3.has(id)) nextModes.set(id, 3);
      else if (mode2.has(id)) nextModes.set(id, 2);
      else nextModes.set(id, 0); // mode 0 or 1 — cannot distinguish; treat as 0
    }
    const prevIds = new Set<number>([...this.partitionsArmed, ...this.partitionModes.keys()]);
    const allIds = new Set<number>([...prevIds, ...nextModes.keys()]);
    for (const id of allIds) {
      const before = this.partitionsArmed.has(id) ? (this.partitionModes.get(id) ?? 0) : null;
      const after = nextModes.has(id) ? (nextModes.get(id) as ArmMode) : null;
      if (before !== after) this.emit('partitionArmed', id, after);
    }
    this.partitionsArmed = armed;
    this.partitionsArmedInMode2 = mode2;
    this.partitionsArmedInMode3 = mode3;
    this.partitionModes = nextModes;
  }

  private async syncPartitionsAlarm(): Promise<void> {
    const next = await this.cmds.readPartitionsAlarm();
    this.diff(this.partitionsAlarm, next, (id, on) => this.emit('partitionAlarm', id, on));
    this.partitionsAlarm = next;
  }

  private async syncOutputs(): Promise<void> {
    const next = await this.cmds.readOutputsState();
    this.diff(this.outputs, next, (id, on) => this.emit('outputState', id, on));
    this.outputs = next;
  }

  private async syncZonesViolation(): Promise<void> {
    const next = await this.cmds.readZonesViolation();
    this.diff(this.zonesViolation, next, (id, on) => this.emit('zoneViolation', id, on));
    this.zonesViolation = next;
  }

  private diff(
    prev: Set<number>,
    next: Set<number>,
    emit: (id: number, active: boolean) => void,
  ): void {
    for (const id of next) {
      if (!prev.has(id)) emit(id, true);
    }
    for (const id of prev) {
      if (!next.has(id)) emit(id, false);
    }
  }
}
