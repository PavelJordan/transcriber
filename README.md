# transcriber

Desktop app that turns a meeting recording into a clean, structured report —
**locally**. Audio never leaves the device; only the transcript text is sent to
Claude to write the report (export as Markdown or PDF).

Pipeline: `recording → local Whisper transcript → Claude report`.

## Docs

- **[CLAUDE.md](CLAUDE.md)** — start here (the map; also the source for `AGENTS.md`).
- **[docs/PLAN.md](docs/PLAN.md)** — architecture, decisions, phased build, status.
- **[docs/STYLE.md](docs/STYLE.md)** — code style (grug-brain: keep it simple).
- **[docs/REVIEW.md](docs/REVIEW.md)** — the fresh-context review loop.

## Status

Planning done; app not scaffolded yet. Next: Phase 1 in `docs/PLAN.md`.
