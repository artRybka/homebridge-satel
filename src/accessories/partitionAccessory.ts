import type {
  CharacteristicValue,
  PlatformAccessory,
  Service,
} from 'homebridge';
import type { SatelPlatform } from '../platform';
import type { ArmMode, PartitionConfig } from '../types';

export class PartitionAccessory {
  private readonly service: Service;

  constructor(
    private readonly platform: SatelPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly config: PartitionConfig,
  ) {
    const { Service: S, Characteristic: C } = platform;

    accessory.getService(S.AccessoryInformation)!
      .setCharacteristic(C.Manufacturer, 'Satel')
      .setCharacteristic(C.Model, 'Integra Partition')
      .setCharacteristic(C.SerialNumber, `partition-${config.id}`);

    const subtype = `partition-${config.id}`;
    this.service = accessory.getServiceById(S.SecuritySystem, subtype)
      ?? accessory.addService(S.SecuritySystem, config.name, subtype);
    this.service.setCharacteristic(C.Name, config.name);

    this.service.getCharacteristic(C.SecuritySystemCurrentState)
      .onGet(() => this.currentState());

    this.service.getCharacteristic(C.SecuritySystemTargetState)
      .onGet(() => this.targetFromCurrent(this.currentState()))
      .onSet((v) => this.setTarget(v));

    platform.poller?.on('partitionArmed', (id, _mode) => {
      if (id !== config.id) return;
      this.service.updateCharacteristic(C.SecuritySystemCurrentState, this.currentState());
    });
    platform.poller?.on('partitionAlarm', (id) => {
      if (id !== config.id) return;
      this.service.updateCharacteristic(C.SecuritySystemCurrentState, this.currentState());
    });
  }

  private currentState(): CharacteristicValue {
    const { Characteristic: C } = this.platform;
    if (this.platform.poller?.isPartitionAlarm(this.config.id)) {
      return C.SecuritySystemCurrentState.ALARM_TRIGGERED;
    }
    const mode = this.platform.poller?.getPartitionArmMode(this.config.id);
    if (mode === null || mode === undefined) {
      return C.SecuritySystemCurrentState.DISARMED;
    }
    return this.satelModeToHomeKitCurrent(mode);
  }

  private targetFromCurrent(current: CharacteristicValue): CharacteristicValue {
    const { Characteristic: C } = this.platform;
    switch (current) {
      case C.SecuritySystemCurrentState.STAY_ARM: return C.SecuritySystemTargetState.STAY_ARM;
      case C.SecuritySystemCurrentState.AWAY_ARM: return C.SecuritySystemTargetState.AWAY_ARM;
      case C.SecuritySystemCurrentState.NIGHT_ARM: return C.SecuritySystemTargetState.NIGHT_ARM;
      case C.SecuritySystemCurrentState.ALARM_TRIGGERED:
        // Alarm state has no target; default to AWAY so the UI isn't blank.
        return C.SecuritySystemTargetState.AWAY_ARM;
      default:
        return C.SecuritySystemTargetState.DISARM;
    }
  }

  private async setTarget(value: CharacteristicValue): Promise<void> {
    const { Characteristic: C } = this.platform;
    const cmds = this.platform.commands;
    if (!cmds) {
      this.platform.log.warn('Satel: próba ustawienia stanu strefy, ale komendy nie są zainicjowane.');
      return;
    }
    try {
      switch (value) {
        case C.SecuritySystemTargetState.STAY_ARM:
          await cmds.arm([this.config.id], this.config.armHomeMode);
          break;
        case C.SecuritySystemTargetState.AWAY_ARM:
          await cmds.arm([this.config.id], 0);
          break;
        case C.SecuritySystemTargetState.NIGHT_ARM:
          await cmds.arm([this.config.id], this.config.armNightMode);
          break;
        case C.SecuritySystemTargetState.DISARM:
          await cmds.disarm([this.config.id]);
          if (this.platform.poller?.isPartitionAlarm(this.config.id)) {
            await cmds.clearAlarm([this.config.id]);
          }
          break;
      }
    } catch (err) {
      this.platform.log.error('Satel: strefa %d — nie udało się zmienić stanu: %s',
        this.config.id, (err as Error).message);
      throw err;
    }
  }

  private satelModeToHomeKitCurrent(mode: ArmMode): CharacteristicValue {
    const { Characteristic: C } = this.platform;
    if (mode === this.config.armHomeMode) return C.SecuritySystemCurrentState.STAY_ARM;
    if (mode === this.config.armNightMode) return C.SecuritySystemCurrentState.NIGHT_ARM;
    // mode 0, 1, or any not matched above — treat as full away arm.
    return C.SecuritySystemCurrentState.AWAY_ARM;
  }
}
