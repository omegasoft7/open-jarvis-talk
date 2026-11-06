# `.claude/` — the AI tooling of this repo

The inventory of every agent, command, skill and workflow an AI session can run here, and where
AI-written output lands. **Keep it current:** a tooling file added, removed, renamed or given a new
job updates this file in the same change (`/add-tooling` and `/validate-tooling` enforce it).
Current state only, no changelog.

The repository is public, and the plugin installs from its root, so everything here also ships with
every install: no personal paths, emails, tokens or ids, ever.

User-level skills that are available here without a copy in this repo: `handover`, `do_not_commit`,
`do_not_add_comments`, `brief`, `staff`, `reclaim_machine`. Never copy them into `.claude/`.

## Where AI-written output lands

| Path | What is in it | Written by | Read when |
|---|---|---|---|
| `.agent-feedback/*.md` | One lesson per file from a session that got something wrong; `.processed/` is the applied archive. **Local only:** gitignored, never pushed. | every session, silently, via `/app_feedback` | harvested by the maintainer with `/feedbacks_check` |
| GitHub Issues and PRs | The cycle's tickets, `status:*` labels, review verdicts as PR comments | `/app_cycle`, `developer`, `code-reviewer` | when picking up or reviewing work |
| session scratchpad | Everything throwaway: logs, drafts, PR bodies, plans | anything | never; it does not survive the session |

## Agents

Pin `subagent_type`, `model` and `effort` on every spawn. Each returns a short structured result
and writes long output to a scratchpad file.

| Agent | Responsible for | Model / effort |
|---|---|---|
| `developer` | Implements or fixes one GitHub issue end to end in an isolated worktree: smallest correct change, tests, README, commit, push, PR that says `Closes #<n>`. Leaves the version alone. | opus / xhigh |
| `code-reviewer` | Quick, blocker-only review of one PR against its issue: re-runs the checks, rejects only for real blockers (warnings and nits are notes and still approve), posts the verdict as a PR comment, moves the `status:*` label. Never edits, never merges, never `gh pr review --approve`. | sonnet / high |
| `researcher` | Read-only investigation of this codebase, its git history and the engine's plugin types; returns findings with `file:line` evidence. | sonnet / medium |
| `web-researcher` | Read-only external research (Apple Speech, kokoro-onnx, Claude Code docs); returns quotes and URLs. | sonnet / medium |
| `checks-runner` | Runs the six local checks and reports PASS / FAIL / SKIP for each, with failure excerpts. Never edits. | sonnet / low |

## Commands

| Command | What it does |
|---|---|
| `/app_cycle` | One sprint over GitHub Issues: refine into a ranked set, stop for approval, then implement, quickly review and fix (at most 2 rounds) each issue in parallel, merge green PRs one at a time, bump the version once, report. Options in the command. |
| `/app_finalize_and_fix` | Runs every check on this checkout and fixes what fails, uncommitted; `--no-fix` reports only. |
| `/council` | Five-lens review of a diff or plan (voice UX, plugin API, macOS privacy, setup and supply chain, docs truth) and one synthesized report. Runs `council.js`. |
| `/app_feedback` | Writes this session's lessons to `.agent-feedback/`. Run at the end of every job, unprompted. |
| `/feedbacks_check` | **Maintainer-run only.** Applies what the lesson pile teaches, then thins the tooling text. |
| `/add-tooling` | Adds a skill, command, agent or workflow correctly, after proving nothing already covers the job, and updates this file. |
| `/validate-tooling` | Audits every tooling file here with `validate.py` plus qualitative checks, fixes findings, re-runs until clean. |

## Skills

The commands above whose body is a procedure are thin entries; the text lives in the same-named skill.

| Skill | Path |
|---|---|
| `app_feedback` | `.claude/skills/app_feedback/SKILL.md` |
| `feedbacks_check` | `.claude/skills/feedbacks_check/SKILL.md` |
| `add-tooling` | `.claude/skills/add-tooling/SKILL.md` |
| `validate-tooling` | `.claude/skills/validate-tooling/SKILL.md`, with `.claude/skills/validate-tooling/scripts/validate.py` |

## Workflows

| Workflow | Used by |
|---|---|
| `council.js` | `/council`: five persona agents in parallel, then a chair that synthesizes. Runs only when the user opts into a workflow. |
