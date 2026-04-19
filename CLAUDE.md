# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Status

This repository is currently empty — no source code, configuration, or documentation has been committed yet. The project is intended to be a [Homebridge](https://homebridge.io/) plugin for integrating Satel alarm systems with Apple HomeKit.

When source code is added, this file should be updated to document:

- **Build & development commands** (e.g. `npm run build`, `npm run watch`, `npm run lint`)
- **Test commands**, including how to run a single test
- **High-level architecture** — how the plugin communicates with the Satel ETHM module (TCP protocol, encryption), how devices are mapped to HomeKit accessories (zones, outputs, partitions), and the accessory/platform lifecycle within Homebridge
- **Key conventions** specific to this codebase that aren't obvious from reading a single file

## Expected Project Shape (Homebridge plugin conventions)

Once scaffolded, a typical Homebridge plugin in this space will include:

- `package.json` with a `homebridge` engine range and a `main` entry point
- A dynamic platform class registered via `api.registerPlatform(...)`
- Accessory handlers that map Satel zones/outputs/partitions to HomeKit services (SecuritySystem, ContactSensor, MotionSensor, Switch, etc.)
- A transport layer that speaks the Satel Integration Protocol over TCP to an ETHM-1/ETHM-1 Plus module

Update this document as soon as the initial code lands so future Claude sessions have accurate guidance.
