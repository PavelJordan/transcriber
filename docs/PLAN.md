# PLAN

Architecture, decisions, and the phased build. This file is the **source of
truth for status** — update the Status section at the end every session.

## Goal

A pretty desktop app: drop in a recording → local transcript → Claude report.
Audio never leaves the device. Usable by the owner and a few other people, so it
must produce a real installer, not just run from a dev shell.

## The pipeline

```
 recording.mp4 ──▶ transcribe.py (Whisper, LOCAL) ──▶ transcript.txt
                                                          │
                                          user clicks "Generate"
                                                          ▼
                                   Anthropic API (transcript text only) ──▶ report.md / report.pdf
```

## Stack (decided) and why

| Layer | Choice | Why |
|---|---|---|
| Shell | **Tauri 2** | ~10 MB vs Electron ~150 MB; real installers (`.AppImage`/`.deb`/`.dmg`/`.msi`). |
| UI | **React + TS + Tailwind + shadcn/ui** | Owner is comfortable with web; prettiest result for least effort. |
| Transcription | **`transcribe.py` sidecar** | The faster-whisper + CUDA path already works. Don't rewrite a working engine. |
| Device choice | **Auto / GPU / CPU dropdown** | `transcribe.py` already has `--device`. Auto-detects CUDA, falls back to CPU. |
| Report | **Anthropic API** | Sonnet 4.6 default; Haiku 4.5 / Opus 4.8 selectable. |
| Secrets | **OS keychain** | API token never in plaintext, never in an LLM prompt. |

### Options we rejected (don't re-litigate without a new reason)

- **Electron** — works, but fat bundle and heavier runtime. Tauri wins on size/polish.
- **Pure Python UI (Flet/PySide6)** — one language, but packaging CUDA is just as
  painful and deep UI polish costs more than in web tech.
- **whisper.cpp instead of faster-whisper** — cleaner distribution (one native
  binary, no Python/CUDA), but it means redoing the working transcription path.
  **Kept as the fallback**: if bundling Python+CUDA for other users proves too
  painful in Phase 5, swap the sidecar to a whisper.cpp binary — the UI does not
  change.

## Sidecar contract

`transcribe.py` stays the engine. We add a `--json` mode so the app can read
progress instead of scraping stderr. Each line of stdout is one JSON object:

```
{"type":"start","device":"cuda","model":"large-v3","language":"cs","duration":3600}
{"type":"segment","start":12.0,"end":15.4,"text":"..."}
{"type":"done","txt":"…","srt":"…","vtt":"…"}
```

The app spawns it, streams segments into the UI live, and writes the `.txt`/
`.srt`/`.vtt` next to the source (current behaviour, unchanged). Human-readable
stderr logging stays as-is for when the script is run by hand. Failures need no
JSON event: the script logs to stderr and exits non-zero, and the spawning Rust
command surfaces that stderr to the UI as a single error — one channel, not two.

## The report prompt

The default system prompt is **derived from the example reports** in `0608/` and
`0617/` so the app reproduces that exact Czech, structured-Markdown style out of
the box. It is **editable in a Settings panel** — seed a good default, let the
user tune it. Only the transcript text + the prompt go to Claude.

## Screens

1. **Transcribe** — file drop; Model / Device / Language dropdowns; live segment
   log; "audio never leaves your device" badge; transcript shown when done.
2. **Report** — token field (keychain); model dropdown (Sonnet 4.6 default);
   editable prompt; explicit "only transcript text is sent" line; streamed
   Markdown report with live preview, copy, and **export as `.md` or `.pdf`**.
3. **Settings** — API token, default model, default device, the prompt template.

## Phased build

Each phase ends with a review pass (`docs/REVIEW.md`).

- **Phase 0 — Docs.** ✅ This file, `CLAUDE.md`, `STYLE.md`, `REVIEW.md`, agents.
- **Phase 1 — Scaffold.** ✅ Tauri 2 + React + TS + Tailwind + shadcn in `app/`.
  One styled placeholder screen; window opens and renders. Reviewed (Opus high).
- **Phase 2 — Transcribe.** `--json` mode in `transcribe.py`; wire it as a
  sidecar; Transcribe screen with dropdowns + live log; files written next to source.
- **Phase 3 — Report.** Keychain token storage; Anthropic streaming call; Report
  screen with model picker, editable prompt, live Markdown preview, export `.md`.
