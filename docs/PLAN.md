# PLAN

Architecture, decisions, and the phased build. This file is the **source of
truth for status** — update the Status section at the end every session.

## Goal

A pretty desktop app: drop in a recording → local transcript → Claude report.
Audio never leaves the device. Usable by the owner and a few other people, so it
must produce a real installer, not just run from a dev shell.

## The pipeline

```
 recording.mp4 ──▶ transcribe.py (Whisper, LOCAL) ──▶ transcript (in app)
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
{"type":"done"}
```

The app spawns it and streams segments into the UI live; the transcript is
assembled **in the app** from those `segment` events and handed to the Report
screen. In `--json` (app) mode the script **writes no files** — the recording's
folder stays clean (see Phase 3d). Run by hand *without* `--json`, the script still
writes `.txt`/`.srt`/`.vtt` next to the source and logs human-readable progress to
stderr, unchanged. Failures need no JSON event: the script logs to stderr and exits
non-zero, and the spawning Rust command surfaces that stderr to the UI as a single
error — one channel, not two.

## The report prompt

The default system prompt is **derived from the example reports** in `0608/` and
`0617/` so the app reproduces that exact Czech, structured-Markdown style out of
the box. It is **editable in a Settings panel** — seed a good default, let the
user tune it. Only the transcript text + the prompt go to Claude.

## Screens

1. **Transcribe** — file drop; Model / Device / Language dropdowns; live segment
   log; "audio never leaves your device" badge; transcript shown when done.
2. **Report** — two paths off the same editable prompt: **(a) API** — token field
   (keychain), model dropdown (Sonnet 4.6 default), streamed Markdown report with
   live preview, copy, and **export as `.md` or `.pdf`**; **(b) no API** — a
   **Copy prompt** button that puts the prompt + transcript on the clipboard to
   paste into any chat AI. Explicit "only transcript text leaves the device" line.
3. **Settings** — API token, default model, default device, the prompt template.

## Phased build

Each phase ends with a review pass (`docs/REVIEW.md`).

- **Phase 0 — Docs.** ✅ This file, `CLAUDE.md`, `STYLE.md`, `REVIEW.md`, agents.
- **Phase 1 — Scaffold.** ✅ Tauri 2 + React + TS + Tailwind + shadcn in `app/`.
  One styled placeholder screen; window opens and renders. Reviewed (Opus high).
- **Phase 2 — Transcribe.** `--json` mode in `transcribe.py`; wire it as a
  sidecar; Transcribe screen with dropdowns + live log; files written next to source.
- **Phase 3 — Report.** ✅ Keychain token storage; Anthropic streaming call; Report
  screen with model picker, editable prompt, live Markdown preview, export `.md`.
- **Phase 3b — PDF export.** ✅ Render the report Markdown → PDF. We already render
  Markdown → HTML for the preview, so the cheapest path is reusing that HTML with
  one print stylesheet: the webview's print-to-PDF, or a small html→pdf step. No
  new heavy toolchain (no LaTeX/pandoc) unless a phase actually needs it.
