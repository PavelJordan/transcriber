# Architecture

How the app is built and why. For code style see `STYLE.md`; for the review loop
see `REVIEW.md`.

## Goal

A desktop app: drop in a meeting recording → get a local transcript → turn it into
a clean, structured report with Claude. The audio never leaves the device; only the
transcript *text* is ever sent anywhere, and only when the user asks for it. It must
produce real installers, not just run from a dev shell.

## The pipeline

```
 recording.mp4 ──▶ whisper.cpp (LOCAL) ──▶ transcript (in the app)
                                               │
                                user clicks "Generate"
                                               ▼
                        Anthropic API (transcript text only) ──▶ report.md / report.pdf
```

## Stack and why

| Layer | Choice | Why |
|---|---|---|
| Shell | **Tauri 2** | ~10 MB vs Electron ~150 MB; real installers (`.AppImage`/`.deb`/`.dmg`/`.msi`). |
| UI | **React + TS + Tailwind + shadcn/ui** | Web tech the owner is comfortable with; prettiest result for least effort. |
| Transcription | **whisper.cpp** (`whisper-cli` sidecar) | One self-contained native binary, no Python/CUDA runtime to bundle. ggml weights = the same Whisper accuracy. |
| Decoding | **ffmpeg** (bundled sidecar) | Decodes any input to the 16 kHz mono PCM `whisper-cli` expects. |
| Report | **Anthropic API** | `claude-sonnet-4-6` default; `-haiku-4-5` / `-opus-4-8` selectable. |
| Secrets | **OS keychain** | The API token never lands in a file or an LLM prompt. |

### Alternatives we weighed

- **Electron** — works, but a fat bundle and heavier runtime. Tauri wins on size and
  polish.
- **Pure-Python UI (Flet / PySide6)** — one language, but packaging is just as
  painful and deep UI polish costs more in Python than in web tech.
- **faster-whisper (Python) as the engine** — it works and has a CUDA path, but
  shipping it means bundling Python + CUDA for every user. whisper.cpp is one native
  binary with the same weights, so it ships cleanly. `transcribe.py` stays as the
  owner's local dev / GPU path (see below), not part of the installed app.

## Transcription flow (Rust ↔ sidecars)

`app/src-tauri/src/lib.rs` exposes a single `transcribe` command that the UI calls
and then listens to `transcribe://event` for. It runs three steps, in order, sharing
one error channel (the command's `Err`) and one cancellation flag:

1. **`ensure_model`** — the chosen ggml model is downloaded on first use from
   `ggerganov/whisper.cpp` on Hugging Face into the app data dir, then reused. A
   partial download writes to `.part` and is only renamed into place once complete,
   so an interrupted fetch is never cached as a finished model.
2. **`convert_to_wav`** — the bundled `ffmpeg` sidecar decodes the input to 16 kHz
   mono PCM. `-fflags +bitexact` keeps the WAV header at 44 bytes so the duration
   maths stays simple.
3. **`run_whisper`** — spawns the `whisper-cli` sidecar and translates its output
   into the events the UI already understands: `start` (model / language / duration),
   one `segment` per `[ts --> ts] text` line, and `done`. Auto-detected language is
   read off `whisper-cli`'s stderr line; a forced language emits `start` up front.

`cancel_transcribe` flips one `AtomicBool` and kills the current child, so it stops a
running conversion or transcription **and** an in-flight model download (which has no
child to kill). The command assumes one run at a time — the UI enforces it by
disabling start while running.

Progress is one extra `download` event (percent) reused for both the model and, on
the CUDA build, the runtime libs.

## Distribution

The app ships **one installer per acceleration backend**, each self-contained
(whisper-cli + ffmpeg bundled as Tauri `externalBin` sidecars):

| Variant | OS | Acceleration |
|---|---|---|
| CPU | Linux / Windows | CPU |
| Metal | macOS (Apple Silicon) | GPU (Metal, built in) |
| CUDA | Linux | GPU (NVIDIA) |

`.github/workflows/release.yml` is the source of truth: on a `v*` tag it builds the
matrix on hosted runners (Tauri can't cross-compile installers — each OS builds on
its own runner) and attaches the installers to a draft GitHub release.

The **CUDA** variant keeps the installer small by *not* bundling the ~600 MB
cuBLAS/cudart libs: they're fetched on first use into the app data dir (mirroring the
model download) and put on the sidecar's `LD_LIBRARY_PATH`. The CI uploads those libs
to the matching release, so the download URL is pinned to the crate version. CUDA
ships as `.deb`/`.rpm` only — AppImage's `linuxdeploy` ldd-scans the rpath-stripped
sidecar, can't resolve the runtime-fetched libs, and aborts.

