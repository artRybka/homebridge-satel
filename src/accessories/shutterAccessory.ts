import type {
  PlatformAccessory,
  Service,
} from 'homebridge';
import type { SatelPlatform } from '../platform';
import type { ShutterConfig } from '../types';

type Direction = 'up' | 'down' | 'idle';

interface ShutterContext {
  position?: number;
}

const TICK_MS = 200;
/** Throttle for writing currentPosition to accessory.context during movement. */
const PERSIST_INTERVAL_MS = 1000;

/**
 * Roller shutter driven by two Satel outputs (one for "up", one for "down").
 *
 * Satel doesn't report the blind's physical position, so we estimate it in
 * software from `travelUpSec` / `travelDownSec`. State is persisted in
 * accessory.context on every movement and at interval so the estimate
 * survives Homebridge restarts (and even crashes mid-movement).
 */
export class ShutterAccessory {
  private readonly service: Service;
  private readonly context: ShutterContext;
  private currentPosition: number;
  private targetPosition: number;
  private direction: Direction = 'idle';
  private tickTimer: NodeJS.Timeout | null = null;
  private movementStart = 0;
  private lastPersistAt = 0;

  constructor(
    private readonly platform: SatelPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly config: ShutterConfig,
  ) {
    const { Service: S, Characteristic: C } = platform;

    this.context = accessory.context as ShutterContext;
    const restored = this.context.position;
    this.currentPosition = clampPct(restored ?? 0);
    this.targetPosition = this.currentPosition;
    this.context.position = this.currentPosition;
    if (typeof restored === 'number') {
      this.platform.log.info(
        'Satel: roleta "%s" — odtworzona pozycja %d %% (z cache)',
        config.name, Math.round(this.currentPosition),
      );
    }

    accessory.getService(S.AccessoryInformation)!
      .setCharacteristic(C.Manufacturer, 'Satel')
      .setCharacteristic(C.Model, 'Integra Shutter')
      .setCharacteristic(C.SerialNumber, `shutter-${config.outputUp}-${config.outputDown}`);

    const subtype = `shutter-${config.outputUp}-${config.outputDown}`;
    this.service = accessory.getServiceById(S.WindowCovering, subtype)
      ?? accessory.addService(S.WindowCovering, config.name, subtype);
    this.service.setCharacteristic(C.Name, config.name);

    this.service.setCharacteristic(C.CurrentPosition, this.currentPosition);
    this.service.setCharacteristic(C.TargetPosition, this.targetPosition);
    this.service.setCharacteristic(C.PositionState, C.PositionState.STOPPED);

    this.service.getCharacteristic(C.CurrentPosition).onGet(() => this.currentPosition);
    this.service.getCharacteristic(C.TargetPosition)
      .onGet(() => this.targetPosition)
      .onSet((v) => this.setTarget(Number(v)));
    this.service.getCharacteristic(C.PositionState).onGet(() => this.positionState());
  }

  private positionState(): number {
    const { PositionState } = this.platform.Characteristic;
    if (this.direction === 'up') return PositionState.INCREASING;
    if (this.direction === 'down') return PositionState.DECREASING;
    return PositionState.STOPPED;
  }

  private async setTarget(target: number): Promise<void> {
    const t = clampPct(target);
    this.targetPosition = t;

    if (this.direction !== 'idle') {
      await this.stopMovement();
    }

    if (t > this.currentPosition) {
      await this.startMovement('up');
    } else if (t < this.currentPosition) {
      await this.startMovement('down');
    }
  }

  private travelSecFor(dir: Direction): number {
    if (dir === 'up') return this.config.travelUpSec;
    if (dir === 'down') return this.config.travelDownSec;
    return this.config.travelUpSec;
  }

  private isEndpointTarget(): boolean {
    return this.targetPosition === 0 || this.targetPosition === 100;
  }