- **Phase 3c — Copy-prompt (no-API path).** ✅ A **Copy prompt** button that puts the
  editable prompt + the transcript on the clipboard as one paste-ready block, so
  users without an Anthropic key (or who don't want per-token billing) can paste it
  into ChatGPT / Claude.ai / Gemini and get the same report. This is the original
  manual flow (`transcribe.py` → paste into a chat), made one click. Makes the
  **token optional**: only the API "Generate" path needs a key; "Copy prompt" works
  with none. Privacy is unchanged — still only transcript text leaves the device,
  still user-initiated (copy, then the user pastes). Cheap: a clipboard concat in
  TS, no Rust, no new deps.
- **Phase 3d — No workspace clutter.** ✅ Transcribing from the app must **not** drop
  files in the user's folders. The app already builds the transcript in memory from
  the `segment` events, so `--json` mode stops writing `.txt`/`.srt`/`.vtt`; the
  `done` event loses its file paths and the Transcribe screen drops its "saved next
  to your recording" line. In app mode the script doesn't even **compute**
  `.srt`/`.vtt` — they're only useful as subtitle files the app never surfaces, so
  no speculative work (revive only if a phase actually needs subtitles). The
  standalone script (run by hand, no `--json`) keeps writing all three. If someone
  wants the transcript on disk, add an explicit "Save transcript" later — don't
  write it silently.
- **Phase 4 — Polish.** Layout, empty/error/loading states, the privacy badges,
  the Settings panel. Make it pretty.
- **Phase 5 — Package.** Build installers. If Python+CUDA bundling is too painful
  for other users, switch the sidecar to whisper.cpp (UI untouched).

## Open questions (resolve before the phase that needs them)

- P2: bundle a Python runtime, or assume a local `.venv`? (Dev: `.venv`. Ship: decide in P5.)
- P3: stream tokens into the preview, or render on completion? (Lean: stream.)
- P3b: PDF via webview print-to-PDF, or a small html→pdf lib? (Lean: reuse the
  preview HTML + a print stylesheet; pick the lib only if print quality is poor.)
- P3c: one "Copy prompt" button (prompt + transcript), or also "Copy transcript
  only"? (Lean: just prompt + transcript — the raw `.txt` already sits next to the
  recording for transcript-only. Format: the prompt, a `---` separator, then the
  transcript.) And: should a no-token user still land on the Report screen, or pick
  the path earlier? (Lean: one Report screen, token optional; don't add a chooser.)
- P3d: write nothing by default in app mode, or offer an opt-in "Save transcript"?
  (Lean: nothing by default; add an explicit save only if asked.)
- P4: light/dark, or follow OS theme? (Lean: follow OS.)

## Status

**Phase 4 — IN PROGRESS (design locked, nothing implemented yet).** Stopped right
after analysis, before writing any code. Working tree is clean (`git status` clean
at `3b96daf`). Resume from the plan below.

_Phase 4 design decisions (locked this session — don't re-litigate):_
- **New `Settings` screen** (third screen). Absorbs the Report screen's inline
  **token** field + inline **prompt** field. Holds: API token, default report
  model, default device, prompt template.
- **Persistence = `localStorage`** (no new dep, no Rust). Token stays in keychain.
  New module `app/src/prefs.ts`:
  - `REPORT_MODELS` (Claude list, moved out of `Report.tsx`) and `DEVICES`
    (Whisper device list, moved out of `Transcribe.tsx`) — now shared by 3 screens,
    so extraction is justified (third use). Whisper `MODELS`/`LANGUAGES` **stay**
    local to `Transcribe.tsx` (not in Settings).
  - `type Prefs = { model; device; prompt }`, `loadPrefs()`, `savePrefs()`.
    Defaults: `REPORT_MODELS[0].value`, `DEVICES[0].value`, `DEFAULT_REPORT_PROMPT`.
  - `loadPrefs` stays **offensive** (no try/catch on `JSON.parse` — our own data).
  - **Naming gotcha:** type/module is `prefs` (NOT `settings.ts`) on purpose — a
    `Settings.tsx` + `settings.ts` pair differs only by case and collides on macOS
    (Phase 5 builds `.dmg`). Screen = `Settings.tsx` (component `Settings`); config
    type = `Prefs`.
- **App owns prefs state** (`useState(loadPrefs)`), threads down, `updatePrefs(patch)`
  merges + `savePrefs` + setState (auto-save, no Save button for model/device/prompt;
  token keeps its own Save → keychain). Settings inputs are controlled off `prefs`.
- **Navigation:** add `showSettings` boolean in `App.tsx`. `if (showSettings)`
  render `<Settings>`; else current Transcribe/Report logic. Settings reachable via
  a **gear icon** (lucide `Settings`, import aliased `SettingsIcon`) in the header
  of both Transcribe and Report. Known tradeoff accepted: visiting Settings unmounts
  Report, so an in-progress generated report is lost on detour — fine for v1, lift
  state later only if it bites (no future code now).
- **Report.tsx:** drop token UI + inline prompt `<details>` + `DEFAULT_REPORT_PROMPT`
  import. New props `defaultModel`, `prompt`, `onSettings`. `model = useState(defaultModel)`
  (per-run picker kept, seeded from default). `prompt` from prop. Keep the editable
  **transcript** `<details>` (it's correction, not a setting). Still `has_token`-gate
  Generate; when no token, show a hint line linking to Settings; Copy prompt always works.
- **Transcribe.tsx:** import `DEVICES` from prefs (drop local copy). New props
  `defaultDevice`, `onSettings`. `device = useState(defaultDevice)`. Add gear to header.
- **Theme = follow OS** (`docs/PLAN.md` open question P4 → "follow OS"). In `main.tsx`:
  `matchMedia("(prefers-color-scheme: dark)")`, toggle `.dark` on
  `document.documentElement`, listen for `change`. ~6 lines, no React. The `.dark`
  CSS vars already exist in `index.css`; nothing toggles them today.
- **Polish:** consistent header (left: back+title / right: privacy badge + gear).
  Existing empty/loading/error states are already decent — light touch only.

_What's left = implement the above, then run all 3 reviewers (Opus high), then a
live `npm run tauri dev` pass (check: OS dark-mode toggles theme; Settings persists
across app restart; Report works with token moved to Settings; gear nav)._

_Caveat for next session:_ my ad-hoc lucide-icon existence check (deriving icon
filenames in `node_modules`) reported all icons MISSING — **ignore it, the check
was wrong** (filename derivation off). The icons are real: the working code already
imports `ArrowRight`/`CheckCircle2`/`ShieldCheck`/`ArrowLeft`/`Check`/`KeyRound`
from `lucide-react`. Just use them; `Settings` icon is standard too.

---

**Phase 3 + 3b + 3c + 3d complete.** ✅ The Report screen turns a transcript into a
streamed Markdown report via the Anthropic API and exports it as `.md` or PDF; the
token lives in the OS keychain and never enters the webview. Phase 3c adds the
no-API path: a **Copy prompt** button (prompt + transcript on the clipboard) makes
the token optional. Phase 3d stops the sidecar cluttering the user's folders: in
`--json` (app) mode it writes nothing — the transcript lives only in the app.
(Phase 2 — the Transcribe screen against the local `.venv` sidecar — and the
Phase 1 scaffold remain as in git history.)

What landed in Phase 3d (no workspace clutter):
- **`transcribe.py` branches on `--json`.** App mode iterates segments, emits a
  `segment` event each, then a bare `{"type":"done"}` — **no files written, no
  `.srt`/`.vtt` even computed** (the app never surfaces subtitles, so it's pure
  speculative work). The standalone path (no `--json`) is byte-for-byte unchanged:
  it still writes `.txt`/`.srt`/`.vtt` next to the source and logs per-segment
  progress to stderr. The two paths are separate branches by design (reviewers
  confirmed: don't merge — they do different work).
- **`done` event slimmed.** Lost its `txt`/`srt`/`vtt` paths; `SidecarEvent`'s
  `done` is now `{ type: "done" }` and the `Transcribe.tsx` `savedTxt` state (+ its
  set/reset sites) is gone — illegal states removed, no orphans. The Rust
  `transcribe` command is untouched (it only forwards stdout lines).
- **Transcribe screen.** The "Saved next to your recording: …" line is replaced by
  a "Transcript ready — it stays in the app." confirmation, gated on `status ===
  "done"`; the **Write report** button is unchanged (transcript = joined segments).
- **No silent disk writes by default.** If someone later wants the transcript on
  disk, add an explicit "Save transcript" — don't write it silently (plan's call).
- Verified: `npm run build` (tsc + vite) and `cargo check` green; `transcribe.py`
  parses. Reviewed by `minimalist` + `consistency` (Opus high) — unanimous "ship
  it"; the one shared nit (comment restated the code) was applied (trimmed to the
  *why*). `grug` couldn't run — Anthropic API `overloaded_error` on every retry
  (transient infra, not the code); rerun it next session for completeness.
  **Not yet visually run** — confirm the new "Transcript ready" line and that no
  files appear next to the source with `cd app && npm run tauri dev`.

What landed in Phase 3:
- **Keychain (Rust, `keyring` v4).** `save_token` / `has_token` commands store the
  Anthropic token under the app id. The token is read in Rust at generation time
  and **never crosses into the webview** — JS only ever *writes* a token or checks
  presence (`has_token` returns a bool, never the value).
- **Anthropic streaming (Rust `generate_report`).** POSTs `system`=prompt +
  `messages`=[transcript] to `/v1/messages` with `stream:true`, parses the SSE
  byte stream (buffering raw bytes, decoding only whole lines so split multibyte
  UTF-8 is never corrupted), and forwards each text delta as `report://delta`.
  Same shape as `transcribe`: events for streaming, **one error channel** (the
  invoke rejection — HTTP errors and stream `error` events both surface there).
  `reqwest 0.13` pinned to Tauri's version so only one copy compiles (rustls, no
  system OpenSSL). `export_report` writes the `.md` at a dialog-picked path.
- **`app/src/Report.tsx`.** Token field (password, → keychain) with a saved/Change
  state; model picker (Sonnet 4.6 default / Haiku 4.5 / Opus 4.8); editable prompt
  in a `<details>`; the transcript in a `<details>` labelled "only this is sent";
  live Markdown preview (`react-markdown` + `remark-gfm`, Tailwind `prose`); copy
  and **Export .md**. `App.tsx` routes Transcribe → Report on "Write report"
  (transcript = the joined segments, identical to the saved `.txt`).
- **PDF export (Phase 3b).** No PDF lib: an `@media print` stylesheet + the
  webview's `window.print()` (OS "Save as PDF"). "Export PDF" renders a hidden,
  theme-free `prose` copy of the report into `document.body` via a React portal;
  print hides `#root` and shows that copy, so the PDF is the report alone —
  paginated, no app chrome, robust to future layout nesting. Copy/Export are
  disabled while streaming so you can't export a half-written report.

What landed in Phase 3c (no-API / copy-prompt path):
- **`copyPrompt` in `Report.tsx`.** Writes ``${prompt}\n\n---\n\n${transcript}``
  to the clipboard (prompt, `---` separator, transcript) with a `promptCopied`
  feedback state — a faithful mirror of the existing `copyReport`. Pure TS, no
  Rust, no new deps, exactly as the plan called for.
- **"Copy prompt" button** (outline) sits beside the primary "Generate report" in
  the action row. It needs only a non-empty transcript (`disabled={!transcript
  .trim()}`) — **no token required**; only "Generate report" still gates on
  `tokenSaved`. The token label now reads "Anthropic API token (optional)".
- **Privacy unchanged:** still only transcript text leaves the device, still
  user-initiated (copy, then the user pastes into ChatGPT / Claude.ai / Gemini).
- Decisions taken from the plan's open questions: **one** button (prompt +
  transcript, not a separate transcript-only copy), and **one** Report screen with
  the token optional (no path-chooser). The two reviewer nits — define-order of
  `copyPrompt` and an optional `// why` on the flatten format — were both weighed
  and skipped as cosmetic/no-product-value (the `---` block is the plan's spec and
  obvious for a chat box with no system slot).
