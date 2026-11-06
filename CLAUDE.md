# CLAUDE.md — working in this repo

## Response style — every reply

Use plain language, short replies, active voice and American spelling.
Lead with outcomes; explain a technical term once when the user needs it.
Use technical detail when the user asks how.

## What this repo is

Open Jarvis Talk, a Claude Code plugin: a voice companion for a Claude Code session on macOS.
The repository is **public**: never commit personal paths, emails, tokens or connector ids.

| Path | What it is |
|---|---|
| `hooks/register.tsx` | The one hooks module: panes, the voice loop, prompts sent to the model, settings. Plugin API from `claude-code`; JSX compiles against `h`; no DOM, no Node, `$` reaches everything outside. |
| `types/index.d.ts` | The plugin's `PluginState` contract. Every atom key the module uses is declared here. |
| `tests/open-jarvis-talk.test.tsx` | Tests on `claude-code/testing` (mocked clock, processes, model forks). |
| `voice/listen.swift` · `voice/speak.py` | The speech listener (built on the user's Mac at setup) and the Kokoro voice. |
| `setup/jarvis-setup.sh` | `check` / `install` / `tools` / `dictation`: what the setup screen runs. |
| `.claude-plugin/plugin.json` | Name and `version`. Users get an update only when the version changes. |
| `README.md` · `llms.txt` | User docs. Keep them in step with behavior. |

`.claude-plugin/types/` is written by the engine when it loads the plugin and is gitignored.

## Checks — run before finalizing any change

1. `claude plugin test .`: every test passes.
2. `claude plugin validate .`: passes.
3. Type-check `hooks` and `types` with tsc against `.claude-plugin/types/` when that folder exists. The test file has known pre-existing type errors, so it is not part of this check.
4. `bash -n setup/jarvis-setup.sh` · `python3 -m py_compile voice/speak.py` · `swiftc -typecheck voice/listen.swift` (when swiftc is present), for changes there.

A behavior change comes with a test for it and a README update. The version in `.claude-plugin/plugin.json` is bumped once per cycle (patch for fixes, minor for features): after its last merge, `/app_cycle` lands one version-bump PR. A change made outside a cycle bumps it itself. Cycle PRs leave it alone. There is no separate release step: merging to `main` with a new version is the release.
Fix a failing check; never weaken or skip it.

## Plugin rules learned the hard way

- An `Svg` is a leaf and cannot sit inside a `Button` (a Button holds only strings and `Text`). To make a drawing pressable, lay a `plain` Button over it in a `position="absolute"` Box (the orb's `tap-orb-area`). Give that Button blank children and no `label`: the desktop draws a `label` as visible text in place of the children.
- Write conversation state through `setTalk` (it re-arms the tap under the orb); never `update($, talk, …)` directly.
- Timers that write state after a test ends must `.catch(() => undefined)`, or the test file fails on an unhandled rejection.
- What Jarvis sends to the session is the user's request relayed, not Jarvis's plan (`COMMAND_RULES` in `hooks/register.tsx`).

## Work routing

- Full cycle over GitHub Issues, version bump included: `/app_cycle`. Run every check and fix what fails: `/app_finalize_and_fix`.
- Named agents live in `.claude/agents/`: `developer`, `code-reviewer`, `researcher`, `web-researcher`, `checks-runner`. Pin `subagent_type`, `model` and `effort` on every spawn.
- The tooling inventory is `.claude/README.md`. Add tooling with `/add-tooling`, audit it with `/validate-tooling`; both keep the inventory current.
- `handover`, `do_not_commit`, `do_not_add_comments`, `brief`, `staff` and `reclaim_machine` are user-level skills: available here without a copy in this repo.

## Agent feedback log

At the end of every job, run `/app_feedback` silently: record one concrete, repeatable lesson from this session in `.agent-feedback/`, if there is one. That folder is gitignored: lessons stay on this Mac and are never pushed. Never run `/feedbacks_check`; the maintainer runs it.
