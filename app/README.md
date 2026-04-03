# Deluge Web Tools

**Manage your Synthstrom Deluge from the browser** -- browse presets, compare patches, mirror the display, and analyze performance traces, all over USB MIDI.

## Modules

| Module | Route | Description |
|--------|-------|-------------|
| **Preset Manager** | `/presets` | Scan, browse, inspect and diff Sound/Kit/Song presets. Color-coded parameter comparison. |
| **File Browser** | `/files` | Full SD card browser with upload, download, delete, rename, create folder. |
| **Preset Editor** | `/editor` | Detailed parameter view for Sound and Kit presets with formatted hex values. |
| **Display Mirror** | `/display` | Live OLED (128x48) and 7-segment display mirror with screenshot export. |
| **Perf Trace** | `/perf` | Performance trace visualizer for debug output with hex timestamp parsing. |
| **Wave Editor** | `/waves` | Coming soon -- WAV viewer with waveform display and region editing. |

## Screenshots

### Preset Manager (Diff View)
Two presets side-by-side with differences highlighted:
- **Yellow** = changed parameter
- **Green** = added (only in B)
- **Red** = removed (only in A)

### File Browser
SD card file browser with breadcrumb navigation, file preview, upload/download support.

### Display Mirror
Real-time OLED display mirror at 5x scale with 7-segment display below.

## For Users

1. Open the hosted version (or run locally)
2. Connect your Deluge via USB
3. Click **Connect** in the top bar -- the app auto-detects Deluge MIDI ports
4. Navigate to the module you want

**Requirements:** Chrome, Edge, or Opera (Web MIDI API with SysEx support required).

## For Developers

```bash
git clone https://github.com/SynthstromAudible/DelugeWeb.git
cd DelugeWeb/app
npm install
npm run dev
```

### Architecture

```
app/src/
├── lib/
│   ├── midi/          MidiConnection singleton (Web MIDI + SysEx protocol)
│   ├── xml/           Deluge XML parser/serializer (firmware 1.x-4.x)
│   └── types/         TypeScript interfaces for all preset types
├── modules/
│   ├── preset-manager/    Scan, load, diff presets
│   ├── file-browser/      SD card file operations
│   ├── preset-editor/     Parameter detail view
│   ├── display-mirror/    OLED + 7-seg canvas rendering
│   ├── perf-trace/        Debug stream event visualization
│   └── wave-editor/       (Coming soon)
├── components/            Shared: MidiConnection, StatusBar
├── App.vue                Shell with sidebar navigation
└── router.ts              Lazy-loaded routes per module
```

### Tech Stack

- **Vue 3** + Composition API + TypeScript
- **Vite** for build
- **Tailwind CSS v4** for styling
- **Vue Router** with lazy-loaded modules
- **Web MIDI API** for hardware communication
- **deep-diff** for preset comparison

### Key Design Decisions

- **Single build** -- all modules in one app, one deploy, one URL
- **No backend** -- everything runs in the browser via Web MIDI SysEx
- **Lazy loading** -- each module is a separate chunk, loaded on navigation
- **MidiConnection singleton** -- shared MIDI state across all modules
- **TypeScript throughout** -- full type coverage for Deluge XML elements

### Build

```bash
npm run build    # Production build to dist/
npm run preview  # Preview production build locally
```

## Credits

Original subprojects and MIDI protocol implementation by **Jamie Fenton** ([@jamiefaye](https://github.com/jamiefaye)). This unified app restructures and extends that work into a single cohesive application.

## License

MIT
