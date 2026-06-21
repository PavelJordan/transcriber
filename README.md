# transcriber

Desktop app that turns a meeting recording into a clean, structured report —
**locally**. The recording never leaves your device; only the transcript *text* is
sent to Claude to write the report (exportable as Markdown or PDF).

```
recording ──▶ local Whisper transcript ──▶ Claude report (.md / .pdf)
   (stays on device)        (in the app)       (only transcript text leaves)
```

## The privacy story (the whole point)

- The audio/video is transcribed **on your machine** with [whisper.cpp]; it is
  never uploaded.
- Only after you click **Generate** does the transcript *text* go to the Anthropic
  API — and only the transcript, nothing else.
- No Anthropic key? Use **Copy prompt** instead: it puts the prompt + transcript on
  your clipboard to paste into any chat AI. Still only transcript text leaves.
- The API token is stored in the **OS keychain**, never in a file or a prompt.

## Install

Grab the installer for your machine from the [latest release][releases]:

| Machine | File | Acceleration |
|---|---|---|
| Linux (x86-64) | `.AppImage` / `.deb` | CPU |
| Windows (x86-64) | `.msi` / `-setup.exe` | CPU |
| macOS (Apple Silicon) | `.dmg` | **Metal (GPU)** |

The builds are **unsigned** (this is a small open-source project), so the OS will
warn on first launch:

- **macOS:** right-click the app → **Open** → **Open** (or
  `xattr -dr com.apple.quarantine /Applications/transcriber.app`).
- **Windows:** SmartScreen → **More info** → **Run anyway**.

On first transcription the app downloads the chosen Whisper model (a few hundred MB)
into its app-data folder; later runs reuse it. NVIDIA (CUDA) builds are planned —
see `docs/PLAN.md`.

## How it works

1. **Transcribe** — drop in a recording; pick a model and language; watch the
   transcript stream in live.
2. **Report** — pick an output type (meeting report / lecture notes / summary /
   action items), tweak the prompt if you like, then **Generate** (API) or **Copy
   prompt** (no key). Export the result as Markdown or PDF.
3. **Settings** — API token, default model, default output type, app/output language
   (Czech or English).

ffmpeg and whisper.cpp ship inside the installer as bundled binaries — no system
install required.

## Build from source

Prerequisites: Node 20+, Rust (stable), and the Tauri system libraries. On
Debian/Ubuntu:

```bash
sudo apt install libwebkit2gtk-4.1-dev librsvg2-dev build-essential \
  curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev
```

The two sidecars (`whisper-cli`, `ffmpeg`) are gitignored and platform-specific;
produce them for your target triple (see `.gitignore` and
`.github/workflows/release.yml` — the source of truth). Then:

```bash
cd app
npm install
npm run tauri dev     # run
npm run tauri build   # installer for the current OS
```

`transcribe.py` is the original Whisper path (faster-whisper / CUDA), kept for local
dev and hand use; it is not part of the shipped app.

## Third-party

The bundled `ffmpeg` is a GPL static build ([johnvansickle], [BtbN], [osxexperts]);
its source is available from those projects. This app's own code is MIT
([`LICENSE`](LICENSE)).

## Docs

- **[CLAUDE.md](CLAUDE.md)** — the map (also the source for `AGENTS.md`).
- **[docs/PLAN.md](docs/PLAN.md)** — architecture, decisions, phased build, status.
- **[docs/STYLE.md](docs/STYLE.md)** — code style (grug-brain: keep it simple).
- **[docs/REVIEW.md](docs/REVIEW.md)** — the fresh-context review loop.

[whisper.cpp]: https://github.com/ggml-org/whisper.cpp
[releases]: https://github.com/PavelJordan/transcriber/releases
[johnvansickle]: https://johnvansickle.com/ffmpeg/
[BtbN]: https://github.com/BtbN/FFmpeg-Builds
[osxexperts]: https://www.osxexperts.net/
