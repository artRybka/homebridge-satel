import type {
  PlatformAccessory,
  Service,
} from 'homebridge';
import type { SatelPlatform } from '../platform';
import type { TemperatureConfig } from '../types';

/**
 * Temperature readings (INT-KLCD 1-Wire, INT-E) require protocol commands
 * that the upstream `satel-integra-integration-protocol` library does not
 * expose yet (no encodeOutputsTemperatureCommand / OutputsTemperatureAnswer).
 *
 * This accessory therefore registers the HomeKit service but reports 0°C
 * and warns once at startup, so the config entry doesn't crash the plugin
 * and the accessory reappears as soon as temperature support lands upstream.
 */
export class TemperatureAccessory {
  private readonly service: Service;

  constructor(
    private readonly platform: SatelPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly config: TemperatureConfig,
  ) {
    const { Service: S, Characteristic: C } = platform;

    accessory.getService(S.AccessoryInformation)!
      .setCharacteristic(C.Manufacturer, 'Satel')
      .setCharacteristic(C.Model, 'Integra Temperature')
      .setCharacteristic(C.SerialNumber, `temperature-${config.output}`);

    const subtype = `temperature-${config.output}`;
    this.service = accessory.getServiceById(S.TemperatureSensor, subtype)
      ?? accessory.addService(S.TemperatureSensor, config.name, subtype);
    this.service.setCharacteristic(C.Name, config.name);
    this.service.setCharacteristic(C.CurrentTemperature, 0);

    this.service.getCharacteristic(C.CurrentTemperature).onGet(() => 0);

    platform.log.warn(
      'Satel: odczyt temperatury (wyjście %d "%s") nie jest jeszcze zaimplementowany — upstream satel-integra-integration-protocol nie wystawia komendy. Akcesorium zgłasza 0°C.',
      config.output,
      config.name,
    );
  }
}
