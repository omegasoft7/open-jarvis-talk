---
description: Stress-test a diff or a plan for the Open Jarvis Talk plugin from five expert angles at once — voice UX, plugin-API/engine correctness, macOS/privacy/consent, setup/supply chain, maintainability/docs truth — then one chair verifies, scores confidence and returns a single ranked report. Read-only: never posts to GitHub, never edits code.
argument-hint: "[review|plan] [PR#123 | branch | nothing = working tree | the plan text] (optional — default: infer from the arguments and the git state)"
allowed-tools: AskUserQuestion, Read, Bash, Grep, Glob, Workflow, Agent, ToolSearch
---

# /council

Convene a five-member review council on one change or one plan, and return a single report.

**The council writes nowhere.** It is the step before `code-reviewer`, for a design, diff or
plan you want attacked. If the ask is "review this PR and post the verdict", that is the
`code-reviewer` agent — say so and stop. The `/council` token may appear anywhere in the
prompt; take the rest as context.

## 1. Classify the intent

Read the arguments and `git status --short`, then pick exactly one:

| Mode | When |
|---|---|
| **review** | A review was asked for, or a PR / branch / dirty working tree is in play. |
| **plan** | A plan, design, approach question or feature idea was passed. |
| **neither** | Anything else. |

On **neither**, stop and say:

> `/council` stress-tests a **change** or a **plan**. What would you like it to look at?

Offer two or three concrete options from the current state ("the working-tree diff",
"PR #12", "the approach we just discussed") and wait.

## 2. Resolve the subject

**review mode** — resolve the subject to the **command** the members run. You read only the
`--stat` view and the PR body, never the hunks:

1. `PR#123` / `#123` / digits → `gh pr diff <N>`, plus `gh pr view <N> --json title,body,files`
   for you.
2. A branch name → `git diff origin/main...<branch>` (after `git fetch`), unless the branch
   says otherwise.
3. Nothing → `git diff HEAD`. If the tree is clean, fall back to the last commit and say so.

If the `--stat` is empty, stop and say so. An empty diff is not a passing review.

**plan mode** — the subject is the plan text: from the arguments, a GitHub issue the user
named (`gh issue view <N>`), or what was just discussed. Restate it in one paragraph before
convening, so a misread costs one sentence and not six agents.

## 3. Size the run — the complexity gate

Triage once, from the `--stat` view and the PR body:

| Complexity | Signals | What runs |
|---|---|---|
| **Low / medium** | README wording, a test-only change, a settings default, a typo in a spoken string, a plan whose shape is settled. | **No council.** For review, one `researcher` agent with the subject command and scope reports the concrete issues it can evidence; for plan, the refined plan with Given/When/Then acceptance criteria. Then stop. |
| **High** | Touches `$.prompt.submit` / the draft-approval path, a spawned process or its kill path, the talk-state machine, `$.store` or atom shapes, a new hook event, `setup/jarvis-setup.sh` downloads or pins, `voice/`, the README disclosure section, a new dependency; or the user asked for the council. | **Convene** — step 4. |

Say which way you went and why, in one line. Skipping the council is the common case.

## 4. Convene

```js
Workflow({
  scriptPath: '.claude/workflows/council.js',
  args: {
    mode: 'review',            // or 'plan'
    subject: '<the diff command to run, the PR number, or the plan text>',
    scope: '<changed paths, so no member wanders outside them>',
    context: '<PR body, issue text, prior review comments — whatever you already gathered>',
  },
})
```

Five personas run in parallel on `researcher` (sonnet/high, read-only tools), then one chair
on opus/high verifies every P0/P1 against the real file, scores confidence, drops everything
under 80 and merges duplicates. Pass the command, not the diff text — the members run it
themselves, so the bulk stays out of this window.

## 5. Report

In this order:

- **Verdict** — the chair's two sentences.
- **Blockers (P0/P1)** — each with confidence, the members that raised it, `file:line`, and
  the one-sentence fix. Never compress these.
- **Suggestions (P2/P3)** — one line each.
- **Not covered** — a member that did not answer, a file nobody opened, anything only a real
  run on a Mac can settle (microphone, speech recognition, audio, the desktop app UI). An
  unrun check is never an all-clear.
- **Commendations** — only if the chair returned any.

No blockers is a legitimate outcome; never promote a nit to justify the run. The documented
`zsh -c` wrappers, the login-shell `claude -p` and the empty `CLAUDECODE` are deliberate
(`README.md` → *What it runs, reads and sends*) — not findings.
