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
time and "nothing gets left out." See real outputs in `0608/` and `0617/` —
those `.md` files are the **quality bar** for the generated report.

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
- `pi` is configured globally (`~/.pi/agent/settings.json`) to use redacted's
  `claude-code-subscription-provider`, so it bills the **Claude subscription, not
  the API**. Just run `pi` in this folder. (The app's *own* Claude calls still use
  the user's Anthropic API token — that's a separate thing from the harness.)

## Repo map

| Path | What |
|---|---|
| `transcribe.py` | Local Whisper transcription. Reused as the app's sidecar. |
| `0608/`, `0617/` | Real recordings + transcripts + **example reports** (quality bar). |
| `docs/PLAN.md` | Architecture, rejected options, phased build plan, **current status**. |
| `docs/STYLE.md` | Grug-brained code style. Read before coding. |
| `docs/REVIEW.md` | The fresh-context review loop and when to run it. |
| `.claude/agents/` | The reviewer subagents. |
| `app/` | The Tauri app (created in Phase 1). |

## Current status

**Not scaffolded yet.** Planning + docs done, repo pushed to
`gitlab.com:hissetta/transcriber`. Next action is Phase 1 in `docs/PLAN.md`. Keep
the **Status** section of that file updated as the source of truth across sessions.

> Git: push over **HTTPS via the `glab` credential helper**, not SSH (the local
> SSH keys aren't authorized for the `hissetta` namespace). Already configured.
