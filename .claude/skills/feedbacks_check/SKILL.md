---
name: feedbacks_check
description: Maintainer-run only. Go through the AI-written .agent-feedback/ lesson logs and apply what they teach, then cut verbosity and duplication in the .claude/ commands, skills, agents and workflows, .claude/README.md and the contributor-facing docs. Prefer one canonical source; delete or thin the rest. Default is propose; pass apply to write. Never invoked by the agent itself. Slash entry: /feedbacks_check.
---

# feedbacks_check

**Maintainer-run only.** Never invoke this yourself and never offer to — not at the end of
a job, not when logs pile up, not when a lesson looks obviously right. Agents collect
struggles with `/app_feedback`; deciding what changes as a result is the maintainer's call,
made here.

Two passes, in this order:

1. **Learn from the feedback logs.** Read every unprocessed `.agent-feedback/*.md`. Keep a
   log only when all hold: concrete moment, durable without an instruction change, one
   specific surface, minimal confident proposal, and **not already covered by that
   surface's current text** — open the file and check. A log asserting how the engine API,
   the test harness, `claude plugin validate`/`test`, or a macOS tool behaves is a
   live-state claim: settle it by reading `types/` and the `claude-code` type declarations,
   or by running the command, never from a doc or a sibling log, and report the probe. Two
   logs disagreeing about a fact are both stale until probed. Cluster duplicates into one
   proposal. Mistakes get fixed before text gets shortened.
2. **Thin the surfaces.** Make instruction text as short as it can be without losing a rule
   the agent actually needs. Canonical over copies. Delete over rewrite when a file is dead
   weight.

Reads and greps for both passes go to `researcher` agents (model sonnet) that return a
scratchpad path plus a one-line verdict; the apply edits go to one `general-purpose` agent
(model opus) editing in place. The main agent holds the table, not the file dumps.

Arguments: the text after `/feedbacks_check`.
- a path → scope pass 2 to that file or directory (pass 1 always runs)
- `all` → scan `.claude/` (commands, skills, agents, workflows, README) and `CLAUDE.md` if present
- `apply` → write the proposed lesson edits and cuts (a named selection when there are many)
- (none) → pick the loudest offender from recent work, or ask

## Rules

1. **One canonical home per fact.** If `.claude/README.md`, a skill and a command all say
   the same thing, keep one and link. Grep twice — for the rule's vocabulary (copies to
   delete) and for its negation ("do it here", "inline", "stays in this file"):
   contradictions never match the duplicate hunt. List reconciliations separately from
   deletions.
2. **Commands stay thin.** A command whose procedure lives in a same-named skill is a
   ~10-line pointer.
3. **No zombie text.** Retired steps, history sections and "renamed from" notes → delete.
4. **Keep accept gates.** Hard bans, model/effort pins, approval pauses and the
   `claude plugin validate .` / `claude plugin test .` gate stay. Narrative goes.
5. A status field or state value lists every value with the step that writes it and the
   step that reads it; a value nobody writes is a specification bug.
6. A resume or idempotency key never contains a date or timestamp; use a stable id and keep
   dated paths only as storage.
7. A "never" rule ships with enforcement in the same change: a check in
   `.claude/skills/validate-tooling/scripts/validate.py`, a test in
   `tests/open-jarvis-talk.test.tsx`, or a `.gitignore` line — not prose alone.
8. **Do not invent content.** This skill is subtractive. No new features, no new policy.
   Whether a piece of tooling should exist at all is `add-tooling`'s call.

## Procedure

0. Harvest `.agent-feedback/` (pass 1). Skip `.processed/`, `.gitkeep` and `README*`. A log
   whose lesson is already in its surface's current text still moves to `.processed/` —
   that is the done-marker.
1. Read the targets. For `all`, start from `.claude/README.md`, then every file it lists.
2. For each file, list concrete cuts: delete file / drop section / collapse to one line /
   replace copy with link.
3. Propose a short table in your reply — path → action → why (one line) — plus the HEAD
   hash and the covered log filenames. Never write a proposal file. Wait unless `apply` +
   selection; on `apply`, re-list `.agent-feedback/*.md` and diff the surfaces since that
   HEAD before editing.
4. On apply: make the cuts. A count, size or line number quoted by a survey agent is
   unverified — re-derive it or drop it. For every heading, table or phrase removed or
   renamed, `git grep` the exact old wording across `.claude/`, `README.md`, `llms.txt` and
   `docs/`, and repoint or drop each citation. If a file was added, removed or renamed,
   update `.claude/README.md`. Run `python3 -I .claude/skills/validate-tooling/scripts/validate.py`
   and fix any FAIL the edit caused. Archive the applied and weak logs with one foreground
   `git mv` loop (loop variable `f`, never `path` — zsh ties `path` to `PATH`); verify by
   counting the directory, not by the agent's word.
5. Stop. Do not commit unless asked. If asked, a named agent runs `git diff --stat` and
   stages only the edited surfaces and the archived logs, by exact path.

## Guardrails

- **Never cut a rule that traces to a paid-for lesson.** Before dropping a constraint —
  replacing it with a pointer counts — `git log -S` the text; if it came from an applied
  feedback, keep those lines beside the pointer and collapse wording only.
- **`README.md` is product copy, not tooling.** Its "What it runs, reads and sends" section
  and the directory-reviewer answers are a disclosure users and reviewers rely on: never
  thin them here. A lesson that says they are wrong goes to the maintainer as a finding.
- Never edit `hooks/`, `types/`, `tests/`, `voice/`, `setup/` or `.claude-plugin/` from
  this skill. A lesson whose surface is product code is reported, not applied.
- The applied text is public. Strip any home path, name, email, token or id a log carried
  before it lands in a surface.
- A `no-gotchas` warning is satisfied when the body already has inline `**Gotcha —`
  paragraphs; do not move a lesson away from the step that depends on it.