- Verified: `npm run build` (tsc + vite) green. Reviewed by all three agents
  (`minimalist` / `consistency` / `grug`, Opus high) — unanimous "ship it", no
  blocking findings. The clipboard mechanism (`navigator.clipboard.writeText`) is
  the same one already live-verified for "Copy" report in Phase 3, so the path is
  proven; a live click-through of the new button is worth a glance next dev run.

Verified: `npm run build` (tsc + vite) green, `cargo check`/`clippy` green (only a
pre-existing Phase 2 `collapsible_match` warning, left out of scope). Reviewed by
all three agents (Opus high) for both Phase 3 and 3b; applied the consensus fixes
— renamed bare verbs (`runReport`/`copyReport`/`parse_delta`), wrapped the
clipboard + export edges in try/catch, flattened the SSE loop, **deduped reqwest**
to Tauri's 0.13 (was pulling a second copy), and **portaled the print copy** so PDF
export doesn't couple to the DOM shape. **Live end-to-end run confirmed working
(2026-06-20):** transcribe → keychain token → streamed report → export `.md` and
PDF all verified by the owner.

_Phase 3 notes:_
- **Model ids confirmed working in the live run** (`claude-sonnet-4-6` /
  `-haiku-4-5` / `-opus-4-8`, in `Report.tsx`). If Anthropic renames one later, a
  wrong id surfaces as a clear "Anthropic API error (404)" in the UI.
- `max_tokens` is 8192 (safe across models; a summary fits). Raise if a long
  meeting's report ever truncates.
- Keychain needs a running Secret Service on Linux (present on this desktop).

Phase 2 (`transcribe.py --json` + the Rust `transcribe` command + the Transcribe
screen) and the Phase 1 scaffold are described in git history. Phase 2's own caveat
still stands: it was **not visually run** when written — confirm the window/UX and
a real (large-v3 / GPU) transcription with `cd app && npm run tauri dev`.

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

**Next action — implement Phase 4** per the locked design at the top of this
Status section (new `Settings` screen + `prefs.ts` localStorage persistence; move
token + prompt out of Report; gear-icon nav; follow-OS theme in `main.tsx`). Then
run the 3 reviewers and a live `npm run tauri dev` pass. Nothing is written yet —
start from a clean tree at `3b96daf`.

_Open Phase 2 follow-up:_ the sidecar resolves the `.venv` python + script via the
compile-time `CARGO_MANIFEST_DIR`, so it only runs from this dev checkout. Packaging
(Phase 5) must replace that path resolution.

_Update this section at the end of every working session: what's done, what's
half-done, what's the next concrete action._
