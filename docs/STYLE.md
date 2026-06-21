# STYLE

Grug-brain code style for this app. Read before writing code.

> grug brain developer not so smart, but grug program many long year and learn
> some things. complexity very, very bad. complexity is the enemy. grug fight it.

Inspired by a larger project's `STYLE.md` and `AGENTS.md`. Same spirit, smaller
project, web/Rust instead of Django.

## The prime directives

1. **Complexity is the enemy.** Every abstraction, dependency, config knob, and
   "flexible" layer is complexity you pay for forever. Default answer to "should
   I add this?" is **no**.
2. **Less code is better code.** The best change deletes code. The second best
   adds little. Code you didn't write has no bugs.
3. **No future code.** We don't build for an imagined tomorrow. No "might be
   useful," no extension points nobody asked for, no options with one caller.
   When the future arrives, write the code then — you'll know more.
4. **It must have system and logic.** Not clever — *clear*. A new reader should
   follow the flow without a guide.
5. **Make it work, then make it nice, then (only if needed) make it fast.**
   Functionality stripped to the core first; optimization is last and usually skipped.

## Code we write

- **Offensive, not defensive.** We have strong assumptions about our own data and
  act on them confidently. No defensive `try/catch` swallowing everything.
- **`try/catch` only at the edges** — the Anthropic API call, the filesystem, the
  sidecar process. Places where the outside world can actually fail. Let our own
  bugs throw loudly; a crash in dev is a gift.
- **No catching generic errors to hide them.** If you catch, you handle or you
  re-throw with context. Never `catch {}`.
- **Code must not handle cases that can't happen.** Don't guard against states the
  type system or the flow already rules out.

## Naming

- Names are self-explanatory. If you can't tell what it does from the name, rename
  it. Explicit beats implicit.
- No one-letter names except a loop index or a tight comprehension.
- Avoid bare generic verbs (`process`, `handle`, `manage`, `doStuff`). Say what it
  does: `transcribeFile`, `streamReport`, `loadTokenFromKeychain`.
- If a name is hard to pick, the thing probably does too much. Split it.

## Comments

- **Default is no comment.** The code says *what*. A comment exists only to stop a
  reader from breaking an invariant or being genuinely surprised — it says *why*,
  or *what burns if you change this*.
- A multi-line comment is a smell: bad name, function too big, or the explanation
  belongs in the commit message.
- Never comment to justify a change to a reviewer. That goes in the commit/PR.

## Functions & components

- Small, one job, named for that job. If you're scrolling, it's too big.
- Order code by call flow top-to-bottom: the function that calls comes before the
  ones it calls. Read it like prose.
- **React:** function components + hooks. Local state by default. Reach for shared
  state / context **only when two real components need it** — not preemptively.
- **No premature abstraction.** Two similar blocks are fine. Extract on the *third*
  use, when the shared shape is actually known. A wrong abstraction costs more than
  duplication.

## Dependencies

- Each new dependency is a liability: supply chain, bundle size, breakage, lock-in.
- Before adding one, ask: can the platform or ~30 lines of our own do it? Prefer
  the standard library, `fetch`, the official Anthropic SDK, and shadcn primitives.
- No utility-kitchen-sink libs for one function.

## TypeScript

- `strict` on. No `any` — use `unknown` and narrow, or write the type.
- Types describe real shapes (the sidecar JSON, the API response). Don't model
  states that can't occur; do make illegal states unrepresentable when it's cheap.
- Keep types next to where they're used until shared by two places.

## Rust (Tauri side)

- Keep it thin. The Rust layer spawns the sidecar, talks to the keychain, and
  exposes a few `#[tauri::command]`s. Business logic lives in TS or the sidecar.
- Don't introduce async runtimes, channels, or traits the task doesn't need.

## Python (`transcribe.py`)

- It already follows this spirit — keep it that way. Add the `--json` mode without
  disturbing the human-readable path. No new dependencies for it.

## When unsure

Write the dumbest thing that clearly works, then run the reviewers
(`docs/REVIEW.md`). Fear of looking simple is how complex code gets written.
Grug not afraid to look simple. Simple is the win.
