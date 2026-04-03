# Deluge Web Tools — Developer Guide

## Project Structure

```
app/src/
├── lib/
│   ├── midi/          MIDI connection singleton (WebMIDI + SysEx protocol)
│   ├── xml/           Deluge XML parser/serializer (firmware 1.x–4.x)
│   └── types/         TypeScript interfaces for all preset/song types
├── modules/
│   ├── preset-manager/    Browse, load, diff presets
│   ├── file-browser/      SD card file operations
│   ├── preset-editor/     Parameter detail view
│   ├── param-docs/        Searchable parameter reference
│   ├── display-mirror/    OLED + 7-segment canvas rendering
│   ├── perf-trace/        Debug event visualization
│   ├── debug-tools/       Memory read/write/watch + memory map
│   └── wave-editor/       (Coming soon)
├── components/            Shared components (MidiStatus, StatusBar)
├── App.vue                App shell with sidebar navigation
└── router.ts              Hash-based router with lazy-loaded modules
```

## Adding a New Module

1. Create a directory under `src/modules/your-module/` with a root Vue component (e.g. `YourModule.vue`).
2. Add a lazy-loaded route in `src/router.ts`:
   ```ts
   {
     path: '/your-module',
     component: () => import('./modules/your-module/YourModule.vue'),
   }
   ```
3. Add a navigation entry in `App.vue` sidebar.
4. Use `lib/midi/` for Deluge communication. The MIDI connection is a shared singleton — import and use it directly.

## Updating the Parameter Database

The parameter data lives in `src/modules/param-docs/data/parameters.json`. To regenerate it from a local firmware checkout:

```bash
node scripts/extract-parameters.js /path/to/DelugeFirmware > app/src/modules/param-docs/data/parameters.json
```

This parses param IDs, XML tags, display names, enum values, defaults and menu paths from the firmware source. In production, a GitHub Action (`.github/workflows/update-params.yml`) runs this weekly and commits changes automatically.

## Build

```bash
npm install
npm run dev        # Dev server with HMR
npm run build      # Production build to dist/
npm run preview    # Preview production build locally
```

## Deploy

Production builds are deployed automatically to GitHub Pages on push to `main` via `.github/workflows/deploy.yml`. The build output in `dist/` is published directly.

## Tech Stack

- Vue 3 + Composition API + TypeScript
- Vite
- Tailwind CSS v4
- Vue Router (hash mode, lazy-loaded modules)
- Web MIDI API (SysEx)
