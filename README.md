# homebridge-satel-integra

Homebridge plugin that exposes a **Satel Integra** alarm system to Apple HomeKit through the **ETHM-1 / ETHM-1 Plus** Ethernet module — no Domoticz, Home Assistant, or Node-RED in the middle.

Configuration is driven from a **Custom UI in Homebridge Config UI X**: the plugin reads the names of partitions, zones and outputs directly from the central unit, and you tick what you want exposed to HomeKit with per-row HomeKit-name, sensor type, arm mode etc.

## Supported HomeKit mappings

| Satel entity | HomeKit service | Notes |
|---|---|---|
| Partition (strefa) | `SecuritySystem` | arm mode mapping + which HK modes (Off/Home/Night/Away) the Home app shows |
| Zone (wejście) | `MotionSensor` / `ContactSensor` / `SmokeSensor` / `LeakSensor` / `CarbonMonoxideSensor` / `OccupancySensor` | per-zone HomeKit type, invert (NC) flag |
| Output — bistable (toggle) | `Switch` | state syncs bidirectionally (keypad → HomeKit) |
| Output — momentary (pulse) | `Switch` | auto-releases after `pulseMs` |
| Output — electric strike | `LockMechanism` | pulse opens, auto-relocks after `pulseMs + 2 s` |
| Output pair — up/down | `WindowCovering` | estimated position + configurable open / close / extra time per direction |

There is no upper bound besides the central unit size (Integra 24/32/64/128/256). The protocol width (128 vs 256) is auto-selected from the highest configured id.

## Quick start

**Before you begin**: log in to your Satel central (via DLOADX or the keypad) and create a dedicated integration user with a 4–8 digit code, granting it only the rights you want HomeKit to have (arm/disarm specific partitions, toggle specific outputs). Don't use your personal master code. Make sure no other system (Domoticz, Home Assistant, …) is holding the single TCP slot on the ETHM.

1. **Install the plugin**.
   - Via Homebridge Config UI X: *Plugins* tab → *Install Plugin* (cloud+plus icon top-right) → search for `homebridge-satel-integra` → Install.
   - Or from the shell, in your Homebridge storage directory:
     ```bash
     cd ~/.homebridge     # or /var/lib/homebridge for hb-service
     npm install homebridge-satel-integra
     sudo hb-service restart
     ```

2. **Enter connection details**. Open the plugin's *Settings* page. Fill in:
   - **Adres IP modułu ETHM** — e.g. `192.168.1.50`.
   - **Port TCP** — default `7094`.
   - **Kod użytkownika Satel** — the 4–8 digit code of the integration user you created.
   - Leave *Interwał odpytywania* at `1000` ms.
   Save. Homebridge restarts and the plugin connects to the central.

3. **Pull data from the central**. Back in *Settings*, click **„Pobierz dane z Centrali"**. The plugin queries ~300 entities by name; takes 30–60 s. When it's done Homebridge restarts once more and the picker reloads with three sections: Partycje, Wejścia, Rolety, Wyjścia pojedyncze.

4. **Pick what you want in HomeKit**. Each card is collapsed by default. Click the card to expand and tick. For every entity you enable:
   - **Nazwa w HomeKit** — how the accessory appears in the Home app (pre-filled with the Satel label, edit freely).
   - **Partycje** → choose *Tryb Home* and *Tryb Night* (which Satel arm mode each HomeKit mode triggers), and optionally hide modes you don't use in *Widoczne w HomeKit*.
   - **Wejścia** → pick *Typ HomeKit* (motion / contact / smoke / leak / CO / occupancy). Tick *Odwróć logikę* only for NC zones where spoczynek = naruszenie.
   - **Rolety** → the plugin auto-pairs outputs that share a name. Set *Otwarcie [s]*, *Zamknięcie [s]*, *Ekstra [s]* (endpoint hold) and *Impuls [ms]* (0 = bistable outputs, >0 = Satel shutter controller). Use ↕ if the plugin picked the wrong side as "Góra".
   - **Wyjścia pojedyncze** → choose *Rola* (bistable switch / pulse switch / electric strike) and the pulse length where applicable.

5. **Save** via the sticky green button at the bottom. Homebridge restarts one final time and the selected accessories appear in the Apple Home app.

After any change on the Satel side (renaming, adding, removing an entity), come back to *Settings* and click „Pobierz dane z Centrali" to refresh the picker.

## Installation sources

