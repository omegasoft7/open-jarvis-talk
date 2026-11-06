export const meta = {
  name: 'council',
  description: 'Five persona agents review one diff or plan for the Open Jarvis Talk plugin in parallel, then one chair cross-synthesizes into a single ranked report',
  whenToUse: 'Invoked by /council when the complexity gate says the change or plan is risky enough for five lenses. Read-only; never posts anywhere.',
  phases: [
    { title: 'Council', detail: 'five personas in parallel, each with its own lens' },
    { title: 'Chair', detail: 'verify, score confidence, dedupe, rank', model: 'opus' },
  ],
}

const A = typeof args === 'string' ? JSON.parse(args) : args || {}
const mode = A.mode === 'plan' ? 'plan' : 'review'
const subject = A.subject || ''
const context = A.context || ''
const scope = A.scope || ''

if (!subject) {
  throw new Error('council workflow got no subject (a diff command, a PR number, or the plan text)')
}

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    persona: { type: 'string' },
    checked: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          evidence: { type: 'string' },
          location: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['title', 'severity', 'evidence', 'location', 'fix'],
      },
    },
    commendations: { type: 'array', items: { type: 'string' } },
  },
  required: ['persona', 'checked', 'findings', 'commendations'],
}

const REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string' },
    blockers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['P0', 'P1'] },
          confidence: { type: 'integer' },
          personas: { type: 'array', items: { type: 'string' } },
          evidence: { type: 'string' },
          location: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['title', 'severity', 'confidence', 'personas', 'evidence', 'location', 'fix'],
      },
    },
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['P2', 'P3'] },
          confidence: { type: 'integer' },
          location: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['title', 'severity', 'confidence', 'location', 'fix'],
      },
    },
    commendations: { type: 'array', items: { type: 'string' } },
    discarded: { type: 'array', items: { type: 'string' } },
    notCovered: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'blockers', 'suggestions', 'commendations', 'discarded', 'notCovered'],
}

