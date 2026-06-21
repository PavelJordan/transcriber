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

The app ships several **output types**, each a tuned system prompt: *Meeting
report* (default, derived from the example reports in `0608/`/`0617/` so it
reproduces that Czech, structured-Markdown style), *Lecture notes* (nudges the
model to sanity-check numbers/names/terms — lecture audio is worse, so it must flag
likely mis-hearings rather than copy them in), *Summary*, and *Action items*. The
user picks the type on the Report screen (a visible button group) and can tweak
that type's prompt per run; the default type lives in Settings. Only the chosen
prompt + the transcript text go to Claude. Prompts are data in `reportTypes.ts`.

## Localization

The app is bilingual (**Czech default**, English optional), with two **independent**
settings — both in Settings, both default `cs`:
- **App language** (`prefs.appLang`) — the UI chrome. Strings live in `i18n.ts` (a
  typed dictionary; `cs` must match `en`'s key set). `App` builds `t =
  translator(appLang)` and threads it to every screen.
- **Output language** (`prefs.outputLang`) — the language Claude writes the report
  in. Each output type carries a prompt **per language** (`prompt: { cs, en }` in
  `reportTypes.ts`); the Czech prompts are kept verbatim (the quality bar), English
  added. Reflected in the prompt itself (not a bolt-on "write in X" directive), so
  headings/quotes are native to the chosen language.

A **third** language already existed and stays separate: the **transcription**
language (Whisper: auto/cs/en) on the Transcribe screen — what the *audio* is in.
Backend/diagnostic error text (Rust/Python) is left untranslated on purpose. The
app **name** ("transcriber" title on the first screen) is a brand, not translated.

The output-language directive in each prompt is **explicit about the cross-language
case** ("write the entire output in X even if the transcript is in another language
— translate it"). Without that, Claude mirrored the (Czech) transcript and ignored
a bare "write in English" in the system prompt. The system prompt is kept (correct
API usage); only the wording was strengthened — generation sends exactly the prompt
shown in Instructions / copied by Copy prompt (verified same `prompt` state).

## Screens

1. **Transcribe** — file drop; Model / Device / Language dropdowns; live segment
   log; "audio never leaves your device" badge; transcript shown when done.
2. **Report** — pick an **output type** (button group: Meeting report / Lecture
   notes / Summary / Action items), optionally tweak its prompt, then two paths:
   **(a) API** — model dropdown (Sonnet 4.6 default), streamed Markdown report with
   live preview, copy, and **export as `.md` or `.pdf`**; **(b) no API** — a
   **Copy prompt** button that puts the prompt + transcript on the clipboard to
   paste into any chat AI. Explicit "only transcript text leaves the device" line.
3. **Settings** — API token, default model, default device, default output type.

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
- **Phase 4 — Polish.** ✅ Settings screen (`prefs.ts` localStorage), gear nav,
  follow-OS theme, consistent headers. Plus four UX wins beyond the locked design:
  transcription **progress bar**, **resolved-device** label, **Cancel**
  transcription, and **hide the gear while running** (can't lose in-flight work).
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

**Phase 4 + report-types/CTA + localization rounds complete (code + review).** ✅
Not yet visually run — needs one live `npm run tauri dev` pass (see caveat at the end).

Localization round (on top of the others, same uncommitted tree):
- **`app/src/i18n.ts`** (new) — typed string dictionary (`Lang = "cs"|"en"`, `en`
  canonical, `cs: typeof en` enforces parity), `translator(lang) → t`. ~50 keys.
  Default language **Czech** everywhere (`prefs.appLang`/`outputLang` default `cs`).
- **Two independent language prefs**: `appLang` (UI) and `outputLang` (report),
  both selectable in Settings (Czech default). The pre-existing Whisper
  transcription language is kept separate.
- **Per-output-language prompts** — `reportTypes.ts` `prompt` is now `{ cs, en }`;
  Czech kept verbatim (quality bar), English added. Type labels/descriptions moved
  to i18n keys (`labelKey`/`descriptionKey`).
- **`t` threaded** to all screens; every hardcoded string replaced. `App` derives
  `t` from `appLang`; changing it in Settings re-renders live.
- Reviewed by all three agents (Opus high). Applied all three unanimous/clear
  findings: **extracted the duplicated `Field`** dropdown to `app/src/Field.tsx`
  (was 1 helper in Transcribe + 5 copies in Settings + 1 in Report — now one shared
  component with a `triggerClassName`; removed the direct `Select` imports from all
  three screens); **renamed `APP_LANGUAGES` → `LANGUAGES` and moved it to `prefs.ts`**
  (it drives both pickers; that's where option-lists live); **renamed the pref key
  `uiLang` → `appLang`** to match the "App language" label. Dismissed with reason:
  the English half is the explicit request (not future code); the audio-language
  endonyms staying duplicated (genuinely a different list, has `auto`); the
  half-applied i18n key-prefix scheme (cosmetic, names self-explanatory).
- **Follow-up fixes (live-test feedback):** (1) English output came out Czech — the
  system prompt *was* English (same `prompt` state as Copy prompt), Claude just
  mirrored the Czech transcript; strengthened each prompt's language line to demand
  translation regardless of transcript language. (2) Stopped translating the app
  name: `titleTranscribe` is "transcriber" in both languages.

This round (on top of Phase 4, same uncommitted tree):
- **Output types** (`app/src/reportTypes.ts`, new) — four tuned prompts: *Meeting
  report* (the old single prompt, now the default), *Lecture notes* (explicitly
  nudges the model to flag mis-heard numbers/names/terms and add a "K ověření"
  section — lecture audio is worse), *Summary*, *Action items*. Replaces the single
  `defaultPrompt.ts` (deleted). `prefs.prompt` → `prefs.reportType` (default type).
- **Report screen** now leads with a visible **Output type** button group +
  one-line description; selecting a type loads its prompt into the (still editable)
  Instructions `<details>` and **clears any report from the previous type** (a
  reviewer-caught stale-output bug). `reportType` is normalized through `typeFor`
  so a stale persisted value always highlights a real button.
- **Settings** swaps the free-text prompt editor for a **Default output type**
  select (beside default model/device). Per-type prompt editing is per-run on the
  Report screen, not persisted — deliberate (no per-type override map; less code).
- **Transcribe CTA fix** — the "Write report" button was below the fold under a long
  transcript log, so users missed it and re-ran transcription. **Proper fix:** the
  primary action now lives in the always-visible control row — when done it shows
  **Re-transcribe** (outline) + **Write report** (primary); the buried bottom block
  is gone.
- Reviewed by all three agents (Opus high). Applied: clear stale report on type
  switch, normalize `reportType` on init, trim the `reportTypes.ts` header comment.
  Dismissed with reason: the four types are a direct user request (not future
  code); the button group is a deliberate divergence from the Select idiom so all
  types are *visible* (the whole point); skipped a `ReportTypeValue` union (the
  value comes from `JSON.parse`, so the runtime `typeFor` fallback is the honest
  guard either way).

What landed (the locked design):
- **New `Settings` screen** (`app/src/Settings.tsx`). Absorbs the Report screen's
  token field + prompt editor. Holds: API token (keychain, own Save), default
  report model, default device, prompt template (all auto-saved).
- **`app/src/prefs.ts`** — `localStorage` persistence (no new dep, no Rust). Holds
  the shared `REPORT_MODELS` + `DEVICES` lists (moved out of Report/Transcribe —
  third use justified the extraction; Whisper `MODELS`/`LANGUAGES` stayed local),
  `type Prefs = { model; device; prompt }`, `loadPrefs`/`savePrefs`. Token stays in
  the keychain. `loadPrefs` merges over defaults (reviewer fix — an older blob
  missing a key never yields an `undefined` pref). Named `prefs.ts` (not
  `settings.ts`) to avoid the macOS case-collision with `Settings.tsx`.
- **`App.tsx`** owns `prefs` (`useState(loadPrefs)`) + `showSettings`; `updatePrefs`
  merges → `savePrefs` → setState; threads `defaultDevice`/`defaultModel`/`prompt`
  down. **Gear icon** (lucide `Settings` aliased `SettingsIcon`) in both screen
  headers opens Settings.
- **Report.tsx** shrank: token UI + inline prompt `<details>` gone; new props
  `defaultModel`/`prompt`/`onSettings`; `model = useState(defaultModel)`; editable
  transcript `<details>` kept. No-token state shows a hint linking to Settings;
  Copy prompt always works, Generate still `has_token`-gated.
- **Theme follows OS** — `main.tsx` toggles `.dark` from `matchMedia`, listens for
  `change`. ~6 lines, no React.

Four UX wins added beyond the locked design (this session's "think harder" pass):
- **Transcription progress bar** — `start.duration` + each `segment.end` (the `end`
  was being dropped) drive a thin bar + `%`, shown while running. No dep, no clutter.
- **Resolved-device label** — the info line now shows the device the sidecar
  actually used (Auto → GPU/CPU), so a silent CPU fallback is visible. `start.device`
  was being discarded.
- **Cancel transcription** — Rust keeps the `CommandChild` in
  `tauri::State<Mutex<Option<…>>>`; new `cancel_transcribe` kills it; the
  `Terminated` branch treats an already-taken child as a cancel (Ok), not a failure.
  A Cancel button replaces Transcribe while running. (Single-run assumption noted in
  the struct doc — the UI enforces it.)
- **Gear hidden while running** on both screens, so a Settings detour can't unmount
  and lose an in-flight transcription or streamed report.

Verified: `npm run build` (tsc + vite) and `cargo check`/`clippy` green (the old
`collapsible_match` warning is gone — that branch was rewritten). Reviewed by all
three agents (`minimalist`/`consistency`/`grug`, Opus high). Unanimous accepted
fix: `loadPrefs` merges defaults (applied). Also applied: a one-line `why` on the
round-tripped resolved device, and the single-run note on the cancel state.
Deliberately skipped (with reason): blur-commit for the prompt textarea (the locked
design is controlled auto-save; blur adds state for a rarely-edited field — grug
would ship the per-keystroke write).

_Live-run checklist (next session, `cd app && npm run tauri dev`):_ OS dark-mode
toggles theme live; prefs persist across an app restart; gear nav works and is gone
while running; **progress bar** advances against a real recording; **resolved
device** shows GPU/CPU correctly; **Cancel** actually stops a run and returns to a
clean idle (no error box); Report works with the token now living in Settings; the
no-token hint links to Settings and Copy prompt still works with no key. Plus this
round: the Transcribe **Write report** button is visible without scrolling (and
**Re-transcribe** re-runs); the **Output type** picker switches the prompt and
wipes a stale report from the previous type; the **Lecture notes** type actually
flags uncertain numbers/terms on a real recording; Settings **default output type**
is what the Report screen opens on after a restart. Plus localization: **App
language** switches the whole UI live (default Czech) and persists across restart;
**Output language** changes the prompt and the generated report's language
(default Czech), independently of the UI and of the transcription language; the
English output types produce native English headings (no Czech bleed-through).

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

**Next action — live-run Phase 4** (`cd app && npm run tauri dev`) against the
checklist above, then commit. After that, **Phase 5 — Package**: build installers;
if bundling Python+CUDA for other users is too painful, swap the sidecar to a
whisper.cpp binary (UI untouched) and fix the dev-only `CARGO_MANIFEST_DIR` sidecar
path resolution (see the Phase 2 follow-up below). Phase 4 is written but uncommitted.

_Open Phase 2 follow-up:_ the sidecar resolves the `.venv` python + script via the
compile-time `CARGO_MANIFEST_DIR`, so it only runs from this dev checkout. Packaging
(Phase 5) must replace that path resolution.

_Update this section at the end of every working session: what's done, what's
half-done, what's the next concrete action._
