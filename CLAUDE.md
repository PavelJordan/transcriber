# CLAUDE.md

Read this first. It is the map. The detail lives in `docs/`.

## What this is

A **desktop app** that turns a screen/voice recording of a meeting into a clean,
structured Markdown report — without the audio ever leaving the machine.

The pipeline already works by hand today; the app just wraps it and adds the
Claude call:

1. **Record** a meeting (OBS → `.mp4`, or any audio/video file).
2. **Transcribe locally** with Whisper (`transcribe.py`). Nothing is uploaded.
3. **Report** — send only the *transcript text* to Claude, get back a structured
   report, exportable as **Markdown or PDF**.

The privacy story is the whole point: **the recording stays on the device.**
Only transcript text is ever sent anywhere, and only after the user clicks send.

### Why we are building it

The owner (a thesis student) uses this for supervisor consultations. The manual
flow (run `transcribe.py`, paste transcript into ChatGPT/Claude) saves a lot of
time and "nothing gets left out." Real sample outputs are kept **privately,
outside this repo** — they are the **quality bar** for the generated report.

## The stack (decided)

- **Tauri 2** shell — small binaries, real installers for a few other people.
- **React + TypeScript + Tailwind + shadcn/ui** frontend — pretty, familiar.
- **`transcribe.py` as a sidecar** — keep the working faster-whisper / CUDA path.
  Exposes **Device** (Auto / GPU / CPU) and **Model** (tiny…large-v3) dropdowns.
- **Anthropic API** for the report — default **Sonnet 4.6**, switchable to
  Haiku 4.5 (cheap) / Opus 4.8 (best). Token lives in the **OS keychain**.
  Report exports as **Markdown or PDF**.

Full reasoning, alternatives we rejected, and the build phases: **`docs/PLAN.md`**.

## How we work here

- **Grug-brain.** Complexity is the enemy. Less code is better code. We do not
  build for an imagined future. Read **`docs/STYLE.md`** before writing code.
- **Review with fresh eyes.** After a meaningful chunk of code, run the
  fresh-context reviewers (`minimalist`, `consistency`, `grug`). They have no
  memory of why you wrote it that way — that is the point. See **`docs/REVIEW.md`**.
- Permissions are set to bypass on this machine; act without asking for tool
  approval, but still confirm anything destructive or outward-facing in chat.

## Two harnesses: Claude Code and `pi`

This project is driven by both Claude Code **and** `pi` (the subscription-billed
agent harness). They read different context files, so we keep one source of truth:

- `AGENTS.md` is a **symlink to `CLAUDE.md`** — `pi` reads `AGENTS.md`, Claude Code
  reads `CLAUDE.md`, both get the same map. Edit `CLAUDE.md`; never duplicate.
- `pi` is configured globally (`~/.pi/agent/settings.json`) to use a
  `claude-code-subscription-provider`, so it bills the **Claude subscription, not
  the API**. Just run `pi` in this folder. (The app's *own* Claude calls still use
  the user's Anthropic API token — that's a separate thing from the harness.)

## Repo map

| Path | What |
|---|---|
| `transcribe.py` | Local Whisper transcription. Reused as the app's sidecar. |
| `docs/PLAN.md` | Architecture, rejected options, phased build plan, **current status**. |
| `docs/STYLE.md` | Grug-brained code style. Read before coding. |
| `docs/REVIEW.md` | The fresh-context review loop and when to run it. |
| `.claude/agents/` | The reviewer subagents. |
| `app/` | The Tauri app (created in Phase 1). |

## Current status

**Phases 1–4 done; Phase 5 Stage A done (code + review), pending live-run.** The full
pipeline works in `app/`: Transcribe (live log) → Report (keychain token, streamed
Anthropic report, Markdown preview, export `.md` **and PDF**, or **Copy prompt** for
the no-API path) → Settings + bilingual (cs default) UI/output. **Phase 5 Stage A**
swapped the shipped transcription engine from the faster-whisper **Python** sidecar
to a **whisper.cpp** native sidecar, *behind the unchanged UI*: the Rust `transcribe`
command downloads the ggml model on first use (from `ggerganov/whisper.cpp` on HF),
converts input → 16 kHz wav via system **ffmpeg**, spawns the `whisper-cli`
`externalBin` sidecar, and parses its output into the same `start`/`segment`/`done`
events (the UI only gained a `download` progress variant). The now-meaningless device
picker was removed. `transcribe.py` stays as the owner's local dev/GPU path. `npm run
build` + `cargo clippy` green; two fresh-eyes review rounds (Opus high). **Not yet
live-run through the GUI** — see the live-run checklist + the full detail in the
**Status** section of `docs/PLAN.md` (the source of truth across sessions). Next:
Phase 5 Stage B (GPU variants + CI + bundle ffmpeg).

> Git: push over **HTTPS via the `glab` credential helper**, not SSH (the local
> SSH keys aren't authorized for the `hissetta` namespace). Already configured.
