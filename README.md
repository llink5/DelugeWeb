# Deluge Web Tools

Browser-based tools for the Synthstrom Audible Deluge. No installation needed — just connect your Deluge via USB and open the link.

**[→ Open Deluge Web Tools](https://llink5.github.io/DelugeWeb/)**

Requires Community Firmware ≥ 1.3.0 and a WebMIDI-compatible browser (Chrome recommended).

## Features

- **Preset Manager** — Browse, compare and diff your synth/kit presets
- **File Browser** — Upload, download, rename and delete files on the SD card
- **Preset Editor** — View and edit sound parameters
- **Display Mirror** — See the Deluge OLED/7-Segment display in your browser
- **Performance Trace** — Visualize debug events and timing
- **Wave Editor** — Coming soon

## Usage

1. Connect your Deluge to your computer via USB
2. Open the link above in Chrome
3. Click "Connect" and select your Deluge
4. Done

## For Developers
git clone https://github.com/llink5/DelugeWeb.git
cd DelugeWeb/app
npm install
npm run dev

## Credits

Built on the original work by Jamie Fenton (vuefinder, midilib, viewScore, delugeclient, catnip).

## License

GPL-3.0
