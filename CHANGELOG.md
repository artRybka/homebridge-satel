# Changelog

All notable changes to this project are documented here. Format roughly follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions use
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.4] — 2026-04-20

### Changed

- GitHub Actions: bump `actions/checkout` and `actions/setup-node` from
  v4 to v5 so the workflows run on Node 24 natively (deprecation
  warning fires for Node 20-based actions starting June 2026). Add
  Node 24 to the CI test matrix alongside 20 and 22; release runner
  now uses Node 22 (active LTS).

No user-visible runtime change.

## [0.6.3] — 2026-04-20

### Fixed

- **Custom UI dark mode**: Config UI X in dark theme rendered my iframe
  with the parent's dark background but my hardcoded dark text — making
  almost everything invisible until you highlighted it. Replace fixed
  colors with CSS variables driven by `@media (prefers-color-scheme:
  dark)`; cards, banners, inputs, sticky save bar, badges, focus rings
  all adapt now. No effect on light mode.

  Reported with VERSA 15 + ETHM-1 Plus 03.13 — but it hit every dark-
  mode user on every central.

## [0.6.2] — 2026-04-20

### Fixed

- `package.json: engines.node` now includes Node 24 (`^20 || ^22 || ^24`)
  so the plugin passes Homebridge Verified compatibility checks.
- `config.schema.json`: `required: true` on individual fields replaced
  with `required: [...]` arrays at the parent object level, matching
  JSON Schema Draft 7 semantics. Fixes the Verified schema linter.

## [0.6.1] — 2026-04-20

First stable release on the `latest` tag. Identical runtime behaviour to
`0.6.0-beta.0` after a round of real-hardware testing — the only changes
are a README Quick start section and an updated Installation sources
table that points at the npm package instead of a GitHub branch.

## [0.6.0-beta.0] — 2026-04-20

First public pre-release. Tagged `beta` on npm: install with
`npm install homebridge-satel-integra@beta`.

### Added

- **HomeKit accessory types**: `SecuritySystem` (partitions), six flavors of
  sensor (`MotionSensor`, `ContactSensor`, `SmokeSensor`, `LeakSensor`,
  `CarbonMonoxideSensor`, `OccupancySensor`) for zones, `Switch` (bistable
  or pulse), `LockMechanism` for electric strikes, `WindowCovering` for
  shutters.
- **Satel ETHM-1 / ETHM-1 Plus** TCP transport with auto-reconnect
  (exponential backoff), serialized command queue, per-command timeout,
  128/256-entity auto-selection.
- **State poller** using `new_data` (0x7F) category bitmap, fetches only
  changed categories; emits typed events consumed by accessories. First
  tick after (re)connect does a full sync.
- **Custom Config UI X interface** (`homebridge-ui/`):
  - Discovery button reads partition / zone / output names from the
    central unit via protocol command `0xEE`.
  - Stacked cards with per-row HomeKit-name input, zone type dropdown,
    NC invert checkbox, output role selector, shutter travel times.
  - Auto-pairs outputs that share the same Satel name into "Rolety".
  - Per-partition arm-mode mapping and a four-checkbox "Widoczne w
    HomeKit" that restricts which modes appear in the Home app.
  - Sticky save bar, collapsed unchecked cards (click header to toggle),
    focus rings, aligned form controls.
- **Shutter estimation**: per-direction `travelUpSec` / `travelDownSec`,
  `extraPulseSec` hold at 0 % / 100 %, bistable (`pulseMs: 0`) or pulse
  (`pulseMs > 0`) wiring modes.
- **Shutter position persistence** every second during motion + on stop.
  Direction-independent accessory UUID (`min:max`) so swapping up/down
  in the UI doesn't orphan cached position.
- **Alarm propagation**: `PartitionsAlarm` reads → accessory reports
  `ALARM_TRIGGERED` in HomeKit. Disarm from HomeKit also clears a
  latched alarm.
- **Arm-mode collision fix**: when `armHomeMode == armNightMode`, the
  partition accessory remembers the last HomeKit target so the Home app
  no longer sits on "Arming…" forever.
- **Forced rescan** button: wipes the discovery cache and restarts
  Homebridge; next boot runs a fresh scan.

### Known limitations

- `integrationKey` (AES-192) is accepted but not implemented; connection
  falls back to cleartext with a log warning.
- Only one TCP client at a time on ETHM — disconnect Domoticz / HA / etc.
  before running this plugin.
- `temperatures` were removed: the upstream
  `satel-integra-integration-protocol` library does not yet expose the
  relevant commands. Will return once it does.

[0.6.4]: https://github.com/artRybka/homebridge-satel/releases/tag/v0.6.4
[0.6.3]: https://github.com/artRybka/homebridge-satel/releases/tag/v0.6.3
[0.6.2]: https://github.com/artRybka/homebridge-satel/releases/tag/v0.6.2
[0.6.1]: https://github.com/artRybka/homebridge-satel/releases/tag/v0.6.1
[0.6.0-beta.0]: https://github.com/artRybka/homebridge-satel/releases/tag/v0.6.0-beta.0
