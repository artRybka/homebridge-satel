// Custom UI server for the Satel Integra plugin.
// Runs in a separate Node process launched by Config UI X; exposes endpoints
// the index.html page calls via `homebridge.request('/...')`.
/* eslint-disable */
const fs = require('fs');
const path = require('path');
const { HomebridgePluginUiServer, RequestError } = require('@homebridge/plugin-ui-utils');

const CACHE_FILENAME = 'satel-integra-discovery.json';

class SatelUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this.onRequest('/discovery', this.getDiscovery.bind(this));
    this.onRequest('/rescan', this.requestRescan.bind(this));
    this.ready();
  }

  cachePath() {
    return path.join(this.homebridgeStoragePath, CACHE_FILENAME);
  }

  async getDiscovery() {
    const cachePath = this.cachePath();
    if (!fs.existsSync(cachePath)) {
      return { available: false, cachePath };
    }
    try {
      const raw = fs.readFileSync(cachePath, 'utf8');
      const data = JSON.parse(raw);
      return {
        available: true,
        cachePath,
        discoveredAt: data.discoveredAt || null,
        partitions: Array.isArray(data.partitions) ? data.partitions : [],
        zones: Array.isArray(data.zones) ? data.zones : [],
        outputs: Array.isArray(data.outputs) ? data.outputs : [],
      };
    } catch (err) {
      throw new RequestError('Nie udało się odczytać pliku discovery: ' + err.message);
    }
  }

  /**
   * Mark discovery as stale by deleting the cache file. The UI follows up
   * with homebridge.restartHomebridge() — on the next boot the platform
   * sees a missing cache and runs a fresh scan of the central unit.
   */
  async requestRescan() {
    const cachePath = this.cachePath();
    try {
      if (fs.existsSync(cachePath)) {
        fs.unlinkSync(cachePath);
      }
      return { ok: true, cachePath };
    } catch (err) {
      throw new RequestError('Nie udało się usunąć cache: ' + err.message);
    }
  }
}

(() => new SatelUiServer())();
