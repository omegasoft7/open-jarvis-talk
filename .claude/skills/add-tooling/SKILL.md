---
name: add-tooling
description: Add a new skill, command, agent or workflow to this repo's .claude/ correctly — prove nothing in the repo, in ~/.claude or in an installed plugin already covers the job, pick the right type, pin the model tier, write it to this repo's conventions, and update .claude/README.md in the same change. Use whenever someone wants to create, add, port, vendor or split a skill, slash command, subagent or workflow here, or asks how to.
---

# Add a skill, command, agent or workflow

Tooling rots by duplication: two ways to run the tests, two review checklists, a repo copy
of a skill the user already has globally. Each is reasonable alone; together they give
contradictory answers to one question.

**Your job is to prevent the next one, then write the thing properly.**

## Golden rules

- **Advise, never block.** Found an overlap? Name the file, offer options, let the
  maintainer decide. Proceeding anyway is legitimate — it gets **recorded** (step 5).
- **Never write the file before step 1 is done.** The duplicate check is the whole point.
- **The inventory is part of the change.** `.claude/README.md` is updated in the same
  change, or the work is not finished.
- **This is developer tooling, not the product.** The plugin's own commands
  (`/open-jarvis-talk`, `/open-jarvis-talk-chat`) are registered in `hooks/register.tsx`
  and are product code. Never add, rename or wire product behavior through `.claude/`.

## Step 1 — Prove nothing already covers this

Do all four. Items 1–3 are reads and greps: hand them to a `researcher` agent (model
sonnet) that returns the matching row of the table below. Item 4 stays on the main agent —
a subagent cannot see the skill listing, so its "not found" proves nothing.

1. **Read `.claude/README.md`** — the inventory is the fastest whole-picture view.
2. **List the repo layer**: `.claude/{agents,commands,skills,workflows}/`.
3. **List the user layer**: `~/.claude/skills/`, `~/.claude/commands/`, `~/.claude/agents/`.
   These already exist globally and are **never** vendored into this repo: `handover`,
   `do_not_commit`, `do_not_add_comments`, `brief`, `staff`, `reclaim_machine`.
4. **Check the plugin and built-in layer**: the skill listing in this session and
   `ToolSearch` — `/code-review`, `/simplify`, `/security-review`, `plugin-authoring`,
   `workflow-authoring` and the like. Something provided globally or by a plugin should be
   referenced, not copied.

Grep for the **job**, not the name: someone asking for "a thing that checks the disclosure
section" will never find `/council` by name. `grep -ril "<verb> <object>" .claude ~/.claude/skills`.

| Finding | What to do |
|---|---|
| **Nothing similar** | Continue to step 2. |
| **Already exists in the repo** | Name the file and stop. Propose editing it. |
| **Already exists globally or in a plugin** | Stop. Propose using it; at most add a one-line mention in `.claude/README.md`. |
| **Something does part of it** | Propose extending that one. A sibling is the wrong default. |
| **Real overlap, maintainer still wants it separate** | Continue, and record it in step 5. |

This skill owns **whether tooling should exist** — adding, extending, merging, retyping,
refusing. Shortening existing files is `/feedbacks_check`'s job.

## Step 2 — Pick the type

| Type | Use when | Lives in |
|---|---|---|
| **Skill** | A procedure that should fire on intent without being named. Can carry reference files and scripts. | `.claude/skills/<name>/SKILL.md` |
| **Command** | An explicit directive the user types, or the slash entry to a skill. | `.claude/commands/<name>.md` |
| **Agent** | Work that must run in its own context and return only a summary: broad reads, long test runs, deep review. Also the only way to pin a cheaper or dearer model for a job. | `.claude/agents/<name>.md` |
| **Workflow** | Deterministic fan-out: N parallel lenses, a per-item pipeline. Control flow the model should not decide. | `.claude/workflows/<name>.js` |

A same-named command + skill is the normal shape: the command is a ~10-line slash entry,
the skill holds the procedure. Copy `.claude/commands/app_feedback.md` and its skill.

## Step 3 — Write it

- **Frontmatter is mandatory.** `name:` + `description:` on every skill and agent;
  `description:` + `argument-hint:` on every command. Write the description as *when to use
  this*, in the words the user would actually say.
- **Pin `model:` and `effort:` on every agent.** Implementation and judgment → `opus`;
  reading, running tests, mechanical work → `sonnet`; a pure lookup → `haiku`.
- **A read-only agent says so and gets read-only tools.** No `Write`/`Edit` for a reporter.
- **A workflow's `export const meta` is a pure literal** — no variables, calls, spreads or
  template interpolation — and the script never calls `Date.now()`, `Math.random()` or an
  argless `new Date()`. Load the `workflow-authoring` skill before writing one.
- **Anything acting outside the repo pauses for explicit approval** — pushing, opening a
  PR or issue, bumping `.claude-plugin/plugin.json`, publishing a release.
- **Anything it writes that must outlive the session gets a row in `.claude/README.md`.**
  Never the repo root, never a path the next session cannot find.
- A "never" rule ships with enforcement in the same change — a `validate.py` check, a test
  or a `.gitignore` line — not prose alone.
- Keep it as short as it can be and still be correct.

## Step 4 — Check it against the project rules

- **Public repo, and it ships.** The marketplace source is the repo root, so every file in
  `.claude/` is published on GitHub and copied into each user's plugin install. Text only;
  no absolute home paths, user names, emails, tokens, session ids or UUIDs. `validate.py`
  fails on these.
- Tooling that changes product code inherits the gates in `README.md` → *Development*:
  `claude plugin validate .` and `claude plugin test .` pass, and any new program, read,
  network destination, stored setting or prompt submission is added to `README.md` →
  *What it runs, reads and sends* in the same change.
- No secrets in the file, and none printed to the transcript.

## Step 5 — Update `.claude/README.md` in the same change

- Add the row to the matching inventory table. A new kind of output gets its own row.
- If step 1 found a real overlap and the maintainer chose to proceed, record it with the
  accepted reason.
- Current state only: no changelog, no "renamed from", no dates.
- Run `python3 -I .claude/skills/validate-tooling/scripts/validate.py` — it fails when a
  tooling file is missing from the inventory.

## Finish

Report: what step 1 checked (repo, user and plugin layers), the type chosen and why, the
files written, the model/effort pinned, and the inventory row added. If you recorded an
accepted overlap, say so plainly.
