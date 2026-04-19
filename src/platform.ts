import type {
  API,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';
import { parseConfig, ConfigError } from './config';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import type { SatelPlatformConfig } from './types';

export class SatelPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: PlatformAccessory[] = [];
  public config: SatelPlatformConfig | undefined;

  constructor(
    public readonly log: Logging,
    public readonly rawConfig: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    try {
      this.config = parseConfig(rawConfig, log);
    } catch (err) {
      if (err instanceof ConfigError) {
        log.error('Nieprawidłowa konfiguracja: %s', err.message);
      } else {
        log.error('Błąd parsowania konfiguracji: %s', err);
      }
      return;
    }

    this.logConfigSummary(this.config);

    api.on('didFinishLaunching', () => {
      this.log.info('Satel Integra: platforma uruchomiona (etap 1 — tylko parsowanie configu).');
      // Stage 2+ wire up SatelConnection, StatePoller, and accessories here.
    });

    api.on('shutdown', () => {
      this.log.info('Satel Integra: shutdown.');
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug('Wczytuję akcesorium z cache: %s', accessory.displayName);
    this.accessories.push(accessory);
  }

  private logConfigSummary(cfg: SatelPlatformConfig): void {
    this.log.info(
      'Satel Integra: host=%s:%d, partycji=%d, wejść=%d, rolet=%d, przełączników=%d, zamków=%d, temp=%d, polling=%dms, szyfrowanie=%s',
      cfg.host,
      cfg.port,
      cfg.partitions.length,
      cfg.zones.length,
      cfg.shutters.length,
      cfg.switches.length,
      cfg.locks.length,
      cfg.temperatures.length,
      cfg.pollIntervalMs,
      cfg.integrationKey ? 'tak' : 'nie',
    );
  }
}

export { PLATFORM_NAME, PLUGIN_NAME };
