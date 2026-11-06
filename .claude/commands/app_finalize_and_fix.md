---
description: Run every open-jarvis-talk check (plugin tests, plugin validate, shell, Python and Swift syntax, TypeScript type-check) on this checkout, fix whatever fails in place through one agent, re-run until green, then STOP before any commit so the founder can review.
argument-hint: '[--no-fix] (optional: report only, edit nothing)'
allowed-tools: Agent, Workflow, AskUserQuestion, Read, TaskCreate, TaskUpdate, TaskList, Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git rev-parse:*), Bash(ls:*)
---

Finalize the plugin: run every check, get each failure **fixed at its root**, and leave the
working tree green and **uncommitted** for the founder to review.

Arguments: `$ARGUMENTS`
- `--no-fix`: run and report only; edit nothing.

## Absolute rule

**No `git commit`, no `git push`, no branch, no PR, no version bump, no release.** The job ends
at a green, uncommitted working tree and a summary. The founder decides what to commit.

## Who does what

- The checks run in **one `checks-runner`** (`model: "sonnet"`), never on you. Its agent file
  carries the six checks, the report format and the only two allowed SKIPs (`swiftc` not on
  PATH; `.claude-plugin/types/` missing). `CLAUDE.md` → *Checks* is the human-readable list.
- Fixes go to **one `general-purpose` agent** (`model: "opus"`) that edits this checkout in place.
  Never a fan-out (parallel fixers race on `hooks/register.tsx`), and never `developer` (it works
  in its own worktree and cannot touch this checkout).
- You dispatch, judge the short returns, and report. Use the Agent tool; use a single-agent
  Workflow instead only when the user asks for one.
- Another session may be editing this checkout. Note `git status --short` before you start; the
  fixer touches only files a failure points at and never reverts, stashes or reformats changes it
  did not make.

## Steps

1. **Track the work.** TaskCreate: run checks, fix failures, confirm green, report (skip if
   TaskCreate is missing).
2. **Resolve the target.** `git rev-parse --show-toplevel` once; paste that absolute path into
   every prompt as the only directory to work in. Record `git log --oneline -1` and
   `git status --short`.
3. **Run the checks.** One `checks-runner` in that directory. It returns the six-line table and,
   for each FAIL, a short excerpt or a scratchpad log path.
   - **SKIP is a coverage hole, not a pass.** Report each one with its reason. A tsc SKIP for a
     missing `.claude-plugin/types/` clears once the engine has loaded the plugin (start a Claude
     Code session with it enabled); say that, do not create the folder by hand.
   - A tsc error in `tests/` is the known pre-existing set and not part of this check; an error
     in `hooks/` or `types/` is.
4. **`--no-fix`** → report the table and STOP.
5. **Fix every failure.** One `general-purpose` (opus) agent, with the target path, the
   failure excerpts (or log paths), and these rules in the prompt:
   - The Absolute rule above, in those words: leave every edit uncommitted.
   - **Fix the code, not the check:** no deleted or skipped tests, no loosened assertions, no
     `@ts-ignore`, no relaxed config.
   - **A test that contradicts the code is not automatically right.** Check `git log` and
     `git blame` on both sides. If the code was changed on purpose later and the test is stale,
     update the test to the new behavior, and state the commit as evidence.
   - Hold to `CLAUDE.md` → *Plugin rules learned the hard way* (for example: timers that write
     state after a test ends need `.catch(() => undefined)`; conversation state goes through
     `setTalk`).
   - Never run the listener, `voice/speak.py`, or `setup/jarvis-setup.sh install|tools|dictation`;
     no global installs. A missing tool is reported with the exact install command.
   - Public repo: no personal path, email, token or key in any edit.
   - A real judgment call (reverting a deliberate change, changing behavior users see, changing
     what the plugin runs, reads or sends) is returned **unfixed** with the options. You ask the
     founder with `AskUserQuestion` before re-dispatching it.
   - Return: per failure, the root cause and the fix in one line each, plus the files touched.
6. **Confirm green.** Re-run step 3 and loop fix → re-run until no FAIL. At most 3 fix rounds;
   anything still red after that goes to the report with the root cause as far as it is known.
7. **Report and STOP.**
   - The six-check table from the last run, with every SKIP and its reason.
   - Each failure: root cause and exactly how it was fixed.
   - `git status --short` and `git diff --stat`, separating files the fixer touched from changes
     that were already in the tree at step 2.
   - Judgment calls to review: stale-test updates, any behavior change (it then also needs a
     README update and, when it ships, a version bump: say which, patch or minor).
   End with: the tree is green and uncommitted, ready for review.