| Source | Command | When to use |
|---|---|---|
| npm (stable, recommended) | `npm install homebridge-satel-integra` | Default for production installs. |
| npm (pre-release) | `npm install homebridge-satel-integra@beta` | Early access to upcoming versions. |
| GitHub `main` branch | `npm install github:artRybka/homebridge-satel` | Bleeding edge, may be unstable. |

The repo ships a `prepare` hook so builds run automatically for source installs.

## Configuration reference

Open the plugin's **Settings** page in Config UI X. You get a dedicated picker (not the usual schema form):

1. **Top-level form**: host, port (TCP, default `7094`), user code, polling interval.
2. **„Pobierz dane z Centrali"** button — deletes the cached discovery, restarts Homebridge and runs a fresh scan (~30–60 s over ~300 protocol queries). Use this after adding/renaming entities in the central unit.
3. **Stacked sections** — Partycje, Wejścia, Rolety, Wyjścia pojedyncze. Each entity is a single card:
   - unconfigured cards show only the header; click anywhere to expand
   - checked cards show full per-type fields and flip to a green tint
4. **Save** is a sticky button at the bottom. Writes the picked entries into `partitions / zones / shutters / switches / locks` in `config.json` and triggers a Homebridge restart.

Per-section controls:

- **Partycje** — HomeKit name (separate from the Satel label), Tryb Home / Tryb Night (which Satel mode each HomeKit mode uses), Widoczne w HomeKit (four checkboxes to hide unused modes from the Home app).
- **Wejścia** — HomeKit name, Typ HomeKit (motion / contact / smoke / leak / CO / occupancy), Odwróć logikę (for NC sensors where naruszenie = spoczynek).
- **Rolety** — auto-paired outputs sharing the same Satel name (e.g. 17 and 18 named "Kitchen"). Per-shutter: HomeKit name, swap ↕, Otwarcie [s], Zamknięcie [s], Ekstra [s] (dociśnięcie przy 0 % / 100 %), Impuls [ms] (0 for bistable, >0 for a Satel shutter controller).
- **Wyjścia pojedyncze** — rola (Przełącznik bistabilny / impulsowy / Elektrozaczep) + Impuls [ms] where applicable.

## Partition arm modes

Satel exposes four arm modes (0 – 3). Each installer wires them differently (full / day / night / custom). Map them explicitly per partition in the picker:

| HomeKit target | Satel mode used |
|---|---|
| `AWAY_ARM` | `0` (always — "full" arm) |
| `STAY_ARM` (Home) | `armHomeMode` (default `2`) |
| `NIGHT_ARM` | `armNightMode` (default `3`) |
| `DISARM` | disarm; additionally clears a latched alarm |

Current-state reporting uses the reverse mapping: a partition armed in `armHomeMode` shows as `STAY_ARM`, in `armNightMode` as `NIGHT_ARM`, mode 0 / 1 as `AWAY_ARM`. An active alarm overrides the arm state to `ALARM_TRIGGERED`.

If `armHomeMode` and `armNightMode` happen to be the same Satel mode (e.g. both `2`), the accessory remembers which HomeKit target the user last picked and reports that one back — so the "Arming…" spinner doesn't get stuck.

## Shutter behaviour

- Position is estimated — Satel doesn't report it. `travelUpSec` / `travelDownSec` drive the estimate; `extraPulseSec` is an additional hold only at 0 % and 100 % to make sure the blind reaches the endpoint.
- Position is persisted to `accessory.context` every second during motion, so restarts and crashes keep a near-correct value.
- Accessory UUID ignores the up/down order (`min:max`), so flipping the ↕ toggle in the picker doesn't orphan the cached position.

## Limitations

- **Only one TCP client** on ETHM at a time. If you have Domoticz, Home Assistant, or another system connected, disconnect it first.
- **AES-192 encryption** (`integrationKey`) is not yet implemented — the plugin logs a warning and falls back to cleartext. Raw config still accepts the field for when it lands.
- **Partition arm mode detection** distinguishes mode 2 from mode 3 explicitly (via `partitions_armed_in_mode_2/3`), but collapses modes 0 and 1 into a single "AWAY_ARM" because the protocol doesn't disambiguate them.
- **Temperature sensors** were dropped from the plugin: the upstream `satel-integra-integration-protocol` library doesn't expose the relevant commands. Re-add once it does.

## Development

```bash
npm install
npm run build     # compile TypeScript -> dist/
npm run lint
npm test          # runs node:test suites under test/unit/
npm run watch     # build + homebridge -D -U ./test/hbConfig (do NOT commit test/hbConfig/config.json)
```

See `CLAUDE.md` for the original protocol-level notes that drove the connection / poller design.

## License

MIT