The builds are **unsigned** (a small open-source project), so first launch trips
macOS Gatekeeper / Windows SmartScreen; the README documents the right-click → Open /
"Run anyway" step.

`transcribe.py` is the original faster-whisper path with a CUDA setup the owner
already has. It stays for local hand-use and GPU work; it is not part of the shipped
app. It supports a `--json` mode (one JSON object per stdout line) so it can drive the
same UI events if ever wired back in; run without `--json` it writes `.txt`/`.srt`/
`.vtt` next to the source and logs human-readable progress.

## The report prompt

The app ships several **output types**, each a tuned system prompt
(`app/src/reportTypes.ts`): *Meeting report* (default, reproduces a Czech,
structured-Markdown style), *Lecture notes* (nudges the model to flag likely
mis-hearings of numbers/names/terms rather than copy them in — lecture audio is
worse), *Summary*, and *Action items*. The user picks the type on the Report screen
and can tweak that type's prompt per run; the default type lives in Settings. Only the
chosen prompt plus the transcript text go to Claude. Prompts are data, not code.

Reports stream from the Anthropic Messages API (`generate_report`): `system` = the
prompt, one user message = the transcript, parsed from the SSE stream into
`report://delta` text events. Raw bytes are buffered and only whole lines decoded, so
a multibyte character split across network chunks is never corrupted.

## Localization

Bilingual, **Czech default**, with two independent settings (both in Settings):

- **App language** (`prefs.appLang`) — the UI chrome. Strings live in a typed
  dictionary (`app/src/i18n.ts`); `cs` must match `en`'s key set.
- **Output language** (`prefs.outputLang`) — the language Claude writes the report
  in. Each output type carries a prompt per language (`prompt: { cs, en }`); the
  Czech prompts are the quality bar, kept verbatim. The directive is explicit about
  the cross-language case ("write the entire output in X even if the transcript is in
  another language — translate it"), because a bare "write in English" let Claude
  mirror the Czech transcript instead.

A third language is separate: the **transcription** language (Whisper: auto / cs / en)
on the Transcribe screen — what the *audio* is in. Backend/diagnostic error text and
the app name are intentionally not translated.

## Screens

1. **Transcribe** — file drop; model and language dropdowns; a live segment log with
   a progress bar; Cancel; an "audio never leaves your device" badge; the transcript
   when done. No device picker — each installer is built for one backend, so a runtime
   device choice would be meaningless.
2. **Report** — an output-type button group with a one-line description; an editable
   prompt; then two paths: **(a) API** — model dropdown, streamed Markdown report with
   live preview, copy, and export as `.md` or PDF; **(b) no API** — a **Copy prompt**
   button that puts the prompt + transcript on the clipboard to paste into any chat
   AI. An explicit "only transcript text leaves the device" line.
3. **Settings** — API token, default model, default output type, app language, output
   language.

PDF export uses no PDF library: an `@media print` stylesheet plus the webview's
`window.print()`. The report is rendered into a hidden, theme-free copy via a portal;
print hides the app and shows that copy, so the PDF is the report alone.

The theme follows the OS (`main.tsx` toggles `.dark` from `matchMedia`).

## Possible improvements

None of these are needed for the app to do its job; build them only if a real need
shows up.

- **Windows CUDA** — the one backend not yet built. Same shape as Linux CUDA, but
  Windows-specific: prepend the lib dir to the spawned process's `PATH` (no
  `LD_LIBRARY_PATH`), per-OS DLL names (`cudart64_12.dll`, `cublas64_12.dll`,
  `cublasLt64_12.dll`), a `windows-cuda` matrix entry with a distinct `productName` so
  it doesn't collide with `windows-cpu`. Unverifiable without a Windows + NVIDIA box.
- **Build-check CI** — today only tags build, so nothing catches a broken build until
  a release. A light push/PR workflow (one OS, CPU, `cargo clippy` + `npm run build` +
  a dry `tauri build`) would surface breakage early.
- **Intel macOS** — only `aarch64` (Metal) is built; add an `x86_64-apple-darwin` CPU
  entry only if someone actually has an Intel Mac.
- **Code signing / notarization** — only if distribution widens past "a few people who
  can click Run anyway" (Apple Developer $99/yr + notarize; Windows cert ~$100–400/yr;
  both add CI secrets).
- **Auto-update** (Tauri updater) — probably never for this audience; they re-download.
- **Bundled models** — first-run download keeps installers small; a small bundled
  default could be added for fully-offline first use.
- **Save transcript to disk** — the app keeps the transcript in memory only. If a user
  wants it on disk, add an explicit "Save transcript" rather than writing it silently.
- **macOS ffmpeg source** — the arm64 static build has no official upstream and is
  hand-pinned (osxexperts); bump or replace it if it disappears.
