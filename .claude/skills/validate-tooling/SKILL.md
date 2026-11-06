---
name: validate-tooling
description: Audit and fix every AI tooling file in this repo's .claude/ — skills, agents, slash commands, workflows — against the Agent Skills spec and Claude Code best practices. Runs a bundled validator for the mechanical checks (frontmatter, name rules, character limits, model/effort pins, workflow meta literals, the .claude/README.md inventory, user-level duplicates, personal data in this public repo), then applies the qualitative checks a script cannot judge. Use whenever asked to check, lint, validate, fix or review the .claude/ tooling, or when a skill is not triggering or triggers wrongly.
---

# Validate and fix the AI tooling

The tooling layer (`.claude/skills/*`, `.claude/agents/*`, `.claude/commands/*`,
`.claude/workflows/*.js`, the `.claude/README.md` inventory, and `CLAUDE.md` if one exists)
rots silently: a description past the spec limit, a name that stopped matching its
directory, a command pointing at a skill that moved, an inventory row nobody added, a home
path pasted into a file that ships to every user. None of these break visibly.

**Your job: find every deviation, fix the real ones, and leave the repo passing its own audit.**

Steps 1–5 run in one `general-purpose` agent (model opus) that edits in place and returns a
scratchpad path plus a one-line verdict (FAIL count, files fixed).

