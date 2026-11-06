---
description: Release open-jarvis-talk. Merge any remaining approved PRs to main one at a time behind green checks, bump the version in .claude-plugin/plugin.json (patch for fixes, minor for features), bring the README in step, merge the release PR, tag v<version> and cut a GitHub Release. Users then get it through the plugin marketplace update. Asks the founder before anything public happens.
argument-hint: '[patch|minor|major|X.Y.Z] [dry-run] [draft] [prerelease] (optional: default, the bump the merged changes call for)'
allowed-tools: Agent, AskUserQuestion, Read, Write, TaskCreate, TaskUpdate, TaskList, Bash(gh release:*), Bash(gh pr:*), Bash(gh issue:*), Bash(gh repo:*), Bash(git fetch:*), Bash(git log:*), Bash(git tag:*), Bash(git show:*), Bash(git status:*), Bash(mkdir:*)
---

Repo: `omegasoft7/open-jarvis-talk`, **public**, default branch `main`. The version lives
only in `.claude-plugin/plugin.json`; the marketplace (`.claude-plugin/marketplace.json`) serves
the plugin from `main`, and **users get an update only when that version changes**. So the
moment the version bump lands on `main` is the moment every user can get this release. The tag
and the GitHub Release are the record. There are no stores and no deploy infrastructure.

Arguments: `$ARGUMENTS`
- `patch` / `minor` / `major` / `X.Y.Z`: the bump, overriding the computed one.
- `dry-run`: compute everything and show the plan; write nothing, ask nothing.
- `draft` / `prerelease`: passed to `gh release create`.

## Who does what

- You decide the version, draft the notes, ask the founder, and report.
- Reads go to one `researcher` (sonnet); checks to `checks-runner` (sonnet); every git and gh
  write (merges, the release branch, the tag, the GitHub Release, issue comments) to one
  `general-purpose` **release agent** (sonnet, no worktree), whose prompt carries the founder's
  go-ahead question and answer verbatim.
- Another session may be editing the main checkout: never stash, reset, commit or clean it.
  All release work happens in throwaway worktrees.

## Steps

0. **Read the state** *(one `researcher`, returns values plus a scratchpad path)*:
   `git fetch origin --tags`; `origin/main` SHA; `version` in `plugin.json` on `origin/main`;
   the latest `v*` tag (`git tag --sort=-v:refname`); the merged PRs and their issues since that
   tag (no tag yet → since the last commit that changed `version`); open PRs whose issue is
   labelled `status:approved`; and, per merged PR, whether it is a **feature** (new behavior or
   setting) or a **fix**, plus the bump its Docs line asked for. It also checks whether any of
   those PRs changed what the plugin runs, reads or sends, and whether the README's
   *What it runs, reads and sends*, *Settings* and *Using it* sections already say so.
   If `version` on `main` is already ahead of the latest tag (bumped but never tagged), note it:
   step 1 offers to tag that version as-is instead of bumping again (then step 4 opens a
   release PR only for README catch-up, and skips it when there is none).

1. **Decide the version and the notes, and ask once.**
   - Version: `minor` if any included change is a feature, else `patch`; `major` only when the
     founder says so. An argument overrides it.
   - Notes: a few short bullets on what changed **for the user**, in plain language, each
     linking its issue (`#n`). Drop internal noise (refactors, test-only, tooling). Every
     setting or button name matches the wording in `hooks/register.tsx` and the README. No
     personal path, email or token. Write them to `<scratchpad>/release/notes.md`.
   - Show the plan: current → new version, the approved open PRs to include (each can be left out), the notes, the README catch-up the
     researcher found, and "the bump on `main` ships to every user; the tag and the Release are
     public and should never be moved or deleted afterwards".
   - One `AskUserQuestion`, safe option first: **Change it** · **Release vX.Y.Z** · **Cancel**.
     Change → take the edits (version or notes as free text) and ask again. Cancel → stop, no
     write. `dry-run` stops before the question.

2. **Merge what is approved and still open** *(release agent, after the "Release" answer)*.
   The PRs the founder included go through the merge queue exactly as
   `/app_cycle` step 6 describes: one at a time, rebased on `origin/main`, every check green in a
   throwaway worktree, `gh pr merge --squash --match-head-commit`. A held PR stays out of this
   release; if that drops the only feature, the bump falls back to `patch` (tell the founder).

3. **Gate `main`.** One `checks-runner` on a fresh detached worktree of `origin/main` (after
   step 2's merges), with `.claude-plugin/types/` copied in when the main checkout has it. Any
   FAIL stops the release; route it to `/app_finalize_and_fix` or a fix issue. A `swiftc` SKIP
   blocks only when `voice/listen.swift` changed since the last tag.

4. **Release PR** *(release agent)*. In a throwaway worktree off `origin/main`, branch
   `release/vX.Y.Z`: set `version` in `.claude-plugin/plugin.json`, apply the README (and
   `llms.txt`, if the summary or install steps changed) catch-up from step 0, naming the exact
   sections. Dispatch this agent with `model: "opus"` when there is README text to write,
   `sonnet` when it is the version line only. Commit `chore(release): vX.Y.Z`, push, open the PR
   with the notes as the body. Run every check on that head (same as step 3); green →
   `gh pr merge <N> --squash --delete-branch --match-head-commit <sha>`.

5. **Tag and publish** *(release agent)*. `git fetch origin`; take the squash commit on
   `origin/main` and confirm `git show <sha>:.claude-plugin/plugin.json` carries `X.Y.Z`. Then
   `git tag -a vX.Y.Z <sha> -m "vX.Y.Z"`, `git push origin vX.Y.Z`, and
   `gh release create vX.Y.Z --verify-tag --title "vX.Y.Z" --notes-file <notes>` (plus
   `--draft` / `--prerelease` when passed). Read it back with
   `gh release view vX.Y.Z --json url,tagName,isDraft`.

6. **Tell the reporters** *(release agent)*. On each closed issue in the release, one comment:
   `Released in vX.Y.Z: <release url>`. Skip issues that already carry it.

7. **Report.** The new version and the Release URL; the PRs and issues it contains; anything
   held or left out and why; the final `main` SHA and its check verdict. Then how to pick it up:
   `claude plugin marketplace update open-jarvis-talk`, then update the plugin from `/plugin`
   (a running session reloads it on restart). Say plainly anything that still needs the founder,
   such as a voice check on a Mac that a reviewer listed.

## Guardrails

- Nothing public before the founder's "Release" answer: no merge, no push, no tag, no Release,
  no issue comment.
- Never force-push `main`; never move, delete or re-push a published tag. A bad release is fixed
  by a new patch release.
- The version changes only in `.claude-plugin/plugin.json`, once per release: in the release PR, or in a change that shipped on its own outside a cycle (step 1 then offers to tag it as-is). Cycle PRs leave it alone.
- Never bypass a red check, and never weaken a check to get green.
- Never run the listener, `voice/speak.py`, or `setup/jarvis-setup.sh install|tools|dictation`
  as part of a release.
