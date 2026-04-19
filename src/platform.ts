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
import { ZoneAccessory } from './accessories/zoneAccessory';
import type { SatelPlatformConfig, ZoneConfig } from './types';

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

    this.registerAccessories(cfg);
    this.connection.connect();
    this.log.info('Satel Integra: komunikacja zainicjowana (entityWidth=%d).', entityWidth);
  }

  private registerAccessories(cfg: SatelPlatformConfig): void {
    const used = new Set<string>();

    for (const zone of cfg.zones) {
      const acc = this.ensureAccessory(`satel:zone:${zone.id}`, zone.name, { zone });
      used.add(acc.UUID);
      new ZoneAccessory(this, acc, zone);
    }

    // Stages 5–8 add: partitions, shutters, switches, locks, temperatures.

    this.pruneStaleAccessories(used);
  }

  private ensureAccessory(
    uuidKey: string,
    displayName: string,
    context: Record<string, unknown>,
  ): PlatformAccessory {
    const uuid = this.api.hap.uuid.generate(uuidKey);
    const existing = this.accessories.find((a) => a.UUID === uuid);
    if (existing) {
      existing.displayName = displayName;
      Object.assign(existing.context, context);
      this.api.updatePlatformAccessories([existing]);
      this.log.debug('Satel: reuse cached accessory %s (%s)', displayName, uuidKey);
      return existing;
    }
    const accessory = new this.api.platformAccessory(displayName, uuid);
    Object.assign(accessory.context, context);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    this.accessories.push(accessory);
    this.log.info('Satel: register new accessory %s (%s)', displayName, uuidKey);
    return accessory;
  }

  private pruneStaleAccessories(used: Set<string>): void {
    const stale = this.accessories.filter((a) => !used.has(a.UUID));
    if (stale.length === 0) return;
    for (const a of stale) {
      this.log.info('Satel: remove stale accessory %s', a.displayName);
    }
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    for (const a of stale) {
      const idx = this.accessories.indexOf(a);
      if (idx >= 0) this.accessories.splice(idx, 1);
    }
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
