import type {
  CharacteristicValue,
  PlatformAccessory,
  Service,
  WithUUID,
} from 'homebridge';
import type { SatelPlatform } from '../platform';
import type { ZoneConfig, ZoneSensorType } from '../types';

type ServiceCtor = WithUUID<typeof Service>;
type CharName =
  | 'MotionDetected'
  | 'ContactSensorState'
  | 'SmokeDetected'
  | 'LeakDetected'
  | 'CarbonMonoxideDetected'
  | 'OccupancyDetected';

interface TypeMapping {
  service: ServiceCtor;
  char: CharName;
  activeValue: CharacteristicValue;
  inactiveValue: CharacteristicValue;
  modelSuffix: string;
}

export class ZoneAccessory {
  private readonly service: Service;
  private readonly mapping: TypeMapping;

  constructor(
    private readonly platform: SatelPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly config: ZoneConfig,
  ) {
    this.mapping = this.mappingFor(config.type);
    const { Service: S, Characteristic: C } = platform;

    accessory.getService(S.AccessoryInformation)!
      .setCharacteristic(C.Manufacturer, 'Satel')
      .setCharacteristic(C.Model, `Integra ${this.mapping.modelSuffix}`)
      .setCharacteristic(C.SerialNumber, `zone-${config.id}`);

    const subtype = `zone-${config.id}`;
    this.service = accessory.getServiceById(this.mapping.service, subtype)
      ?? accessory.addService(this.mapping.service, config.name, subtype);
    this.service.setCharacteristic(C.Name, config.name);

    this.service.getCharacteristic(C[this.mapping.char])
      .onGet(() => this.currentValue());

    platform.poller?.on('zoneViolation', (id: number, violated: boolean) => {
      if (id !== config.id) return;
      this.service.updateCharacteristic(
        C[this.mapping.char],
        this.valueFor(this.transform(violated)),
      );
    });
  }

  private currentValue(): CharacteristicValue {
    const violated = this.platform.poller?.isZoneViolated(this.config.id) ?? false;
    return this.valueFor(this.transform(violated));
  }

  private transform(violated: boolean): boolean {
    return this.config.invert ? !violated : violated;
  }

  private valueFor(active: boolean): CharacteristicValue {
    return active ? this.mapping.activeValue : this.mapping.inactiveValue;
  }

  private mappingFor(type: ZoneSensorType): TypeMapping {
    const { Service: S, Characteristic: C } = this.platform;
    switch (type) {
      case 'motion':
        return {
          service: S.MotionSensor,
          char: 'MotionDetected',
          activeValue: true,
          inactiveValue: false,
          modelSuffix: 'Motion',
        };
      case 'contact':
        return {
          service: S.ContactSensor,
          char: 'ContactSensorState',
          activeValue: C.ContactSensorState.CONTACT_NOT_DETECTED,
          inactiveValue: C.ContactSensorState.CONTACT_DETECTED,
          modelSuffix: 'Contact',
        };
      case 'smoke':
        return {
          service: S.SmokeSensor,
          char: 'SmokeDetected',
          activeValue: C.SmokeDetected.SMOKE_DETECTED,
          inactiveValue: C.SmokeDetected.SMOKE_NOT_DETECTED,
          modelSuffix: 'Smoke',
        };
      case 'leak':
        return {
          service: S.LeakSensor,
          char: 'LeakDetected',
          activeValue: C.LeakDetected.LEAK_DETECTED,
          inactiveValue: C.LeakDetected.LEAK_NOT_DETECTED,
          modelSuffix: 'Leak',
        };
      case 'co':
        return {
          service: S.CarbonMonoxideSensor,
          char: 'CarbonMonoxideDetected',
          activeValue: C.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL,
          inactiveValue: C.CarbonMonoxideDetected.CO_LEVELS_NORMAL,
          modelSuffix: 'CO',
        };
      case 'occupancy':
        return {
          service: S.OccupancySensor,
          char: 'OccupancyDetected',
          activeValue: C.OccupancyDetected.OCCUPANCY_DETECTED,
          inactiveValue: C.OccupancyDetected.OCCUPANCY_NOT_DETECTED,
          modelSuffix: 'Occupancy',
        };
    }
  }
}
