---
name: app_feedback
description: Collect what you struggled with in THIS session and write it as lesson files under .agent-feedback/. Run at the end of every job, unprompted. Only mistakes that happened here. Never reads, evaluates, or applies past logs — that is the maintainer's /feedbacks_check. Slash entry: /app_feedback.
---

# app_feedback

Look back over **this session only** and write down what you got wrong, so the same
mistake does not repeat next time.

**Run this at the end of every job — unprompted.** Finishing a command, an agent pipeline,
a `/council` run or an ad-hoc working session is the trigger; you do not wait to be asked.
Write the files **silently**. Report what you wrote only when the user typed
`/app_feedback` themselves.

**Scope is this session.** Do not read, cluster, evaluate, or apply the existing logs under
`.agent-feedback/` — that is `/feedbacks_check`, which **only the maintainer runs**. Do not
edit any command, skill, agent, workflow, `.claude/README.md` or `README.md` here, and
never propose such edits in chat. This skill only writes new lesson files.

## Steps

### 1. Review this session

Walk the session from the start. Look for moments where:

- the user corrected you, or repeated something because you missed it the first time;
- you asserted something about the engine API (`claude-code` hooks, `$.*` calls, the
  `claude-code/testing` harness), macOS, or the plugin that turned out to be false;
- you took a path that failed, then succeeded a different way (a test that only passed on
  the second approach, a `claude plugin validate .` failure you had to work around);
- you delegated to the wrong place, or did on the main agent what belonged in an agent;
- a rule in `.claude/` or `README.md` already covered it and you did not follow it.

A mistake that a rule already covers still counts — the lesson is then about why the
existing rule did not reach you.

### 2. Gate — write a file only when ALL hold

1. **Concrete moment in this session** — you can point at what happened, not a feeling.
2. **Durable** — it would recur without an instruction change.
3. **One specific surface** — a single path: a `.claude/` command, skill, agent or
   workflow, `.claude/README.md`, or the `README.md` section that should have said it.
4. **Confident and minimal** — a small edit you are sure of, not a rewrite fantasy.

Drop everything else. A near-instant self-correction that cost nothing is not a lesson.
No file is a fine outcome.

### 3. Write one file per lesson

`.agent-feedback/YYYY-MM-DD_HHMMSS_<short-slug>.md`

```md
# <one-line lesson>
- date: <ISO-8601>
- session: <command or task, e.g. council / ad-hoc>
- surface: <repo-relative path to the file that should change>
- moment: <what went wrong this session, one or two sentences>
- why: <root cause>
- proposal: <smallest edit; current → proposed when possible>
- simplify: <yes/no — did verbosity or duplication contribute?>
```

One lesson → one file. If a lesson duplicates a log already in `.agent-feedback/` or
`.agent-feedback/.processed/` (same lesson, or same filename), skip it.

### 4. Report (explicit `/app_feedback` only)

List what you wrote — filename plus the one-line lesson — or say in one line that nothing
met the gate. Do not summarize the whole session.

## Gotchas

- **This repo is public.** A lesson file is published with the next push, and it ships in
  every user's plugin install (the marketplace source is the repo root). Write no absolute
  home paths (use `~` or a repo-relative path), no user names, emails, tokens, session or
  run ids, UUIDs, and no quotes of what the user said to Jarvis or of transcript content.
  Describe the mistake, not the person.
- Writes to `.agent-feedback/` and nowhere else.
- Do not commit unless the user asked, or the calling command commits these files by exact
  path.
- **Never run `/feedbacks_check` yourself, and never offer to.** Do not report how many logs
  are waiting.