// Product-specific lenses: each names the promises and failure modes only this plugin has.
const PERSONAS = [
  {
    key: 'voice-ux',
    title: 'Voice UX & conversation flow',
    lens: [
      'The talk loop in hooks/register.tsx and its TalkState values (off, listening, thinking, speaking, paused): every transition reachable, none stuck. Tap-to-send, tap-to-interrupt, Pause/Resume and End conversation each stop the right process at once.',
      'Approval by voice: "send it" and "discard" must never fire from a misheard or partial transcript, from Jarvis hearing its own spoken reply, or from a stale draft. A path that submits a draft the user did not approve is P0.',
      'Goodbye detection: ending on a phrase the user did not mean as goodbye, or failing to end on "goodbye" / "stop".',
      'The tap target delay and double-tap debounce described in README.md -> Using it: a tap meant for "send now" must never stop Jarvis just as it starts thinking.',
      'What is spoken: reply length for the chosen reply style, markdown or code read aloud, text-only mode still showing everything, settings applying from the next answer.',
    ].join('\n- '),
    notFindings: 'Do not raise copy taste or voice choice. Speech-recognition accuracy itself belongs to macOS; only how the plugin reacts to a wrong transcript is in scope.',
  },
  {
    key: 'engine',
    title: 'Plugin API & engine correctness',
    lens: [
      'hooks/register.tsx against the `claude-code` module API and types/index.d.ts: hook events (session.start, command.run, ui.close, ui.render), each calling `next` where it must, and matching only the plugin\'s own commands and panes.',
      'Atoms and $.store: a changed stored or atom value shape without a new `shape` version, settings read back with a missing field, defaults that disagree with README.md -> Settings.',
      '$.process.spawn / $.process.run lifecycle: every spawned listener or voice is killed on pause, interrupt, pane close and session end; no orphan keeps the microphone open; errors are caught, not thrown into the render.',
      '$.clock timers and $.model.fork calls: a timer never cleared, a fork result used after the conversation ended, races between an answer arriving and the user interrupting.',
      'Tests: the change has a case in tests/open-jarvis-talk.test.tsx (claude-code/testing harness) for the success AND the failure path; a test that would pass for the wrong reason (mocking the thing under test, asserting on a transient state).',
    ].join('\n- '),
    notFindings: 'Do not propose an abstraction or helper the module does not already use. Correct-but-inconsistent with the rest of register.tsx is a finding; clean-but-unprecedented is not an improvement.',
  },
  {
    key: 'privacy',
    title: 'macOS, privacy & consent',
    lens: [
      'README.md -> "What it runs, reads and sends" is a contract with users and directory reviewers. Any new program started, file read, network destination, stored setting, env var, or prompt submission that is not listed there is a P1; one that contradicts it is P0.',
      '$.prompt.submit sends exactly the approved draft text, nothing added. $.prompt.fill only fills the box.',
      'Shell use: `zsh -c` / `bash` scripts stay fixed constants; settings values and spoken text reach them only as separate positional arguments, never interpolated into the script string.',
      'Files: everything the plugin writes stays under ~/.claude/jarvis; logs carry no transcript or question text beyond what is already disclosed; the uninstall step in README.md still removes everything.',
      'claude -p research: only web search and web fetch allowed; file-edit and shell tools stay blocked; no credential, key or token is read or set.',
      'macOS permissions: microphone, speech recognition and Dictation states each produce a clear message, not a silent stop.',
    ].join('\n- '),
    notFindings: 'The `zsh -c` wrappers that print a process id first, running `claude -p` through a login shell, and setting CLAUDECODE to empty are deliberate and documented in README.md. Never raise them as such; only a change to what they run or pass is in scope.',
  },
  {
    key: 'setup',
    title: 'Setup, install & supply chain',
    lens: [
      'setup/jarvis-setup.sh: nothing installs before the user presses Install; every download is checked against a pinned SHA-256; nothing fetched with curl is executed; uv comes from setup/uv-requirements.txt with hashes; voice/requirements.txt pins exact versions.',
      'Re-running setup is safe (idempotent), a failed step leaves a state the next run can repair, and the `check` output still matches the Setup type in types/index.d.ts.',
      'Hardware gates: Apple Silicon / memory / disk checks for the natural voice, the fallback to /usr/bin/say when Kokoro is missing or fails, Xcode Command Line Tools for building voice/listen.swift.',
      'Sizes, versions and sources quoted in README.md -> First use match what the script actually installs.',
      'voice/listen.swift and voice/speak.py: argument handling, exit on stdin close or signal, nothing written outside ~/.claude/jarvis.',
    ].join('\n- '),
    notFindings: 'Do not propose a new package manager, installer framework or dependency. Pinning that is already exact is not a finding.',
  },
  {
    key: 'maintainability',
    title: 'Maintainability, release & docs truth',
    lens: [
      'Docs drift: a line in README.md (Using it, Settings, What it runs, the directory-reviewer answers, Troubleshooting) or llms.txt that the change makes untrue.',
      'Release hygiene: a user-visible change without a version bump in .claude-plugin/plugin.json, or a bump that disagrees with the change; `claude plugin validate .` and `claude plugin test .` expected to pass.',
      'The plugin ships from the repo root and is public: no binary added to the plugin tree (pictures live on the media branch), no personal path, email or token in any file.',
      'Dead code, a setting with no remaining reader, naming that will mislead the next reader, comments that narrate a change instead of explaining a non-obvious why.',
    ].join('\n- '),
    notFindings: 'Do not raise formatting or anything `claude plugin validate .` already fails on — that runs separately.',
  },
]

const subjectBlock = mode === 'review'
  ? [
      'SUBJECT — the change under review (run this yourself to see it):',
      subject,
      scope ? 'SCOPE: ' + scope : '',
      'Read the actual diff before judging. Do not review code outside it, except to open the',
      'surrounding code in hooks/register.tsx or a sibling script when you need to know how this',
      'plugin already solves the same problem.',
    ].filter(Boolean).join('\n')
  : [
      'SUBJECT — the plan under deliberation:',
      subject,
      'This is a plan, not code. Judge whether it will work, what it breaks, what it forgets, and',
      'what it costs. Ground every objection in the real code or README.md — check whether the',
      'thing it proposes already exists before arguing about how to build it.',
    ].join('\n')

phase('Council')

