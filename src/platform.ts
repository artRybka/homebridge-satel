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
import { SatelConnection } from './satel/connection';
import { SatelCommands, chooseEntityWidth } from './satel/commands';
import { StatePoller } from './satel/poller';
import type { SatelPlatformConfig } from './types';

export class SatelPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: PlatformAccessory[] = [];
  public config: SatelPlatformConfig | undefined;

  public connection: SatelConnection | undefined;
  public commands: SatelCommands | undefined;
  public poller: StatePoller | undefined;

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
      if (!this.config) return;
      this.setupSatel(this.config);
    });

    api.on('shutdown', () => {
      this.log.info('Satel Integra: shutdown.');
      this.poller?.stop();
      this.connection?.close();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.debug('Wczytuję akcesorium z cache: %s', accessory.displayName);
    this.accessories.push(accessory);
  }

  private setupSatel(cfg: SatelPlatformConfig): void {
    const maxId = this.maxEntityId(cfg);
    const entityWidth = chooseEntityWidth(maxId);

    this.connection = new SatelConnection({
      host: cfg.host,
      port: cfg.port,
      integrationKey: cfg.integrationKey,
      log: this.log,
    });
    this.commands = new SatelCommands({
      connection: this.connection,
      userCode: cfg.userCode,
      entityWidth,
    });
    this.poller = new StatePoller(
      this.connection,
      this.commands,
      cfg.pollIntervalMs,
      this.log,
    );

    this.connection.on('connected', () => {
      this.poller?.start();
    });
    this.connection.on('disconnected', () => {
      // Poller continues; it gates ticks on connection state internally.
    });

    this.connection.connect();
    this.log.info('Satel Integra: komunikacja zainicjowana (entityWidth=%d).', entityWidth);
    // Accessory wiring arrives in Stages 4–8.
  }

  private maxEntityId(cfg: SatelPlatformConfig): number {
    let max = 0;
    for (const z of cfg.zones) max = Math.max(max, z.id);
    for (const s of cfg.shutters) max = Math.max(max, s.outputUp, s.outputDown);
    for (const s of cfg.switches) max = Math.max(max, s.output);
    for (const l of cfg.locks) max = Math.max(max, l.output);
    for (const t of cfg.temperatures) max = Math.max(max, t.output);
    return max;
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
