# CLAUDE.md

Read this first. It is the map. The detail lives in `docs/`.

## What this is

A **desktop app** that turns a screen/voice recording of a meeting into a clean,
structured Markdown report — without the audio ever leaving the machine:

1. **Record** a meeting (OBS → `.mp4`, or any audio/video file).
2. **Transcribe locally** with whisper.cpp. Nothing is uploaded.
3. **Report** — send only the *transcript text* to Claude, get back a structured
   report, exportable as **Markdown or PDF**.

The privacy story is the whole point: **the recording stays on the device.**
Only transcript text is ever sent anywhere, and only after the user clicks send.

### Why it exists

The owner (a thesis student) uses this for supervisor consultations. The manual
flow (transcribe, paste transcript into ChatGPT/Claude) saves a lot of time and
"nothing gets left out." Real sample outputs are kept **privately, outside this
repo** — they are the **quality bar** for the generated report.

## The stack

- **Tauri 2** shell — small binaries, real installers.
- **React + TypeScript + Tailwind + shadcn/ui** frontend — pretty, familiar.
- **whisper.cpp** (`whisper-cli`) + **ffmpeg** bundled as native sidecars — local
  transcription, no Python/CUDA runtime to ship.
- **Anthropic API** for the report — default **Sonnet 4.6**, switchable to
  Haiku 4.5 (cheap) / Opus 4.8 (best). Token lives in the **OS keychain**.
  Report exports as **Markdown or PDF**.

Full reasoning, alternatives, and distribution: **`docs/ARCHITECTURE.md`**.

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
| `app/` | The Tauri app (React frontend + Rust backend in `app/src-tauri`). |
| `transcribe.py` | The owner's local faster-whisper / GPU path. Not part of the shipped app. |
| `docs/ARCHITECTURE.md` | How the app is built and why; distribution; possible improvements. |
| `docs/STYLE.md` | Grug-brained code style. Read before coding. |
| `docs/REVIEW.md` | The fresh-context review loop and when to run it. |
| `.claude/agents/` | The reviewer subagents. |
| `.github/workflows/release.yml` | The release matrix (source of truth for builds). |

> Git: the canonical home is **GitHub** (`github` remote, SSH) — push with
> `git push github main`. A GitLab `origin` mirror exists but is stale; treat
> GitHub as the truth.
