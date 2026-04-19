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
    this.ready();
  }

  async getDiscovery() {
    const cachePath = path.join(this.homebridgeStoragePath, CACHE_FILENAME);
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
}

(() => new SatelUiServer())();
