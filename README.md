# homebridge-satel-integra

Homebridge plugin that exposes a **Satel Integra** alarm system to Apple HomeKit through the **ETHM-1 / ETHM-1 Plus** Ethernet module — no Domoticz, Home Assistant, or Node-RED in the middle.

Full specification, protocol notes, and implementation plan live in [`CLAUDE.md`](./CLAUDE.md).

## Supported HomeKit mappings

| Satel entity | HomeKit service |
|---|---|
| Partition (strefa) | `SecuritySystem` |
| Zone (wejście) | `MotionSensor` / `ContactSensor` / `SmokeSensor` / `LeakSensor` / `CarbonMonoxideSensor` / `OccupancySensor` |
| Output — bistable (toggle) | `Switch` |
| Output — momentary (pulse) | `Switch` (auto-release) |
| Output pair — up/down | `WindowCovering` |
| Output — electric strike | `LockMechanism` |
| Output — temperature | `TemperatureSensor` *(stub — see Limitations)* |

Any number of each type is supported; the only upper bound is the size of the central unit (Integra 24/32/64/128/256). Protocol width is auto-selected (128-zone or 256-zone commands) from the highest configured id.

## Installation

```bash
npm install -g homebridge-satel-integra
```

Then configure through the **Homebridge Config UI X** plugin page — no manual JSON editing required.

## Configuration

### Minimal — one partition, a few sensors

```json
{
  "platform": "SatelIntegra",
  "name": "Satel Integra",
  "host": "192.168.1.50",
  "port": 7094,
  "userCode": "1234",
  "partitions": [
    { "id": 1, "name": "Dom" }
  ],
  "zones": [
    { "id": 1, "name": "Drzwi wejściowe", "type": "contact" },
    { "id": 2, "name": "Salon — czujka", "type": "motion" }
  ]
}
```

### Extended — multiple partitions, shutters, switches, lock

```json
{
  "platform": "SatelIntegra",
  "name": "Satel Integra",
  "host": "192.168.1.50",
  "port": 7094,
  "userCode": "1234",
  "pollIntervalMs": 1000,

  "partitions": [
    { "id": 1, "name": "Parter", "armHomeMode": 2, "armNightMode": 3 },
    { "id": 2, "name": "Piętro", "armHomeMode": 2, "armNightMode": 3 },
    { "id": 3, "name": "Garaż" }
  ],

  "zones": [
    { "id": 1,  "name": "Drzwi wejściowe", "type": "contact" },
    { "id": 2,  "name": "Salon — ruch",    "type": "motion" },
    { "id": 3,  "name": "Czujka dymu",     "type": "smoke" },
    { "id": 4,  "name": "Zalanie łazienki", "type": "leak" },
    { "id": 5,  "name": "Okno sypialni",    "type": "contact", "invert": true }
  ],

  "shutters": [
    { "name": "Roleta salon",   "outputUp": 10, "outputDown": 11, "travelTimeSec": 22, "pulseMs": 500 },
    { "name": "Roleta sypialnia","outputUp": 12, "outputDown": 13, "travelTimeSec": 18, "pulseMs": 500 }
  ],

  "switches": [
    { "name": "Oświetlenie tarasu", "output": 20, "mode": "toggle" },
    { "name": "Brama wjazdowa",     "output": 21, "mode": "pulse", "pulseMs": 800 }
  ],

  "locks": [
    { "name": "Furtka", "output": 22, "pulseMs": 1500 }
  ]
}
```

## Partition arm modes

Satel exposes four arm modes (0 – 3). Each installer assigns them differently (full / day / night / custom). Map them explicitly per partition:

| HomeKit target | Satel mode used |
|---|---|
| `AWAY_ARM` | `0` (always — "full" arm) |
| `STAY_ARM` (Home) | `armHomeMode` (default `2`) |
| `NIGHT_ARM` | `armNightMode` (default `3`) |
| `DISARM` | disarm; additionally clears a latched alarm |

Current-state reporting uses the reverse mapping: a partition armed in `armHomeMode` shows as `STAY_ARM`, in `armNightMode` as `NIGHT_ARM`, mode 0 / 1 as `AWAY_ARM`. An active alarm always overrides the arm state to `ALARM_TRIGGERED`.

## Limitations

- **Only one client may connect to the ETHM module at a time.** If Domoticz, Home Assistant, or another system is already connected, disconnect it first.
- **Encryption (AES-192)** is not yet implemented. If `integrationKey` is set, the plugin logs a warning and connects in cleartext. Use the unencrypted ETHM-1 path until encryption support lands.
- **Shutter position** is estimated from `travelTimeSec`; Satel does not report the physical position. Nudge to 0% or 100% after a power event to resynchronise.
- **Temperature sensors** register but always report 0°C until the upstream `satel-integra-integration-protocol` library exposes the matching commands.

## Development

```bash
npm install
npm run build     # compile TypeScript -> dist/
npm run lint
npm test          # runs node:test suites under test/unit/
npm run watch     # build + homebridge -D -U ./test/hbConfig (never commit ./test/hbConfig/config.json)
```

See `CLAUDE.md` for the architecture overview, stage-by-stage plan, and the protocol-level notes that drove the connection/poller design.

## License

MIT