  private async startMovement(dir: Direction): Promise<void> {
    if (dir === 'idle') return;
    const output = dir === 'up' ? this.config.outputUp : this.config.outputDown;
    const cmds = this.platform.commands;
    if (!cmds) return;
    this.direction = dir;
    this.movementStart = Date.now();
    this.updatePositionState();
    try {
      await cmds.outputsOn([output]);
      if (this.config.pulseMs > 0) {
        // Momentary pulse: Satel switches the output off on its own.
        setTimeout(() => { void cmds.outputsOff([output]); }, this.config.pulseMs);
      } else if (this.isEndpointTarget()) {
        // Bistable mode + endpoint target: keep the output ON for full travel
        // plus extraPulseSec. In-flight stop is handled by stopMovement.
        const holdMs = (this.travelSecFor(dir) + this.config.extraPulseSec) * 1000;
        setTimeout(() => {
          if (this.direction === dir) {
            void cmds.outputsOff([output]);
          }
        }, holdMs);
      }
    } catch (err) {
      this.platform.log.error('Satel: shutter "%s" start %s failed: %s',
        this.config.name, dir, (err as Error).message);
      this.direction = 'idle';
      this.updatePositionState();
      throw err;
    }
    this.startTicker();
  }

  private async stopMovement(): Promise<void> {
    const cmds = this.platform.commands;
    if (!cmds) return;
    if (this.direction === 'idle') return;
    const output = this.direction === 'up' ? this.config.outputUp : this.config.outputDown;
    try {
      if (this.config.pulseMs > 0) {
        // Second pulse in the same direction stops typical shutter controllers.
        await cmds.outputsOn([output]);
        setTimeout(() => { void cmds.outputsOff([output]); }, this.config.pulseMs);
      } else {
        await cmds.outputsOff([output]);
      }
    } catch (err) {
      this.platform.log.warn('Satel: shutter "%s" stop failed: %s',
        this.config.name, (err as Error).message);
    }
    this.direction = 'idle';
    this.stopTicker();
    this.updatePositionState();
    this.persistPosition();
  }

  private startTicker(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
  }

  private stopTicker(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private tick(): void {
    if (this.direction === 'idle') {
      this.stopTicker();
      return;
    }
    const travelSec = this.travelSecFor(this.direction);
    const elapsed = (Date.now() - this.movementStart) / 1000;
    const delta = (elapsed / travelSec) * 100;
    this.movementStart = Date.now();

    if (this.direction === 'up') {
      this.currentPosition = clampPct(this.currentPosition + delta);
      if (this.currentPosition >= this.targetPosition) {
        this.currentPosition = this.targetPosition;
        this.scheduleEndpointSettle();
      }
    } else {
      this.currentPosition = clampPct(this.currentPosition - delta);
      if (this.currentPosition <= this.targetPosition) {
        this.currentPosition = this.targetPosition;
        this.scheduleEndpointSettle();
      }
    }

    this.service.updateCharacteristic(
      this.platform.Characteristic.CurrentPosition,
      Math.round(this.currentPosition),
    );
    this.maybePersistPosition();
  }

  private maybePersistPosition(): void {
    const now = Date.now();
    if (now - this.lastPersistAt < PERSIST_INTERVAL_MS) return;
    this.lastPersistAt = now;
    this.persistPosition();
  }

  /**
   * When the estimated position has reached the target, either stop
   * immediately (for intermediate positions) or keep the movement state
   * visible for `extraPulseSec` additional seconds (for 0% / 100%), giving
   * the motor time to reach the physical endpoint.
   */
  private scheduleEndpointSettle(): void {
    if (this.direction === 'idle') return;
    if (!this.isEndpointTarget() || this.config.extraPulseSec === 0) {
      void this.stopMovement();
      return;
    }
    const dir = this.direction;
    this.stopTicker();
    setTimeout(() => {
      if (this.direction === dir) {
        void this.stopMovement();
      }
    }, this.config.extraPulseSec * 1000);
  }

  private updatePositionState(): void {
    this.service.updateCharacteristic(
      this.platform.Characteristic.PositionState,
      this.positionState(),
    );
  }

  private persistPosition(): void {
    this.context.position = this.currentPosition;
    this.platform.api.updatePlatformAccessories([this.accessory]);
  }
}

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}
