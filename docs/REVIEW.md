# REVIEW

How we review code here: with **fresh eyes**.

## Why fresh context

The person who just wrote the code is the worst judge of it — they remember why
every line is there, so the complexity feels justified. A reviewer who has *never
seen the reasoning* and only reads the result will flinch at the things that are
actually wrong. That flinch is the signal.

So our reviewers are **subagents launched with no memory of the writing session**.
They get the diff and the style docs, nothing else. They are cheap. Run them often.

## The three reviewers

Each is a subagent in `.claude/agents/`. They have one job and a narrow lens —
narrow on purpose, so each one digs instead of skimming.

| Agent | Lens | The question it keeps asking |
|---|---|---|
| `minimalist` | Less code | "What can be **deleted**? What earns its complexity?" |
| `consistency` | Sameness | "Does this match how the rest of the app already does it?" |
| `grug` | Simplicity | "Where is the complexity demon hiding? Is this clear to a tired reader?" |

They overlap a little. Good — three angles on the same code catch more than one
broad pass.

All three run on **Opus with high thinking** (frontmatter `model: opus`). Review is
where the complexity gets caught, so it's worth the tokens. Under `pi`, run them
headless on the subscription provider:

```
pi -p --model opus-4-8 --thinking high -t read,bash \
  --append-system-prompt "$(cat .claude/agents/grug.md)" "<what to review>"
```

## When to run

- After finishing a meaningful chunk — a screen, the sidecar wiring, the API call.
  Not after every line; not only at the very end.
- At minimum, **once per phase** in `docs/PLAN.md` before marking it done.
- Always before packaging.

## How to run

Launch the three in parallel (one message, three `Agent` calls) so they review the
same diff independently and can't anchor on each other:

```
Agent(subagent_type="minimalist",  prompt="Review the uncommitted changes (or: the diff in app/src/Transcribe.tsx). Report against docs/STYLE.md.")
Agent(subagent_type="consistency", prompt="…same target…")
Agent(subagent_type="grug",        prompt="…same target…")
```

Tell each one **what to review** (a path, a feature, or "the uncommitted diff").
Keep the target small — a focused diff gets a sharp review; a huge one gets a vague one.

## What to do with findings

- Each reviewer returns a short list, most important first, with severity.
- **You decide.** A finding is an argument, not an order. If you disagree, say why
  and move on — don't cargo-cult a change you can't justify.
- Apply the ones that make the code simpler/smaller/more consistent. Skip nitpicks
  that add churn without value (`docs/STYLE.md`: no changes that don't affect the product).
- If two reviewers flag the same thing, it's almost certainly real.

## What review is NOT

- Not a style-bot rewriting working code for taste. The bar is "is this simpler,
  smaller, or more consistent," not "is this how I'd have typed it."
- Not a substitute for running the app. Reviewers read; they don't execute. Verify
  behaviour by actually running it.
