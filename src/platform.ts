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
import { SatelDiscovery, formatDiscoveryAsConfig } from './satel/discovery';
import { StatePoller } from './satel/poller';
import { LockAccessory } from './accessories/lockAccessory';
import { PartitionAccessory } from './accessories/partitionAccessory';
import { ShutterAccessory } from './accessories/shutterAccessory';
import { SwitchAccessory } from './accessories/switchAccessory';
import { TemperatureAccessory } from './accessories/temperatureAccessory';
import { ZoneAccessory } from './accessories/zoneAccessory';
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

    let discoveryStarted = false;
    this.connection.on('connected', () => {
      this.poller?.start();
      if (cfg.autoDiscover && !discoveryStarted) {
        discoveryStarted = true;
        void this.runDiscovery();
      }
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

    for (const partition of cfg.partitions) {
      const acc = this.ensureAccessory(`satel:partition:${partition.id}`, partition.name, { partition });
      used.add(acc.UUID);
      new PartitionAccessory(this, acc, partition);
    }

    for (const zone of cfg.zones) {
      const acc = this.ensureAccessory(`satel:zone:${zone.id}`, zone.name, { zone });
      used.add(acc.UUID);
      new ZoneAccessory(this, acc, zone);
    }

    for (const sw of cfg.switches) {
      const acc = this.ensureAccessory(`satel:switch:${sw.output}`, sw.name, { switch: sw });
      used.add(acc.UUID);
      new SwitchAccessory(this, acc, sw);
    }

    for (const lk of cfg.locks) {
      const acc = this.ensureAccessory(`satel:lock:${lk.output}`, lk.name, { lock: lk });
      used.add(acc.UUID);
      new LockAccessory(this, acc, lk);
    }

    for (const sh of cfg.shutters) {
      const acc = this.ensureAccessory(
        `satel:shutter:${sh.outputUp}:${sh.outputDown}`,
        sh.name,
        { shutter: sh },
      );
      used.add(acc.UUID);
      new ShutterAccessory(this, acc, sh);
    }

    for (const t of cfg.temperatures) {
      const acc = this.ensureAccessory(
        `satel:temperature:${t.output}`,
        t.name,
        { temperature: t },
      );
      used.add(acc.UUID);
      new TemperatureAccessory(this, acc, t);
    }

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

  private async runDiscovery(): Promise<void> {
    if (!this.connection) return;
    const discovery = new SatelDiscovery({
      connection: this.connection,
      log: this.log,
    });
    try {
      const result = await discovery.discover();
      this.log.info(formatDiscoveryAsConfig(result));
    } catch (err) {
      this.log.warn('Satel: auto-discovery nie powiodło się — %s', (err as Error).message);
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
