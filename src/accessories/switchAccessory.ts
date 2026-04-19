import type {
  CharacteristicValue,
  PlatformAccessory,
  Service,
} from 'homebridge';
import type { SatelPlatform } from '../platform';
import type { SwitchConfig } from '../types';

export class SwitchAccessory {
  private readonly service: Service;
  private pulseTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly platform: SatelPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly config: SwitchConfig,
  ) {
    const { Service: S, Characteristic: C } = platform;

    accessory.getService(S.AccessoryInformation)!
      .setCharacteristic(C.Manufacturer, 'Satel')
      .setCharacteristic(C.Model, `Integra Switch (${config.mode})`)
      .setCharacteristic(C.SerialNumber, `switch-${config.output}`);

    const subtype = `switch-${config.output}`;
    this.service = accessory.getServiceById(S.Switch, subtype)
      ?? accessory.addService(S.Switch, config.name, subtype);
    this.service.setCharacteristic(C.Name, config.name);

    this.service.getCharacteristic(C.On)
      .onGet(() => platform.poller?.isOutputOn(config.output) ?? false)
      .onSet((v) => this.setOn(Boolean(v)));

    platform.poller?.on('outputState', (id, on) => {
      if (id !== config.output) return;
      if (config.mode === 'toggle') {
        this.service.updateCharacteristic(C.On, on);
      }
      // For pulse mode: the momentary on/off is driven by us, not the poller.
    });
  }

  private async setOn(on: boolean): Promise<void> {
    const cmds = this.platform.commands;
    if (!cmds) return;
    try {
      if (this.config.mode === 'toggle') {
        if (on) await cmds.outputsOn([this.config.output]);
        else await cmds.outputsOff([this.config.output]);
        return;
      }
      // Pulse mode: only fire on the rising edge; auto-release after pulseMs.
      if (!on) return;
      await cmds.outputsOn([this.config.output]);
      if (this.pulseTimer) clearTimeout(this.pulseTimer);
      this.pulseTimer = setTimeout(async () => {
        this.pulseTimer = null;
        try {
          await cmds.outputsOff([this.config.output]);
        } catch (err) {
          this.platform.log.warn('Satel: switch pulse off failed for %s: %s',
            this.config.name, (err as Error).message);
        }
        this.service.updateCharacteristic(this.platform.Characteristic.On, false);
      }, this.config.pulseMs);
    } catch (err) {
      this.platform.log.error('Satel: switch "%s" — set on=%s failed: %s',
        this.config.name, on, (err as Error).message);
      throw err;
    }
  }
}
