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
{"type":"error","message":"…"}
```

The app spawns it, streams segments into the UI live, and writes the `.txt`/
`.srt`/`.vtt` next to the source (current behaviour, unchanged). Human-readable
stderr logging stays as-is for when the script is run by hand.

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
- **Phase 1 — Scaffold.** Tauri 2 + React + TS + Tailwind + shadcn in `app/`.
  Window opens, one styled placeholder screen. Runs against the existing `.venv`.
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

**Phase 0 complete.** Docs + reviewer agents written; repo pushed to
`gitlab.com:hissetta/transcriber` (`main`). Nothing scaffolded yet.

**Git note:** push over **HTTPS with the `glab` credential helper**, not SSH —
the local SSH keys aren't authorized for the `hissetta` namespace, but the `glab`
token is. Already configured in this clone (`credential.helper = !glab auth
git-credential`). Don't switch the remote back to SSH.

**Next action:** Phase 1 — scaffold the Tauri app in `app/`.

_Update this section at the end of every working session: what's done, what's
half-done, what's the next concrete action._
