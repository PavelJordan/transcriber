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
  change. **Now the chosen ship engine** (Phase 5, decided) — see the Phase 5 section.

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
report* (default, derived from real example reports kept outside the repo so it
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
- **Phase 5 — Package.** **Stage A ✅** (engine swapped to whisper.cpp, CPU, behind
  the unchanged UI — code + two review rounds; live-run confirmed). **Stage B 🟡**
  (ffmpeg bundled + CI for CPU/Metal done locally; CUDA deferred — needs live CI).
  Ship **separate installers** (CPU / Metal / CUDA) via GitHub Actions. Full plan in
  the "Phase 5 — Packaging" section below.

## Open questions (resolve before the phase that needs them)

- P2: bundle a Python runtime, or assume a local `.venv`? (**Resolved in P5:** drop
  Python for shipping — whisper.cpp binary; `.venv` stays the owner's dev path.)
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
- P5: shipping engine? **Resolved: whisper.cpp** (replaces faster-whisper for the
  shipped build; faster-whisper `.venv` stays the owner's local GPU/dev path).
- P5: GPU support? **Resolved: all variants** — separate installers CPU / Metal
  (Mac, free) / CUDA (NVIDIA Win+Linux).
- P5: build infra? **Resolved: GitHub Actions** (hosted Win/Mac/Linux runners +
  `tauri-action`); CUDA binaries build with the toolkit only (no GPU at build time).
- P5: models bundled or downloaded? (Lean: small/medium default; download on first
  run + optional small bundled fallback.)

## Phase 5 — Packaging (locked plan, execute next session)

Goal: real, installable builds for the owner + a few other people; code is
open-source (MIT) on GitHub. Decisions below are locked — don't re-litigate the engine.

**Engine = whisper.cpp** (replaces the `transcribe.py` / faster-whisper sidecar for
shipped builds). Why: one self-contained native binary, no Python, ggml/GGUF models
(same Whisper weights → equivalent accuracy). Its CUDA build needs only **cuBLAS +
cudart** at runtime (no cuDNN, no Python — far lighter than faster-whisper), and
**Metal is built in** on Apple Silicon (free GPU). Keep the faster-whisper `.venv`
path as the **owner's local dev + GPU** path (you have CUDA configured; no reason to
bundle it for one person). The standalone `transcribe.py` stays for hand use.

**Ship separate installers per backend** (not one fat installer): CPU, Metal (Mac),
CUDA (NVIDIA Win/Linux). Hand each person the right one.

### Stage A — engine-agnostic sidecar swap (do FIRST; CPU; no CI needed)
The bulk of the irreversible work, identical for every variant. After it you have a
shippable CPU app on every OS. **The React UI does not change.**
- Rust `transcribe` command: spawn the **whisper.cpp binary** instead of the
  `.venv` python + `transcribe.py`. Keep the existing one-error-channel +
  event-forward shape in `lib.rs`.
- Re-implement the `--json` contract by parsing whisper.cpp output into the existing
  `start` / `segment` / `done` events (`Transcribe.tsx` + `SidecarEvent` untouched).
  `whisper-cli` prints timestamped segments live; or use its JSON output. Map the
  current dropdowns to whisper.cpp flags: model file, `--language`, threads, backend.
- **Fix the dev-only path** (Phase 2 follow-up): today the sidecar resolves
  `.venv`/`transcribe.py` via compile-time `CARGO_MANIFEST_DIR` — replace with Tauri
  resource resolution for the bundled binary + model.
- **Models**: ggml/GGUF from `ggerganov/whisper.cpp` (HF). Default **small or
  medium** — large-v3 is ~real-time-or-slower on CPU, so impractical for hour-long
  recordings (RTF reasoning from the session). Decide: bundle a small default and/or
  download the chosen model on first run (keeps installers small). Quantized GGUF
  (q5/q8) speeds CPU up further.
- **Device dropdown reflects the build**: "Auto" picks the best available backend;
  hide/disable "GPU" when the shipped binary can't honor it (CPU build on a
  CUDA-less box) rather than silently falling back.

### Stage B — GPU variants + CI (after Stage A runs end-to-end)
- **Bundle ffmpeg** (all three reviewers flagged). Stage A calls system `ffmpeg`
  by bare name (PATH) to decode input → 16 kHz wav; faster-whisper shipped its own
  decoder, so this is a *new* runtime prerequisite. Bundle a static ffmpeg as a
  second `externalBin` sidecar (or document the prerequisite) so the installers
  stay self-contained.
- **Builds**: Metal (Mac, free, automatic) + CUDA (Win/Linux). CUDA binaries build
  with just the **CUDA toolkit** in the image — **no GPU needed at build time**.
  Bundle cuBLAS + cudart in the NVIDIA installer; end users need only their driver.
- **CI = GitHub Actions** (hosted ubuntu/windows/macos runners, incl. Apple
  Silicon) with the official **`tauri-action`** matrix. Tauri can't cross-compile
  installers — each OS must build on its own runner; GitHub provides all three with
  no owned hardware. Trigger the full matrix **on version tags only**.
- **CI cost**: free + unlimited for **public** repos (ours is public). If ever
  private: ~2000 free min/mo, multipliers Linux ×1 / Windows ×2 / **macOS ×10** →
  tags only. AWS macOS avoided (24h-minimum host billing); GitLab macOS/Windows are
  paid/weak.
- **Code signing / notarization** (decide here, not now): unsigned apps hit macOS
  Gatekeeper + Windows SmartScreen. For a few people, ship unsigned with a
  right-click→Open / "Run anyway" note, or pay later (Apple Developer $99/yr,
  Windows cert ~$100–400/yr) + add CI secrets.
- **OSS polish**: add a `README` (what it is, install, the privacy story, build from
  source). `LICENSE` is already MIT.

### Stage A first task list (concrete starting point)
1. Get a whisper.cpp Linux binary + a small ggml model onto the machine (build from
   source or grab a release).
2. Rust: swap the spawn + arg mapping.
3. Parse whisper.cpp output → `start`/`segment`/`done`; confirm `Transcribe.tsx` is
   untouched.
4. Resource-path resolution (drop `CARGO_MANIFEST_DIR`).
5. Model strategy (bundle small + first-run download).
6. Device-dropdown-reflects-build.
7. Live run, then the 3 reviewers.

## Status

**Phase 5 Stage B / B2b — Linux CUDA: validated on real GPU + wired into app/CI
(2026-06-21).** ✅ (Machine gained an NVIDIA RTX 4050 + driver 580, so the piece I'd
deferred as "untestable without live NVIDIA" is proven.) **Decision: first-run
download** of the CUDA libs (not bundled — keeps the installer ~200 MB vs ~800 MB,
mirrors the model fetch). Engine code done + clippy-clean (default and `--features
cuda`); CI `linux-cuda` job written. **Committed + pushed (87fc3ee, GitHub `main`).**
Needs a live tag to validate the CI (untestable locally) and a `tauri build
--features cuda` smoke test (heavy/crash-risky locally).

What was proven (local, user-space, no sudo):
- **Built a CUDA `whisper-cli`** from whisper.cpp v1.9.1, `-DGGML_CUDA=ON
  -DBUILD_SHARED_LIBS=OFF -DCMAKE_CUDA_ARCHITECTURES=89` (Ada). Toolchain via
  **micromamba** (no sudo, this box has no CUDA toolkit): conda-forge `cuda-nvcc
  12.6` (pulls gcc/g++ **13** — the nvidia-channel nvcc is 12.4 and rejects gcc-14;
  system gcc-15 is too new for any CUDA 12.x). Reproducible recipe lives at
  `~/cuda-build/build.sh` (outside the repo). CUDA headers/libs are under the conda
  env's `targets/x86_64-linux/{include,lib}` — exposed via `CPATH`/`LIBRARY_PATH`.
- **Driver-only run succeeded.** This box has the **driver but no toolkit/runtime**
  in the loader path — exactly the end-user condition. Co-located `whisper-cli` + the
  3 CUDA libs with `patchelf --set-rpath '$ORIGIN'`, run under `env -i` (no conda, no
  `LD_LIBRARY_PATH`) → GPU detected, CUDA0 backend, `jfk.wav` transcribed correctly.
- **CUDA bundle list = `libcudart.so.12`, `libcublas.so.12`, `libcublasLt.so.12`.**
  The driver's `libcuda.so.1` resolves from the system and must NOT be bundled.
  (Plus the same `libstdc++`/`libgomp` story as the CPU build — system-provided on a
  CI ubuntu build.)
- **Size reality (the open decision):** `libcublasLt.so.12` is **491 MB**, `libcublas`
  108 MB, and the static CUDA binary itself **205 MB** → a bundled CUDA installer is
  **~800 MB** vs ~100 MB for CPU. So the real choice is **bundle in the installer**
  (big download, fully offline) **vs first-run download** of the CUDA libs into
  `app_data_dir` (keeps the installer small, mirrors how the *model* is already
  fetched on first use) — RESOLVE THIS before wiring it up.
- **Loader mechanism for Tauri:** Tauri flattens the sidecar next to the main exe
  but puts `bundle.resources` in a *different* dir, so `$ORIGIN`-of-sidecar won't
  find resource libs. Shipped approach = set **`LD_LIBRARY_PATH` on the whisper-cli
  spawn in Rust** pointing at the resolved lib dir (resource dir if bundled, or
  `app_data_dir` if downloaded). One harmless code path: on CPU/Metal builds that
  dir simply has no CUDA libs. (Windows-CUDA equivalent later: DLLs next to the exe.)
- **Build-crash lessons (cost two machine freezes):** ggml-cuda kernels are 2–4 GB
  *each* under nvcc — `cmake --build -j` (all 20 cores) OOMs and freezes the box; use
  **`-j4`**. A freeze also leaves **zero-byte object files** that incremental builds
  skip (→ bogus `undefined reference to ggml_backend_cpu_reg` at link), so after a
  crash do a **clean** rebuild. **zram** (zstd, ram/2) set up as the safety net.

What got wired (this session, after the first-run-download decision):
- **Rust (`lib.rs`).** Extracted the model download into a reusable `download_file`
  (chunked + `download` progress event + cancel + truncation guard); `ensure_model`
  now calls it. Added a **`cuda` cargo feature** (`Cargo.toml`, off by default):
  when on, `ensure_cuda_libs` fetches `libcudart.so.12`/`libcublas.so.12`/
  `libcublasLt.so.12` on first use into `app_data_dir/cuda` and `run_whisper` sets
  `LD_LIBRARY_PATH` to that dir on the whisper-cli spawn. **One harmless code path**
  — CPU/Metal builds pass `None` (no env set). Download URL is the matching GitHub
  release (`.../download/v{CARGO_PKG_VERSION}/<lib>`). Dropped `duration` as a
  `run_whisper` arg (compute it inside from `wav`) to stay under clippy's arg limit.
  The UI is unchanged — the CUDA libs reuse the existing `download` progress event
  (so first-run shows "Downloading model… N%" while fetching libs; minor label
  imprecision, deliberately no UI churn).
- **CI (`release.yml`).** New `linux-cuda` matrix entry: installs the CUDA toolkit
  (Jimver action, no GPU needed to build), builds whisper-cli with `-DGGML_CUDA=ON
  -DCMAKE_CUDA_ARCHITECTURES=all-major`, `patchelf --remove-rpath` (so it uses only
  the app-fetched libs), builds the app with `--features cuda` + a `tauri.cuda.conf
  .json` overlay (productName `transcriber-cuda`, so the installer doesn't collide
  with linux-cpu's), then uploads the 3 CUDA libs to the release for the first-run
  fetch. (Draft-release assets are downloadable only after the draft is published —
  publish to make installers + libs live.)
- **Verified locally:** `cargo clippy` clean both default and `--features cuda`;
  release.yml + overlay parse. **Not** verified: the CI job (needs a live tag) and a
  real `tauri build --features cuda` installer (heavy local build, deferred).
  Best-effort/verify-live in the CI: the Jimver action version + `cuda: 12.6.2`, the
  `--config` path resolution, and that the published-release lib URLs resolve.

Next for B2b: reviewers → commit → live tag to shake out the CI. **Windows-CUDA**
still needs CI (no local Windows+NVIDIA box); same shape (DLLs next to the exe
instead of LD_LIBRARY_PATH).

---

**Phase 5 Stage B — ffmpeg bundled + CI (CPU + Metal); CUDA deferred. Code +
reviews + local verify done (2026-06-21); needs a live tag to validate CI.** 🟡
Committed + pushed (87fc3ee, GitHub `main`) together with B2b above.

What landed (Stage B, this session):
- **ffmpeg is now a bundled sidecar** (all three Stage-A reviewers' top flag).
  `convert_to_wav` switched from `.command("ffmpeg")` (bare PATH lookup) to
  `.sidecar("ffmpeg")`, mirroring the whisper-cli pattern (`.sidecar(...)
  .map_err(...)?`); `tauri.conf.json` `externalBin` gained `"binaries/ffmpeg"`. A
  static ffmpeg (johnvansickle GPL, 80 MB) is placed at
  `binaries/ffmpeg-x86_64-unknown-linux-gnu` for local dev (gitignored like
  whisper-cli; fetch steps in `.gitignore`). The installers are now self-contained
  — no system ffmpeg prerequisite. The React UI and `transcribe.py` are untouched.
  Verified locally: `cargo clippy` + `npm run build` green; tauri-build copies both
  sidecars next to the dev binary (`target/debug/{ffmpeg,whisper-cli}`), so
  `.sidecar("ffmpeg")` resolves to the bundled binary, not PATH; the bundled static
  ffmpeg runs the app's *exact* conversion args and yields the 44-byte-header wav
  the `wav_duration_secs` math assumes.
- **GitHub Actions release workflow** (`.github/workflows/release.yml`, new). Tags
  only (`v*`), `permissions: contents: write`, `fail-fast: false`. A `tauri-action`
  matrix over three variants — **linux-cpu** (ubuntu-22.04), **windows-cpu**
  (windows-latest), **macos-metal** (macos-14 / aarch64, Metal embedded via
  `-DGGML_METAL_EMBED_LIBRARY=ON`). Each job: builds `whisper-cli` from
  `ggml-org/whisper.cpp` **v1.9.1** static (`-DBUILD_SHARED_LIBS=OFF
  -DGGML_NATIVE=OFF`), fetches a static ffmpeg, drops both at
  `binaries/<name>-<triple>(.exe)` **before** tauri builds (the externalBin
  must-exist invariant), `npm ci`, then `tauri-action` → a **draft** GitHub release.
  No per-variant rename needed yet (one variant per OS → the OS already
  distinguishes the installers). YAML parses; logic can only be proven by a real tag.
- **README rewritten** for the public repo: the privacy story, per-OS install table,
  **unsigned-app run-anyway** notes (macOS right-click→Open / `xattr`; Windows
  SmartScreen → Run anyway), build-from-source, and ffmpeg's **GPL** attribution
  (MIT app aggregating a GPL binary — source pointed to upstream).

Decisions / honest scope:
- **Code signing** — decided **ship unsigned** for now (a few people): documented in
  the README. Paid signing (Apple $99/yr, Windows cert) + CI secrets is a later call.
- **CUDA deferred to a focused follow-up (B2b), on purpose.** The build is easy
  (Jimver/cuda-toolkit + `-DGGML_CUDA=ON`, no GPU needed at build time); the real
  work is **bundling the runtime libs + the loader path**, which can't be made
  correct-by-construction here. A CUDA `whisper-cli` dynamically links
  `libcudart`/`libcublas`/`libcublasLt`, so the installer must ship them next to the
  flattened sidecar — on Linux via an `$ORIGIN` rpath or a spawn-time
  `LD_LIBRARY_PATH` (a Rust change — it escapes pure CI YAML), on Windows via the
  co-located `cudart64_*/cublas64_*/cublasLt64_*` DLLs. Untestable without live
  NVIDIA CI, so shipping it now would be unrun aspirational code. Captured here so
  the locked "all variants" decision isn't lost.
- **macOS arm64 static ffmpeg has no official upstream** — pinned a third-party
  build (osxexperts); flagged in the workflow to bump per ffmpeg release.

_Live validation needed (owner, on a throwaway/real tag):_ push a `v*` tag and watch
the matrix — the three OS jobs each produce an installer attached to a draft release.
Things most likely to need a fix on first run (can only surface live): the Windows
whisper build output path (`build/bin/Release/whisper-cli.exe` assumes the VS
multi-config generator) and Windows VC++ runtime self-containment (default `/MD`
links `vcruntime140.dll` — ubiquitous, but add `-DCMAKE_MSVC_RUNTIME_LIBRARY=
MultiThreaded` if a clean box complains); on **Linux** the static whisper-cli still
dynamically links OpenMP (`libgomp.so.1`) — present on any normal desktop, but drop
it with `-DGGML_OPENMP=OFF` if a clean box complains; the macOS ffmpeg URL/extract;
and the unsigned-launch UX on each OS. Then a real transcription end-to-end per
installer.

---

**Phase 5 Stage A complete + live-run confirmed (2026-06-21).** ✅ The shipped
transcription engine is now **whisper.cpp** instead of the faster-whisper Python
sidecar — behind the **unchanged** transcription UI. The owner ran it through the
GUI: transcription streams live, the **first-use model download** + progress works,
**Cancel** stops a run/download to a clean idle, and **auto** language detection
works. Two checklist items were *not* exercised through the GUI but are non-blocking
(owner's call): the **forced `cs`/`en`** picker (works at the engine by hand — `-l
cs` produced segments, no detection line) and the **clean-recording-folder** check
(holds by construction — the command writes only to the OS temp dir (the wav) and
`app_data_dir` (the model), and whisper-cli is run with no output-file flags, so it
never writes next to the source). Worth a glance if ever in doubt, but not a Stage A
blocker.

What landed (Stage A):
- **whisper.cpp CPU sidecar.** Built a static CPU binary (`cmake -DBUILD_SHARED_LIBS=OFF
  -DGGML_NATIVE=OFF`, target `whisper-cli`, from `ggml-org/whisper.cpp`) and placed it
  at `app/src-tauri/binaries/whisper-cli-<target-triple>` as a Tauri `externalBin`.
  **Gotcha:** Tauri copies the sidecar *flat* next to the exe with the triple
  stripped (dev: `target/debug/whisper-cli`, **not** `binaries/whisper-cli`), so the
  Rust call is `.sidecar("whisper-cli")` (basename), even though the config entry is
  `"binaries/whisper-cli"`. The binary is **gitignored** (platform-specific; CI
  builds it in Stage B) — build steps are in `.gitignore`.
- **Rust `transcribe` rewritten** (`lib.rs`): `ensure_model` (download the ggml model
  on first use into the app data dir), `convert_to_wav` (system ffmpeg → 16 kHz mono
  PCM, `-fflags +bitexact` so the header stays 44 bytes), `run_whisper` (spawn the
  sidecar, parse stdout `[ts --> ts] text` lines + the stderr `auto-detected
  language:` line into the **same** `start`/`segment`/`done` events the UI already
  reads — `Transcribe.tsx`'s `SidecarEvent` only *gained* a `download` variant).
  One error channel preserved. `transcribe.py` is untouched (still the owner's local
  dev/GPU path and the standalone hand-run script).
- **Model download = first-use, into the app data dir** (no bundling → small
  installer). Source repo is **`ggerganov/whisper.cpp`** on HF — the newer
  `ggml-org/whisper.cpp` **401s** without auth (learned the hard way). Progress shows
  as "Downloading model… N%" (a new `download` event; reuses `reqwest`, already a dep).
  Default model dropped from `large-v3` → **`small`** (large-v3 is slower-than-realtime
  on CPU). Truncated-stream guard: verify `downloaded == content_length` before the
  `.part`→`.bin` rename, so a short download is never cached as a complete model.
- **Unified cancellation** via a single `state.cancelled` `AtomicBool`:
  `cancel_transcribe` sets it *and* kills the current child, so it now also aborts an
  in-flight model **download** (which has no child to kill — the round-1 ghost-run
  bug). Replaced the old `take().is_none()` trick and the `Drain` enum.
- **Device picker removed** (all three reviewers, unanimous round-1 #1). Under the
  Stage B per-backend-installer design a runtime device choice is meaningless (a CPU
  build's "auto"/"cpu" are synonyms) — it was future-code that lied. Deleted the
  `available_devices` command, `prefs.device`, `DEVICES`, the resolved-device label,
  and the `fieldDevice`/`defaultDevice` i18n keys. This *satisfies* the plan's "don't
  offer GPU on a CPU build" intent; Stage B re-adds device selection only if a real
  build needs it (e.g. a force-CPU toggle on the CUDA build).
- Verified: `npm run build` (tsc+vite) + `cargo clippy` green; the dev app **launches**
  (window opened); `ffmpeg → whisper-cli` run by hand with the **exact app args**
  produces parseable segments (forced lang → no detection line; auto → detection
  line present). Two full fresh-eyes review rounds (`minimalist`/`consistency`/`grug`,
  Opus high). Round-2 fixes applied: truncated-download guard, the stale
  "Downloading… 100%" line (now shown only while `< 100`), two misleading comments
  reworded. Deliberately deferred: **ffmpeg bundling** → Stage B (packaging); the
  cancel-then-instant-restart race is pre-existing and out of Stage A scope (the
  single-run assumption is documented on `TranscribeState`).

_Live-run (done 2026-06-21):_ green per the header above. Operational notes for next
time: the 466 MB `small` first-download takes a bit — pre-place
`~/.local/share/com.hissetta.transcriber/models/ggml-small.bin` (or use the `base`
model already there) to skip the wait; `large-v3` on CPU is slow-but-works, so
**medium/small** are the practical defaults.

---

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
git-credential`). Don't switch the GitLab remote back to SSH.

**Open source / GitHub (canonical home):** MIT-licensed (`LICENSE`), public at
**`PavelJordan/transcriber`** (remote `github`, SSH — verified working). **Push to
GitHub** (`git push github main`); Phase 5 CI (GitHub Actions) runs there.

**GitLab `origin` is a stale private mirror.** `main` on `hissetta` is a protected
branch, so the history scrub couldn't be force-pushed there — it still holds the
old pre-scrub history and has **diverged** from local/GitHub. Don't expect `origin`
pushes to fast-forward; treat GitHub as truth (or retire GitLab).

**History scrub (done):** the public history was rewritten with `git-filter-repo`
to (a) remove the private consultation samples `0608/` + `0617/` — **moved to
`~/Thesis/consultations-private/`, kept locally** as the quality bar — and (b) scrub
third-party/work references. Force-pushed to GitHub only. Never re-commit the
samples (now gitignored: `*.txt`/`*.srt`/`*.vtt`/`transcribe.log`).

**Next action — validate Stage B live.** All of Stage B (B1 ffmpeg + B2 CPU/Metal CI
+ B2b Linux CUDA) is committed + pushed (87fc3ee, GitHub `main`). Now **push a
`v0.1.0` tag** (must equal the crate version — the CUDA fetch URL + a CI guard
depend on it) to run the matrix, then **publish the draft release** so the
installers *and* the CUDA libs become downloadable. Fix whatever the first run
surfaces — see the "_Live validation needed_" notes + the B2b verify-live list above
(Windows whisper path/VC++ runtime, macOS ffmpeg URL, Linux libgomp, Jimver action
version, `--config` path, unsigned-launch UX). Then a real transcription per
installer, incl. a `transcriber-cuda` install on a GPU box. **Windows-CUDA** is the
remaining backend (CI-only; DLLs-next-to-exe instead of LD_LIBRARY_PATH). The
whisper.cpp + ffmpeg sidecars are gitignored — a fresh clone (and CI) must
build/fetch them (steps in `.gitignore`).

_Resolved (Stage A):_ the old Phase 2 follow-up — the sidecar resolving the `.venv`
python + script via compile-time `CARGO_MANIFEST_DIR` — is **gone**. The whisper-cli
sidecar resolves via Tauri `externalBin` (`.sidecar("whisper-cli")`) and the model
via `app_data_dir`; no compile-time paths remain.

_Update this section at the end of every working session: what's done, what's
half-done, what's the next concrete action._