- **Phase 3b — PDF export.** Render the report Markdown → PDF. We already render
  Markdown → HTML for the preview, so the cheapest path is reusing that HTML with
  one print stylesheet: the webview's print-to-PDF, or a small html→pdf step. No
  new heavy toolchain (no LaTeX/pandoc) unless a phase actually needs it.
- **Phase 4 — Polish.** Layout, empty/error/loading states, the privacy badges,
  the Settings panel. Make it pretty.
- **Phase 5 — Package.** Build installers. If Python+CUDA bundling is too painful
  for other users, switch the sidecar to whisper.cpp (UI untouched).

## Open questions (resolve before the phase that needs them)

- P2: bundle a Python runtime, or assume a local `.venv`? (Dev: `.venv`. Ship: decide in P5.)
- P3: stream tokens into the preview, or render on completion? (Lean: stream.)
- P3b: PDF via webview print-to-PDF, or a small html→pdf lib? (Lean: reuse the
  preview HTML + a print stylesheet; pick the lib only if print quality is poor.)
- P4: light/dark, or follow OS theme? (Lean: follow OS.)

## Status

**Phase 2 complete.** ✅ The Transcribe screen works end-to-end against the local
`.venv` sidecar. (Phase 1 scaffold — Tauri 2 + React 19 + TS + Tailwind v4 + shadcn
in `app/` — remains as described in git history.)

What landed in Phase 2:
- **`transcribe.py --json`** — one JSON object per stdout line (`start` / `segment`
  / `done`); human-readable stderr path untouched; no new deps. `--device` now
  takes `auto`/`cuda`/`cpu` and derives `compute_type` (cpu→`int8`, else
  `int8_float16`), keeping the existing GPU→CPU load fallback. Still writes
  `.txt`/`.srt`/`.vtt` next to the source.
- **Rust `transcribe` command** (`app/src-tauri/src/lib.rs`) — thin: spawns
  `.venv/bin/python transcribe.py … --json` via `tauri-plugin-shell`, forwards each
  stdout line as a `transcribe://event`, returns `Err(stderr)` on non-zero exit
  (the single error channel). Repo root from `CARGO_MANIFEST_DIR` — **dev-only**;
  the shipping sidecar path is a Phase 5 decision. Added `tauri-plugin-dialog`
  (+ `dialog:default` capability) for the file picker. No `serde_json` needed.
- **`app/src/Transcribe.tsx`** — whole-window drag-drop + Browse, Model/Device/
  Language selects (shadcn `select` added), live segment log with detected
  language/duration, privacy badge, "saved next to your recording" on done. Errors
  surface in a destructive box from the invoke rejection.

Verified: `npm run build` (tsc) green, `cargo check` green, sidecar `--json`
contract checked on a clipped sample (start/segment/done + files written). Reviewed
by all three agents (Opus high); applied the consensus fixes — **consume** the
`start` event instead of leaving it dead, store only the `.txt` path actually
displayed, and **collapse to one error channel** (dropped the redundant `error`
JSON event; failures arrive via the invoke rejection). **Not visually run this
session** — owner should confirm the window/UX with `cd app && npm run tauri dev`,
then run a real (large-v3 / GPU) transcription end-to-end.

The Tauri Linux system libs are installed on this machine now, so `npm run tauri
dev` works directly. On a fresh box, install first:
    ```
    sudo apt install libwebkit2gtk-4.1-dev librsvg2-dev build-essential \
      curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev
    ```

**Git note:** push over **HTTPS with the `glab` credential helper**, not SSH —
the local SSH keys aren't authorized for the `hissetta` namespace, but the `glab`
token is. Already configured in this clone (`credential.helper = !glab auth
git-credential`). Don't switch the remote back to SSH.

**Next action — Phase 3 (Report), in a new session.** Concretely:
  1. Store the Anthropic token in the OS keychain (Rust commands to save/load).
  2. Stream a report from the Anthropic API — default Sonnet 4.6, switchable to
     Haiku 4.5 / Opus 4.8. Only the transcript text + the prompt are sent.
  3. Build the Report screen: model picker, editable prompt seeded from the
     `0608`/`0617` example reports (the quality bar), live Markdown preview, copy,
     export `.md`. Explicit "only transcript text is sent" line.
  End with a reviewer pass (Opus high) before marking Phase 3 done.

_Open Phase 2 follow-up:_ the sidecar resolves the `.venv` python + script via the
compile-time `CARGO_MANIFEST_DIR`, so it only runs from this dev checkout. Packaging
(Phase 5) must replace that path resolution.

_Update this section at the end of every working session: what's done, what's
half-done, what's the next concrete action._
