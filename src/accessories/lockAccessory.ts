import type {
  PlatformAccessory,
  Service,
} from 'homebridge';
import type { SatelPlatform } from '../platform';
import type { LockConfig } from '../types';

/**
 * Electric strike behind a pulse output: HomeKit has no feedback signal, so
 * we simulate the momentary unlock and return to SECURED after `pulseMs + 2s`.
 */
export class LockAccessory {
  private readonly service: Service;
  private settleTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly platform: SatelPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly config: LockConfig,
  ) {
    const { Service: S, Characteristic: C } = platform;

    accessory.getService(S.AccessoryInformation)!
      .setCharacteristic(C.Manufacturer, 'Satel')
      .setCharacteristic(C.Model, 'Integra Lock')
      .setCharacteristic(C.SerialNumber, `lock-${config.output}`);

    const subtype = `lock-${config.output}`;
    this.service = accessory.getServiceById(S.LockMechanism, subtype)
      ?? accessory.addService(S.LockMechanism, config.name, subtype);
    this.service.setCharacteristic(C.Name, config.name);

    this.service.setCharacteristic(C.LockCurrentState, C.LockCurrentState.SECURED);
    this.service.setCharacteristic(C.LockTargetState, C.LockTargetState.SECURED);

    this.service.getCharacteristic(C.LockTargetState)
      .onSet((v) => this.setTarget(Number(v)));
  }

  private async setTarget(value: number): Promise<void> {
    const { Characteristic: C } = this.platform;
    const cmds = this.platform.commands;
    if (!cmds) return;

    if (value === C.LockTargetState.SECURED) {
      // No-op: the lock re-secures automatically after the pulse.
      this.service.updateCharacteristic(C.LockCurrentState, C.LockCurrentState.SECURED);
      return;
    }

    try {
      await cmds.outputsOn([this.config.output]);
      this.service.updateCharacteristic(C.LockCurrentState, C.LockCurrentState.UNSECURED);
      if (this.settleTimer) clearTimeout(this.settleTimer);
      this.settleTimer = setTimeout(async () => {
        try {
          await cmds.outputsOff([this.config.output]);
        } catch (err) {
          this.platform.log.warn('Satel: lock pulse off failed for %s: %s',
            this.config.name, (err as Error).message);
        }
      }, this.config.pulseMs);
      // Re-secure the HomeKit state shortly after the pulse ends.
      setTimeout(() => {
        this.service.updateCharacteristic(C.LockCurrentState, C.LockCurrentState.SECURED);
        this.service.updateCharacteristic(C.LockTargetState, C.LockTargetState.SECURED);
      }, this.config.pulseMs + 2000);
    } catch (err) {
      this.platform.log.error('Satel: lock "%s" unlock failed: %s',
        this.config.name, (err as Error).message);
      this.service.updateCharacteristic(C.LockCurrentState, C.LockCurrentState.SECURED);
      throw err;
    }
  }
}
