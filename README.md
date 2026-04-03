# Deluge Web Tools

Browser-based tools for the Synthstrom Audible Deluge. No installation needed.

**[→ Open Deluge Web Tools](https://llink5.github.io/DelugeWeb/)**

Requirements: Community Firmware ≥ 1.3.0, Chrome (or any WebMIDI-compatible browser), USB cable.

## Modules

### Preset Manager (`/presets`)
Browse, load, compare and diff presets directly from your Deluge over USB. Side-by-side visual diff with color-coded highlighting — yellow for changed, green for added, red for removed parameters.

### File Browser (`/files`)
Full SD card browser over USB — upload, download, rename, delete files and create folders. No need to remove the SD card from your Deluge.

### Preset Editor (`/editor`)
Detailed parameter view for Sound and Kit presets. Displays all parameters with formatted values and hex representations. Supports all firmware versions.

### Parameter Docs (`/docs`)
Searchable reference of all 142 Deluge parameters, extracted directly from the firmware source code. Includes param IDs, XML tags, display names, enum values, defaults and menu paths. Automatically updated via GitHub Action.

### Display Mirror (`/display`)
Live mirror of the Deluge OLED (128×48) and 7-segment display in your browser. Includes screenshot export as PNG.

### Performance Trace (`/perf`)
Debug event visualizer for firmware developers. Parses and displays performance trace output with hex timestamp decoding.

### Debug Tools (`/debug`)
Memory Read/Write/Watch over SysEx with pointer following. Interactive memory map showing all SRAM, SDRAM and Flash regions with object markers. Requires modified firmware with SysEx MemAccess handler.

### Wave Editor (`/waves`)
Coming soon.

## How it works

Everything runs in the browser. WebMIDI communicates directly with the Deluge over USB — no server, no backend. All data stays in your browser. Nothing is sent to any server.

## Quick Start

1. Connect your Deluge via USB
2. Open the link above in Chrome
3. Click Connect and select your Deluge
4. Done

## For Developers

```bash
git clone https://github.com/llink5/DelugeWeb.git
cd DelugeWeb/app
npm install
npm run dev
```

See [`app/README.md`](app/README.md) for project structure and developer documentation.

## Architecture

Unified Vue 3 + TypeScript + Vite single-page application. A shared MIDI library (`lib/midi/`) provides async/await communication with timeout and retry logic. The XML parser (`lib/xml/`) handles all Deluge preset formats across firmware versions. 35 TypeScript interfaces in `lib/types/` cover the full Deluge data model. Modules are lazy-loaded via Vue Router. Production build output is 332 KB.

## Auto-updating Parameter Database

The extraction script (`scripts/extract-parameters.js`) parses the DelugeFirmware codebase fully dynamically — param IDs, XML tags, display names, enum values, defaults and menu paths. A GitHub Action runs weekly (Monday 04:00 UTC) and commits changes automatically. New firmware parameters are picked up without manual maintenance.

## Debug Tools (Advanced)

The debug module requires a modified firmware build with a SysEx MemAccess handler (command `0x06`). Source: https://github.com/llink5/DelugeFirmware. Provides memory read, write and watch operations with pointer following, plus an interactive memory map covering all SRAM, SDRAM and Flash regions.

## Credits

Built on the original work by Jamie Fenton — vuefinder, midilib, viewScore, delugeclient, catnip.
Parameter database extracted from the Synthstrom Audible Deluge Firmware (GPL-3.0).

## License

GPL-3.0