const opinions = await parallel(
  PERSONAS.map((p) => () =>
    agent(
      [
        'You sit on a review council for the Open Jarvis Talk Claude Code plugin as the **' + p.title + '**',
        'member. You are read-only: you never edit a file, never commit, never post to GitHub.',
        '',
        subjectBlock,
        context ? '\nCONTEXT the orchestrator gathered:\n' + context : '',
        '',
        'YOUR LENS — look at these and let the other members cover the rest:',
        '- ' + p.lens,
        '',
        'NOT A FINDING: ' + p.notFindings,
        '',
        'Rules for every finding you return:',
        '- Cite it. `location` is a real file:line you opened, or the exact plan sentence. A finding',
        '  you cannot point at does not go in the list.',
        '- Severity: P0 = a prompt submitted without approval, an undisclosed read/send/program, a stuck',
        '  open microphone, data loss, or a release blocker. P1 = a real user-visible bug or a broken',
        '  documented promise. P2 = worth fixing. P3 = a nit.',
        '- `fix` is the smallest change that resolves it, in one sentence.',
        '- A pre-existing problem the diff did not touch is NOT a finding. Say it in `checked` instead.',
        '- Nothing found in your lens is a normal, useful result. Return an empty findings array and',
        '  say in `checked` what you actually looked at — never pad the list.',
        '- `commendations`: at most two, and only for a decision that was genuinely hard to get right.',
      ].join('\n'),
      {
        label: 'council:' + p.key,
        phase: 'Council',
        agentType: 'researcher',
        model: 'sonnet',
        effort: 'high',
        schema: FINDINGS_SCHEMA,
      },
    ),
  ),
)

const heard = opinions.filter(Boolean)
const silent = PERSONAS.filter((p, i) => !opinions[i]).map((p) => p.title)
log(heard.length + '/' + PERSONAS.length + ' council members reported' + (silent.length ? ' (no answer from: ' + silent.join(', ') + ')' : ''))

if (!heard.length) {
  return { verdict: 'NO COUNCIL RESULT — every persona agent failed', blockers: [], suggestions: [], commendations: [], discarded: [], notCovered: PERSONAS.map((p) => p.title) }
}

phase('Chair')

const report = await agent(
  [
    'You chair the review council for the Open Jarvis Talk plugin. The members reported',
    'independently. Turn their opinions into ONE report. You are read-only: you never edit,',
    'commit, or post anywhere.',
    '',
    subjectBlock,
    '',
    'THE OPINIONS:',
    JSON.stringify(heard, null, 2),
    '',
    silent.length ? 'NO ANSWER FROM: ' + silent.join(', ') + ' — list each in notCovered.\n' : '',
    'Your job, in this order:',
    '1. **Verify before you rank.** Open the cited location for every P0 and P1 and confirm the',
    '   finding is real. A member that misread the code is the normal failure mode, and a confident',
    '   wrong blocker costs more than a missed nit.',
    '2. **Score confidence 0-100** on each surviving finding: 0 = false positive or pre-existing.',
    '   25 = possible, not verifiable. 50 = real but a nit or a rare case. 75 = very likely real, or',
    '   contradicts README.md -> "What it runs, reads and sends". 100 = verified, you opened it and saw it.',
    '   **Discard everything under 80** and name it in `discarded` with one clause of why.',
    '3. **Merge duplicates.** Two members hitting the same thing from different lenses is the strongest',
    '   signal there is — merge into one entry, list both in `personas`, and rank it first.',
    '4. **Split the output**: P0/P1 into `blockers`, P2/P3 into `suggestions`.',
    '5. **`notCovered`**: what this council could NOT judge — a member that did not answer, a file',
    '   nobody opened, behavior only a real run on a Mac can settle (microphone, speech recognition,',
    '   Kokoro audio, the desktop app UI). An unrun check is never an all-clear.',
    '6. **`verdict`**: two sentences. What the change or plan gets right, and the one thing that must',
    '   be resolved before it proceeds. No blockers is a legitimate verdict.',
  ].filter(Boolean).join('\n'),
  {
    label: 'council:chair',
    phase: 'Chair',
    agentType: 'researcher',
    model: 'opus',
    effort: 'high',
    schema: REPORT_SCHEMA,
  },
)

if (!report) {
  return { verdict: 'CHAIR FAILED — raw council opinions returned unsynthesized', blockers: [], suggestions: [], commendations: [], discarded: [], notCovered: ['synthesis'], raw: heard }
}

return { ...report, membersHeard: heard.length, membersSilent: silent }