Sources: the [Agent Skills spec](https://agentskills.io/specification), the
[skill-authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices),
the [Claude Code memory docs](https://code.claude.com/docs/en/memory), and this repo's
conventions in `.claude/README.md` and the `add-tooling` skill.

## Step 1 — Run the mechanical validator

From the repo root. Stdlib-only, non-interactive, exits 1 on any FAIL.

```bash
python3 -I .claude/skills/validate-tooling/scripts/validate.py
```

| Level | Meaning | Action |
|---|---|---|
| `FAIL` | A spec or convention rule is broken. | **Must fix.** |
| `WARN` | A deviation that may be intentional, or a quality smell. | Fix, or state in one line why it stays. |
| `INFO` | Observation. | Read and move on. |

## Step 2 — Fix every FAIL, by code

| Code | Fix |
|---|---|
| `frontmatter-missing` | Add a frontmatter block as line 1 (`---`); Claude Code reads it only there. |
| `name-missing` / `name-too-long` / `name-format` | Add or fix `name`: lowercase, single `-` or `_` separators, ≤ 64 chars. |
| `name-dir-mismatch` / `name-file-mismatch` | Make a skill's `name` match its directory, an agent's match its file name. |
| `desc-missing` / `desc-empty` / `desc-too-long` | Write *what* and *when* (Step 4); skills stay ≤ 1024 chars. |
| `compat-too-long` | Cut `compatibility` to the real prerequisites. |
| `empty-body` / `skill-md-missing` | Write the instructions, or delete the empty directory. |
| `pointer-broken` | A command names a `.claude/...` path that is gone: repoint it. |
| `file-too-long` | Split the file; move detail to `references/` and say when to load it. |
| `script-interactive` / `empty-script` | Take input from flags, env or stdin; implement or delete an empty script. |
| `meta-missing` / `meta-not-first` / `meta-not-literal` / `meta-field-missing` | `export const meta = {...}` is the first statement, a pure literal (no variables, calls, spreads, template strings) with string `name` and `description`. |
| `workflow-nondeterministic` | Remove `Date.now()`, `Math.random()`, argless `new Date()`; pass values in through `args`. |
| `agent-type-missing` | A workflow's `agentType` names no built-in type and no `.claude/agents/<name>.md`: fix the name or add the agent (`add-tooling`). |
| `inventory-missing` / `inventory-row-missing` | Add the row to `.claude/README.md` (the `add-tooling` conventions). |
| `dup-global` | The file duplicates a user-level skill (`handover`, `do_not_commit`, `do_not_add_comments`, `brief`, `staff`, `reclaim_machine`): delete the repo copy. |
| `public-leak` | Replace the home path with `~` or a repo-relative path; delete any email, token, key, session id or UUID. If it was a real credential, tell the maintainer to rotate it — deleting the line does not unpublish it. |
| `memory-too-long` | Split `CLAUDE.md` into path-scoped `.claude/rules/` files. |

## Step 3 — Handle every WARN, by code

| Code | Fix or keep |
|---|---|
| `name-underscore` | **Keep** when it matches the slash command (`app_feedback`, `feedbacks_check`). |
| `desc-thin` / `listing-budget` | Rewrite with the user's words; put the main use case first. |
| `no-argument-hint` | Add `argument-hint:` to the command. |
| `file-long` / `agent-long` | Move detail out; keep an agent's `<example>` blocks. |
| `no-h1` / `no-gotchas` | Add the H1; add a Gotchas section of the non-obvious, repo-specific facts. Inline `**Gotcha —` paragraphs satisfy it. |
| `broken-ref` / `inventory-stale` | Fix the path or drop the link / row. |
| `no-model` / `no-effort` / `bad-model` / `bad-effort` | Pin `model` (opus / sonnet / haiku) and `effort` (low … max). |
| `phase-mismatch` / `phase-unused` | Make `meta.phases` titles and `phase()` calls match exactly. |
| `dup-global` (WARN) | A same-named file exists in your own `~/.claude`. Confirm the repo copy is the one the repo needs; if not, delete it. |
| `vague-phrasing` | Replace filler with a concrete, verifiable instruction. |
| `script-no-help` / `script-shell-true` / `script-no-shebang` | Add `--help`; pass an argument list; add a shebang. |
| `local-settings-tracked` | Add `.claude/settings.local.json` to `.gitignore` (an edit outside `.claude/` — ask first). |
| `memory-long` / `memory-no-headers` / `memory-empty` | Shorten, structure, or delete the memory file. |

## Step 4 — The qualitative checks

A file can pass every mechanical rule and still be bad. Read each one and ask:

- **Trigger quality.** Would the user recognize their own request in the `description`?
  Name the intents, including ones that do not use the skill's jargon.
- **Scope.** One coherent job? A two-job file is an `add-tooling` split decision — flag it.
- **Progressive disclosure.** Is the body the minimum needed on every run?
- **Gotchas.** Does it carry the facts an agent gets wrong here: the engine API is the
  `claude-code` module and its types, tests run with `claude plugin test .`, the product's
  disclosure contract is `README.md` → *What it runs, reads and sends*, and everything in
  `.claude/` is public and ships with the plugin.
- **Add what the agent lacks, omit what it knows.** Cut generic explanations.

Fix each problem in place.

## Step 5 — Re-run until clean

Re-run the Step 1 command. Done when it exits 0, every WARN is fixed or justified in one
line, and Step 4 was applied to every file you touched.

## Gotchas

- **Do not edit the validator to silence a finding.** If a check is wrong, fix the check
  only after confirming the false positive, then re-run the whole repo.
- **The 1024-char limit is a skill rule.** Agents and commands get the 1536-char listing cap
  (a WARN).
- **Renaming, splitting or merging is not a validation fix.** `add-tooling` owns those.
- **`public-leak` scans `.claude/` only** (`.agent-feedback/` is gitignored and local), skipping
  `settings.local.json`. It does not police product code or `README.md`.
- **`dup-global` reads your own `~/.claude`**, so its WARNs differ between machines; the FAIL
  set (the six user-level skills) is fixed in the script.
- **The detectors avoid self-matches.** If you add a pattern, keep its source text from
  matching itself (build it by concatenation), as the private-key pattern does.
- **Write only under `.claude/`.** Product code (`hooks/`, `types/`, `tests/`, `voice/`,
  `setup/`, `.claude-plugin/`) and `README.md` are out of scope for this pass.
