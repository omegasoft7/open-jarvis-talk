import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ChatEntry, ReplyStyle, JarvisSettings, Setup, SetupCheck, TalkState } from '../types'

const PANE = 'jarvis'
const TITLE = 'Open Jarvis Talk · Chat'
const MAX_RESEARCH_ROUNDS = 2
// $1 the listening language, $2 the seconds of silence that end what you say.
const LISTEN =
  'exec "$HOME/.claude/jarvis/jarvis-listen" --locale "$1" --pause "$2" 2>>"$HOME/.claude/jarvis/listen.log"'

/** Appends one line to ~/.claude/jarvis/jarvis.log; never fails the caller. */
function jlog($: EngineInterface, line: string): void {
  void $.process
    .run([
      '/bin/zsh',
      '-c',
      'mkdir -p "$HOME/.claude/jarvis" && printf "%s %s\\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$HOME/.claude/jarvis/jarvis.log"',
      'jlog',
      line.replace(/\s+/g, ' ').slice(0, 2000),
    ])
    .catch(() => undefined)
}

const chat = atom({ plugin: 'open-jarvis-talk', key: 'chat' } as const, [] as ChatEntry[], {
  shape: 'chat-1',
})
const draft = atom({ plugin: 'open-jarvis-talk', key: 'draft' } as const, null as string | null)
const busy = atom({ plugin: 'open-jarvis-talk', key: 'busy' } as const, null as string | null)
const field = atom({ plugin: 'open-jarvis-talk', key: 'field' } as const, 0)
const isOpen = atom({ plugin: 'open-jarvis-talk', key: 'isOpen' } as const, false)
const talk = atom({ plugin: 'open-jarvis-talk', key: 'talk' } as const, 'off' as TalkState)
const heard = atom({ plugin: 'open-jarvis-talk', key: 'heard' } as const, '')
const setup = atom({ plugin: 'open-jarvis-talk', key: 'setup' } as const, null as Setup | null)
/** Whether a tap under the orb acts now (see TAP_ARM_MS). */
const tapArmed = atom({ plugin: 'open-jarvis-talk', key: 'tapArmed' } as const, false)

// ---- Settings --------------------------------------------------------------
// Chosen on the settings screen (the ⚙ at the top of the conversation), kept
// in $.store across sessions and mirrored into an atom the rest reads.

type Choice = { value: string; label: string }

const REPLY_STYLES: readonly Choice[] = [
  { value: 'brief', label: 'Brief' },
  { value: 'normal', label: 'Normal' },
  { value: 'detailed', label: 'Detailed' },
  { value: 'simple', label: 'Simple words' },
]
const ENGINES: readonly Choice[] = [
  { value: 'natural', label: 'Natural voice (Kokoro)' },
  { value: 'mac', label: 'Mac voice' },
]
const VOICE_NAMES: Record<string, string> = {
  af: 'US female', am: 'US male', bf: 'British female', bm: 'British male',
}
const VOICE_IDS = [
  'af_heart', 'af_bella', 'af_nicole', 'af_alloy', 'af_aoede', 'af_jessica', 'af_kore', 'af_nova',
  'af_river', 'af_sarah', 'af_sky', 'am_michael', 'am_adam', 'am_echo', 'am_eric', 'am_fenrir',
  'am_liam', 'am_onyx', 'am_puck', 'am_santa', 'bf_emma', 'bf_alice', 'bf_isabella', 'bf_lily',
  'bm_george', 'bm_daniel', 'bm_fable', 'bm_lewis',
]
const BEST_VOICES = new Set(['af_heart', 'af_bella'])
function voiceName(id: string): string {
  const name = id.slice(3)

  return name.charAt(0).toUpperCase() + name.slice(1)
}
const VOICES: readonly Choice[] = VOICE_IDS.map(id => ({
  value: id,
  label: `${voiceName(id)} · ${VOICE_NAMES[id.slice(0, 2)] ?? ''}${BEST_VOICES.has(id) ? ' · best' : ''}`,
}))
const SPEEDS: readonly Choice[] = ['0.8', '0.9', '1.0', '1.1', '1.25', '1.5'].map(speed => ({
  value: speed,
  label: `${speed}×`,
}))
const LOCALES: readonly Choice[] = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'en-AU', label: 'English (Australia)' },
  { value: 'en-CA', label: 'English (Canada)' },
  { value: 'en-IN', label: 'English (India)' },
  { value: 'de-DE', label: 'German' },
  { value: 'fr-FR', label: 'French' },
  { value: 'es-ES', label: 'Spanish (Spain)' },
  { value: 'es-MX', label: 'Spanish (Mexico)' },
  { value: 'it-IT', label: 'Italian' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
  { value: 'nl-NL', label: 'Dutch' },
  { value: 'ja-JP', label: 'Japanese' },
  { value: 'zh-CN', label: 'Chinese (Mandarin)' },
  { value: 'ko-KR', label: 'Korean' },
]
const PAUSES: readonly Choice[] = ['1.5', '2', '3', '4', '5'].map(seconds => ({
  value: seconds,
  label: `${seconds} s`,
}))
const ON_OFF = (onLabel: string, offLabel: string): readonly Choice[] => [
  { value: 'on', label: onLabel },
  { value: 'off', label: offLabel },
]
const MAX_INSTRUCTIONS = 2000

const DEFAULTS: JarvisSettings = {
  instructions: '',
  replyStyle: 'brief',
  engine: 'natural',
  voice: 'af_heart',
  speed: '1.0',
  locale: 'en-US',
  pause: '3',
  research: true,
  speakReplies: true,
}

/** A stored value, each field checked against what the screen offers. */
function settingsFrom(raw: unknown): JarvisSettings {
  const got = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const pick = (key: string, among: readonly Choice[], fallback: string): string => {
    const value = got[key]

    return typeof value === 'string' && among.some(one => one.value === value) ? value : fallback
  }

  return {
    instructions:
      typeof got.instructions === 'string' ? got.instructions.slice(0, MAX_INSTRUCTIONS) : DEFAULTS.instructions,
    replyStyle: pick('replyStyle', REPLY_STYLES, DEFAULTS.replyStyle) as ReplyStyle,
    engine: pick('engine', ENGINES, DEFAULTS.engine) === 'mac' ? 'mac' : 'natural',
    voice: pick('voice', VOICES, DEFAULTS.voice),
    speed: pick('speed', SPEEDS, DEFAULTS.speed),
    locale: pick('locale', LOCALES, DEFAULTS.locale),
    pause: pick('pause', PAUSES, DEFAULTS.pause),
    research: typeof got.research === 'boolean' ? got.research : DEFAULTS.research,
    speakReplies: typeof got.speakReplies === 'boolean' ? got.speakReplies : DEFAULTS.speakReplies,
  }
}

const settings = atom({ plugin: 'open-jarvis-talk', key: 'settings' } as const, DEFAULTS)
/** The settings being edited; null when the settings screen is closed. */
const settingsDraft = atom({ plugin: 'open-jarvis-talk', key: 'settingsDraft' } as const, null as JarvisSettings | null)

const SUGGESTIONS = [
  'Brief me on this session',
  'What is it doing right now?',
  'Is anything waiting on me?',
  'What should we do next?',
]

const STYLE_TEXT: Record<ReplyStyle, string> = {
  brief: 'Be brief and plain: short paragraphs or a few bullets, no filler.',
  normal: 'Be clear and plain: a few short paragraphs or bullets, no filler.',
  detailed: 'Be thorough: explain the important details and reasons, in clear paragraphs or bullets.',
  simple: 'Use simple everyday words, no jargon, and keep it short.',
}
const STYLE_VOICE: Record<ReplyStyle, string> = {
  brief: 'one to three short spoken sentences',
  normal: 'a few short spoken sentences',
  detailed: 'up to about eight spoken sentences that cover the important details',
  simple: 'one to three short spoken sentences in simple everyday words',
}

/** How a <command> carries the user's request: relayed, not planned. The
 * session's agent decides how to do what was asked. */
const COMMAND_RULES = `- The command relays the user's request; it is not your plan. Keep their intent, scope and level of detail, and tidy only the wording so it reads as a clear request. Keep any steps, files or approach the user named, and never add steps, files to touch, an approach or tasks the user did not mention: the session's agent knows its own work and decides what the request means and how to do it. "Ask it to finalize everything" becomes "Please finalize everything.", not a list of what finalizing involves.
- Add to the request only what the agent needs to understand it, since it cannot see this talk with Jarvis: say what "it", "that" or "the bug" refers to, naming the file when that is what the user meant, or include a detail the user gave earlier in this talk. Keep any such addition short and phrased as context, never as extra instructions.`

function rules(chosen: JarvisSettings): string {
  return `[Jarvis side channel. This is NOT a turn of this session.]
The user opened "Jarvis", a side assistant next to this session. For this reply only, you are Jarvis:
- You are an observer. You cannot run tools, and nothing you write reaches the session's agent.
- Answer about THIS session (the conversation above): what it is doing, why, what happened, what is next.
- ${STYLE_TEXT[chosen.replyStyle]}
${
  chosen.research
    ? '- If you truly need facts from the web to answer, reply with ONLY <research>one precise question</research> and nothing else. You will get the findings back.\n'
    : '- Web research is turned off: answer from what you know and say so when you are unsure.\n'
}- When the user wants the session to do something ("let's do X", "tell it to..."), put the message for the session's agent inside ONE <command>...</command> block, plus one line saying what it will do. The user approves it before it is sent.
${COMMAND_RULES}
- Never claim you did something in the session yourself.`
}

function voiceRules(chosen: JarvisSettings): string {
  return `
The user is TALKING to you by voice and your reply is read aloud: answer in ${STYLE_VOICE[chosen.replyStyle]}, plain text only (no markdown, lists, code or URLs). The <command> rule still applies; when you draft a command, say in one sentence what it will do.
- When the user is ending this talk with you (saying goodbye, "that's it, you can go", "thanks, we're done"), reply with a short goodbye and put ${END_MARK} at the very end; the conversation then closes. Only do this when they clearly mean to stop talking to you, not when they ask the session to finish something.`
}

/** Jarvis puts this at the end of a reply that ends the voice conversation. */
const END_MARK = '<end/>'

function ownInstructions(chosen: JarvisSettings): string {
  const text = chosen.instructions.trim()

  return text
    ? `\n\nThe user's own standing instructions for how Jarvis answers (follow them unless they conflict with the rules above):\n${text}`
    : ''
}

function buildPrompt(
  history: readonly ChatEntry[],
  findings: readonly string[],
  isVoice: boolean,
  chosen: JarvisSettings,
): string {
  const lines = history.map(entry =>
    entry.role === 'you'
      ? `User${entry.isVoice ? ' (spoken)' : ''}: ${entry.text}`
      : entry.role === 'jarvis'
        ? `Jarvis: ${entry.text}`
        : `(${entry.text})`,
  )
  const researchText = findings.length
    ? `\n\nResearch findings for this question:\n${findings.join('\n\n')}`
    : ''

  return `${rules(chosen)}${isVoice ? voiceRules(chosen) : ''}${ownInstructions(chosen)}\n\nJarvis conversation so far:\n${lines.join('\n')}${researchText}\n\nReply as Jarvis to the user's last message.`
}

function note(text: string): ChatEntry {
  return { role: 'note', text }
}

function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/[*_#>`|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function research($: EngineInterface, question: string): Promise<string> {
  const request = `Research this on the web and answer concisely (at most 250 words), listing source URLs at the end:\n\n${question}`
  try {
    const run = await $.process.run(
      [
        '/bin/zsh',
        '-lc',
        'claude -p --allowedTools WebSearch,WebFetch --disallowedTools Bash,Edit,Write,NotebookEdit --output-format text',
      ],
      { stdin: request, timeoutMs: 300000, env: { CLAUDECODE: '' } },
    )
    jlog($, `research exit=${run.exitCode} out=${run.stdout.length}ch err=${run.stderr.slice(0, 300)}`)
    if (run.exitCode !== 0) {
      return `Research failed (exit ${run.exitCode}): ${(run.stderr || run.stdout).slice(0, 300)}`
    }

    return run.stdout.trim() || 'Research returned nothing.'
  } catch (error) {
    jlog($, `research threw: ${String(error)}`)
    return `Research could not run: ${String(error).slice(0, 300)}`
  }
}

/** A reply to speak, and whether it ends the voice conversation. */
type Answer = { text: string; isEnd: boolean }

/** Asks Jarvis; resolves the reply (null when there was none). */
async function askJarvis($: EngineInterface, question: string, isVoice: boolean): Promise<Answer | null> {
  if ((await read($, busy)) !== null) return null

  await update($, chat, list => [...list, { role: 'you' as const, text: question, isVoice }])
  toNewest($)
  await update($, busy, () => 'Thinking…')
  askToken += 1
  const ticket = askToken
  jlog($, `ask voice=${isVoice} q=${JSON.stringify(question.slice(0, 200))}`)

  try {
    const chosen = await read($, settings)
    const maxRounds = chosen.research ? MAX_RESEARCH_ROUNDS : 0
    const findings: string[] = []
    for (let round = 0; round <= maxRounds; round++) {
      const history = await read($, chat)
      const reply = await $.model.fork({ prompt: buildPrompt(history, findings, isVoice, chosen) })
      if (ticket !== askToken) {
        jlog($, 'answer dropped: stopped while thinking')

        return null
      }

      if (!reply.isAnswered) {
        jlog($, `fork failed reason=${reply.reason} ${'status' in reply ? `status=${String(reply.status)}` : ''}`)
        const why =
          reply.reason === 'nothing-to-fork'
            ? 'Nothing to look at yet. Jarvis works once the session has finished at least one turn.'
            : reply.reason === 'api-error'
              ? `The model call failed (HTTP ${reply.status}).`
              : `No answer (${reply.reason}).`
        await update($, chat, list => [...list, note(why)])

        return { text: why, isEnd: false }
      }

      const text = reply.text.trim()
      jlog($, `fork answered ${text.length}ch research=${/<research>/.test(text)} command=${/<command>/.test(text)}`)
      const wanted = /^\s*<research>([\s\S]*?)<\/research>\s*$/.exec(text)
      if (wanted && round < maxRounds) {
        const topic = (wanted[1] ?? '').trim()
        await update($, busy, () => `Researching: ${topic}`)
        await update($, chat, list => [...list, note(`Researching: ${topic}`)])
        const answer = await research($, topic)
        if (ticket !== askToken) return null
        findings.push(`Q: ${topic}\nA: ${answer}`)
        await update($, busy, () => 'Thinking…')
        continue
      }

      const command = /<command>([\s\S]*?)<\/command>/.exec(text)
      const isEnd = isVoice && /<end\s*\/?>/i.test(text)
      const shown =
        text
          .replace(/<command>[\s\S]*?<\/command>/g, '')
          .replace(/<\/?research>/g, '')
          .replace(/<\/?end\s*\/?>/gi, '')
          .trim() || (command ? 'Here is a draft command for the session.' : 'Okay, bye.')
      await update($, chat, list => [...list, { role: 'jarvis' as const, text: shown }])
      toNewest($)
      if (command) {
        const body = (command[1] ?? '').trim()
        await update($, draft, () => body)

        return { text: `${shown} Say "send it" to send it to the session, or "discard".`, isEnd: false }
      }

      return { text: shown, isEnd }
    }

    return null
  } finally {
    if (ticket === askToken) await update($, busy, () => null)
  }
}

async function sendDraft($: EngineInterface, text: string): Promise<void> {
  await update($, draft, () => null)
  await update($, chat, list => [
    ...list,
    note('Sent to the session (it runs once the session is idle).'),
  ])
  const sent = await $.prompt.submit({ text, asUser: true })
  jlog($, `draft submitted ${'drop' in sent && sent.drop ? 'DROPPED' : 'ok'} ${JSON.stringify(text.slice(0, 200))}`)
}

// ---- Conversation mode -----------------------------------------------------
// A pane of its own: an animated orb that shows listening, thinking and
// speaking, live captions, and the draft card. It listens again after every
// answer until the person closes it. The children (the listener, `say`) live
// in module variables: a reload or the session's end kills them too.

const VOICE_PANE = 'jarvis-voice'

/** Paused or off both leave the Talk buttons available. */
function isActive(state: TalkState): boolean {
  return state === 'listening' || state === 'thinking' || state === 'speaking'
}
const VOICE_TITLE = 'Open Jarvis Talk'
const MIC = '🎙️'
/** The button beside a reply that reads it aloud again. */
const SPEAKER = '\u{1F50A}'
const SILENT_ROUNDS_BEFORE_PAUSE = 6 // the listener waits 20 s a round

type Stream = { return?: (value?: undefined) => unknown }
type Child = { stream: Stream; pid?: number; isKilled?: boolean; isSentEarly?: boolean }
let talkToken = 0
/** Bumped by a press that stops Jarvis thinking: an answer still on its way
 * for an older ticket is dropped. */
let askToken = 0
let listener: Child | null = null
let speaker: Child | null = null
let watchdog: { cancel: () => void } | null = null

/** Stops a child at once: its process by pid (a pending read would hold a
 * plain `return()` until the child next writes), then its stream. */
function kill($: EngineInterface, which: 'listener' | 'speaker'): void {
  const running = which === 'listener' ? listener : speaker
  if (which === 'listener') listener = null
  else speaker = null
  if (!running) return
  running.isKilled = true
  if (running.pid) {
    void $.process.run(['/bin/kill', '-TERM', String(running.pid)]).catch(() => undefined)
  }
  void running.stream.return?.()
}

/** Reads a `pid: N` first line into the child; true when the line was one. */
function takePid(child: Child, line: string): boolean {
  if (!line.startsWith('pid: ')) return false
  const pid = Number(line.slice(5))
  if (Number.isInteger(pid) && pid > 1) child.pid = pid

  return true
}

// A tap under the orb works only once the state it shows has held for
// TAP_ARM_MS, so a tap aimed at "send now" that lands just as Jarvis starts
// thinking does not stop it. A tap disarms it until the next state has held
// that long, so quick double taps, even two at the same moment, count once.
const TAP_ARM_MS = 800
/** The state under the orb, a Button while a tap acts: the keyboard focus sits here. */
const TAP_KEY = 'tap-orb'
let armTimer: { cancel: () => void } | null = null
/** tapArmed as tapOrb checks it: written at once, before the atom catches up. */
let isTapArmed = false

/** Arms or disarms the tap under the orb. */
async function setTapArmed($: EngineInterface, isArmed: boolean): Promise<void> {
  isTapArmed = isArmed
  await update($, tapArmed, () => isArmed)
}

/** Sets the conversation state; the tap under the orb waits to arm again. */
async function setTalk($: EngineInterface, state: TalkState): Promise<void> {
  armTimer?.cancel()
  armTimer = null
  await setTapArmed($, false)
  await update($, talk, () => state)
  if (isActive(state)) {
    armTimer = $.clock.after(TAP_ARM_MS, () => {
      armTimer = null
      void setTapArmed($, true)
        .then(() => focusTap($))
        .catch(() => undefined)
    })
  }
}

/** Puts the keyboard focus on the state under the orb, so Space (or Enter)
 * presses it as a tap does. Only while the pane already holds the keyboard:
 * it never takes the keys from the prompt. */
async function focusTap($: EngineInterface): Promise<void> {
  await $.ui.focus({ requestId: VOICE_PANE, key: TAP_KEY }).catch(() => undefined)
}

async function stopTalking($: EngineInterface, to: TalkState = 'off', why = ''): Promise<void> {
  jlog($, `conversation ${to === 'off' ? 'ended' : 'paused'}${why ? ` (${why})` : ''}`)
  talkToken += 1
  watchdog?.cancel()
  watchdog = null
  kill($, 'listener')
  kill($, 'speaker')
  await setTalk($, to)
  await update($, heard, () => '')
}

/** Ends the conversation whenever its pane is closed or no longer shown,
 * however that happened (its close mark, a tab switch, the panel hidden). */
function watchPane($: EngineInterface): void {
  watchdog?.cancel()
  let missed = 0
  watchdog = $.clock.every(1000, () => {
    void $.ui
      .panes()
      .then(async panes => {
        const pane = panes.find(one => one.id === VOICE_PANE)
        missed = pane && pane.isShown ? 0 : missed + 1
        if (missed >= 2) {
          await stopTalking($, 'off', pane ? 'pane hidden' : 'pane closed')
          if (pane) await $.ui.close({ id: VOICE_PANE }).catch(() => undefined)
        }
      })
      .catch(() => undefined)
  })
}

/** Listens once: the words heard, '' for silence, null on an error. */
async function listenOnce($: EngineInterface, mine: number): Promise<string | null> {
  const chosen = await read($, settings)
  const stream = $.process.spawn({ argv: ['/bin/zsh', '-c', LISTEN, 'jarvis-listen', chosen.locale, chosen.pause] })
  const me: Child = { stream: stream as unknown as Stream }
  listener = me
  let pending = ''
  let final: string | null = null
  // Each partial is the whole utterance so far, the same text the listener
  // would print as final: a "send now" press ends listening with it.
  let latest = ''

  try {
    for await (const piece of stream) {
      if (talkToken !== mine || me.isSentEarly) break
      pending += piece.text
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        if (takePid(me, line)) continue
        if (line.startsWith('partial: ')) {
          const words = line.slice(9)
          latest = words
          await update($, heard, () => words)
        } else if (line.startsWith('final: ')) {
          final = line.slice(7).trim()
        } else if (line.startsWith('error: ')) {
          const why = line.slice(7)
          jlog($, `listener error: ${why}`)
          await update($, chat, list => [...list, note(`Conversation stopped: ${why}`)])

          return null
        }
      }
    }
  } catch (error) {
    if (me.isSentEarly) return latest.trim()
    jlog($, `listener threw: ${String(error)}`)
    await update($, chat, list => [
      ...list,
      note(`Could not start listening: ${String(error).slice(0, 200)}`),
    ])

    return null
  } finally {
    if (listener === me) listener = null
  }
  if (talkToken !== mine) return ''
  if (me.isSentEarly) return latest.trim()

  return final ?? ''
}

/** The press on the state under the orb: while listening, uses what was said
 * so far at once instead of waiting for the pause; while thinking or speaking,
 * stops Jarvis and listens again. */
async function tapOrb($: EngineInterface): Promise<void> {
  if (!isTapArmed) {
    jlog($, 'tap ignored: the state just changed or was tapped already')

    return
  }
  // One tap per state, taken before any await so a press at the same moment
  // finds it gone; the next state arms it again after TAP_ARM_MS.
  isTapArmed = false
  const state = await read($, talk)
  if (state === 'listening' && (!listener || (await read($, heard)).trim() === '')) {
    // Nothing said yet: the press does nothing and the tap stays ready for
    // when there is, unless the state moved on meanwhile.
    if (armTimer === null && (await read($, talk)) === 'listening') isTapArmed = true

    return
  }
  await setTapArmed($, false)
  if (state === 'listening') {
    const running = listener
    if (!running) return
    jlog($, 'send now pressed')
    running.isSentEarly = true
    kill($, 'listener')
  } else if (state === 'speaking') {
    jlog($, 'interrupt pressed while speaking')
    kill($, 'speaker')
  } else if (state === 'thinking') {
    jlog($, 'interrupt pressed while thinking')
    askToken += 1
    await update($, busy, () => null)
    await update($, chat, list => [...list, note('Stopped. Listening again.')])
    kill($, 'speaker')
    void talkLoop($)
  }
}

/** The talkToken a replay runs under, and whether listening comes back after it. */
let replayToken = -1
let replayResumes = false

/** The 🔊 beside a reply: reads it aloud again. Listening stops first, so the
 * voice is not heard as the person speaking; afterwards the conversation goes
 * on as it was: listening again if it was running, else paused. A tap
 * interrupts it as it does any answer. Not while Jarvis is thinking. */
async function replay($: EngineInterface, text: string): Promise<void> {
  const state = await read($, talk)
  const words = speakable(text)
  if (state === 'thinking' || !words) return
  // A replay pressed during another keeps that one's plan for afterwards.
  const resumes = replayToken === talkToken && state === 'speaking' ? replayResumes : isActive(state)
  talkToken += 1
  const mine = talkToken
  replayToken = mine
  replayResumes = resumes
  jlog($, `replay ${words.length}ch, then ${resumes ? 'listen' : 'pause'}`)
  kill($, 'listener')
  kill($, 'speaker')
  watchPane($)
  await update($, heard, () => '')
  await setTalk($, 'speaking')
  await speakAs($, words, mine, await read($, settings))
  if (talkToken !== mine) return
  if (resumes) {
    void talkLoop($)

    return
  }
  watchdog?.cancel()
  watchdog = null
  await setTalk($, 'paused')
}

// Jarvis's voice: Kokoro, a local neural voice (~/.claude/jarvis/speak.py, its
// model loaded in a small background server), else macOS `say`. Both run as a
// process whose pid Interrupt, Pause and End kill to stop the sound at once.
const NO_KOKORO = 'natural voice not installed'
const KOKORO =
  'echo "pid: $$"; [ -x "$HOME/.claude/jarvis/kokoro/bin/python" ] || { echo "error: ' +
  NO_KOKORO +
  '"; exit 3; }; exec "$HOME/.claude/jarvis/kokoro/bin/python" -I "$HOME/.claude/jarvis/speak.py" --voice "$2" --speed "$3" -- "$1"'
// $1 the words, $3 the rate in words a minute ($2 unused, as Kokoro's voice).
const SAY = 'echo "pid: $$"; exec /usr/bin/say -r "$3" -- "$1"'
const MAC_WORDS_PER_MINUTE = 175

type Spoken = { isDone: boolean; isStopped: boolean; why: string }

async function speakWith(
  $: EngineInterface,
  script: string,
  words: string,
  mine: number,
  printsDone: boolean,
  how: { voice: string; speed: string },
): Promise<Spoken> {
  const stream = $.process.spawn({
    argv: ['/bin/zsh', '-c', script, 'jarvis-say', words, how.voice, how.speed],
  })
  const me: Child = { stream: stream as unknown as Stream }
  speaker = me
  let isDone = !printsDone // `say` prints nothing: ending without a throw is done
  let why = ''
  let stderr = ''
  let pending = ''
  try {
    for await (const piece of stream) {
      if (piece.stream === 'stderr') {
        stderr = (stderr + piece.text).slice(-400)
        continue
      }
      pending += piece.text
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        if (takePid(me, line)) continue
        if (line === 'done') isDone = true
        else if (line.startsWith('error: ')) why = line.slice(7)
        else if (line.startsWith('speaking ')) jlog($, `voice ${line}`)
      }
      if (talkToken !== mine) break
    }
  } catch (error) {
    isDone = false
    why = why || String(error).slice(0, 300)
  } finally {
    if (speaker === me) speaker = null
  }
  const isStopped = me.isKilled === true || talkToken !== mine
  if (!isDone && !why) why = stderr.trim() || 'it ended without speaking'

  return { isDone, isStopped, why }
}

/** Speaks in the chosen voice: Kokoro, else the Mac voice. */
async function speakAs(
  $: EngineInterface,
  words: string,
  mine: number,
  chosen: JarvisSettings,
): Promise<void> {
  const macRate = String(Math.round(MAC_WORDS_PER_MINUTE * Number(chosen.speed)))
  if (chosen.engine === 'natural') {
    const kokoro = await speakWith($, KOKORO, words, mine, true, { voice: chosen.voice, speed: chosen.speed })
    if (kokoro.isDone || kokoro.isStopped) return
    // Skipped at setup: the Mac voice is the choice, not a failure worth a log line.
    if (kokoro.why !== NO_KOKORO) jlog($, `Kokoro voice failed, falling back to macOS say: ${kokoro.why}`)
  }
  const fallback = await speakWith($, SAY, words, mine, false, { voice: '', speed: macRate })
  if (!fallback.isDone && !fallback.isStopped) jlog($, `say failed too: ${fallback.why}`)
}

async function speak($: EngineInterface, text: string, mine: number): Promise<void> {
  const words = speakable(text)
  if (!words || talkToken !== mine) return
  const chosen = await read($, settings)
  if (!chosen.speakReplies) return
  jlog($, `speak ${words.length}ch`)
  await speakAs($, words, mine, chosen)
}

const SEND = /^(yes|yeah|yep|ok|okay)?[\s,.!]*(send( it)?|approve( it)?|go ahead|do it)[\s.!]*$/i
// A goodbye said outright: a farewell ("goodbye", "you can go", "stop") with
// only thanks and filler around it ("okay, thank you, that's it, you can go").
// "That's it" or "we're done" alone can also confirm a draft, so they count
// only beside a farewell. A question, a letter outside plain English, or
// anything more ("bye, now add tests") goes to Jarvis, which ends the talk
// itself with <end/> when that is what the person meant.
const FAREWELL =
  /\b(good ?bye|bye( bye)?|see you( later| soon)?|good ?night|talk (to you )?(later|soon)|you can go( now)?|you can leave( now)?|you can stop( now)?|end( the)? conversation|stop listening|stop)\b/g
const DONE = /\b(that's (it|all)|that is (it|all)|that'll be all|that will be all|we're done|we are done|i'm done|i am done)\b/g
const FILLER = new Set(
  'ok okay alright all right thanks thank you so much very lot a really jarvis great perfect cool nice good awesome fine then for now yes yeah well and oh again buddy man'.split(' '),
)
const PLAIN = /^[A-Za-z'’` ,.!-]+$/

function isGoodbye(said: string): boolean {
  if (!PLAIN.test(said)) return false
  const text = said.toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z' ]+/g, ' ')
  if (!new RegExp(FAREWELL.source).test(text)) return false
  const rest = text
    .replace(FAREWELL, ' ')
    .replace(DONE, ' ')
    .split(/\s+/)
    .filter(word => word !== '' && !FILLER.has(word))

  return rest.length === 0
}
const DISCARD = /^(no|nope)?[\s,.!]*(discard( it)?|cancel( it)?|drop it|never ?mind|don't send( it)?)[\s.!]*$/i

async function you($: EngineInterface, text: string): Promise<void> {
  await update($, chat, list => [...list, { role: 'you' as const, text, isVoice: true }])
  toNewest($)
}

/** Scrolls the conversation to its newest message (a new one just arrived). */
function toNewest($: EngineInterface): void {
  void $.ui.scroll({ in: VOICE_PANE, to: 'end' }).catch(() => undefined)
}

async function talkLoop($: EngineInterface): Promise<void> {
  talkToken += 1
  const mine = talkToken
  let silentRounds = 0
  let instantRounds = 0
  jlog($, `conversation start token=${mine}`)
  watchPane($)

  while (talkToken === mine) {
    await update($, heard, () => '')
    await setTalk($, 'listening')
    const startedAt = await $.clock.now()
    const said = await listenOnce($, mine)
    const tookMs = (await $.clock.now()) - startedAt
    jlog($, `round heard=${said === null ? 'ERROR' : JSON.stringify(said.slice(0, 200))} ms=${Math.round(tookMs)}`)
    if (talkToken !== mine) return
    if (said === null) {
      await stopTalking($, 'paused')

      return
    }
    if (said === '') {
      // A round that ends at once heard nothing because listening failed.
      if (tookMs < 3000) {
        instantRounds += 1
        if (instantRounds >= 2) {
          await update($, chat, list => [
            ...list,
            note('Conversation stopped: listening keeps ending at once. Check the microphone, then press Resume.'),
          ])
          await stopTalking($, 'paused')

          return
        }
        continue
      }
      instantRounds = 0
      silentRounds += 1
      if (silentRounds >= SILENT_ROUNDS_BEFORE_PAUSE) {
        await stopTalking($, 'paused')

        return
      }
      continue
    }
    silentRounds = 0

    if (isGoodbye(said)) {
      await you($, said)
      await sayGoodbye($, 'Okay, bye.', mine, 'said goodbye')

      return
    }

    const pending = await read($, draft)
    if (pending !== null && SEND.test(said)) {
      await you($, said)
      await sendDraft($, pending)
      await setTalk($, 'speaking')
      await speak($, 'Sent.', mine)
      continue
    }
    if (pending !== null && DISCARD.test(said)) {
      await you($, said)
      await update($, draft, () => null)
      await setTalk($, 'speaking')
      await speak($, 'Discarded.', mine)
      continue
    }

    await setTalk($, 'thinking')
    const reply = await askJarvis($, said, true)
    if (talkToken !== mine) return
    if (reply?.isEnd) {
      await sayGoodbye($, reply.text, mine, 'Jarvis heard a goodbye')

      return
    }
    if (reply) {
      await setTalk($, 'speaking')
      await speak($, reply.text, mine)
    }
  }
}

/** Speaks the goodbye, then ends the conversation and closes its pane. */
async function sayGoodbye($: EngineInterface, words: string, mine: number, why: string): Promise<void> {
  await setTalk($, 'speaking')
  await speak($, words, mine)
  await stopTalking($, 'off', why)
  await $.ui.close({ id: VOICE_PANE }).catch(() => undefined)
}

async function showVoicePane($: EngineInterface, title: string): Promise<void> {
  const opened = await $.ui.open({ id: VOICE_PANE, title, focus: true, closeOnEscape: true })
  jlog($, `${title} pane placed=${opened.isPlaced}${opened.isPlaced ? '' : ` reason=${String(opened.reason)}`}`)
}

/** The microphone button: talks at once once set up, else opens setup. */
async function openConversation($: EngineInterface): Promise<void> {
  if (isActive(await read($, talk))) {
    await showVoicePane($, VOICE_TITLE)

    return
  }
  if (!isSetUp) {
    await update($, setup, () => checking())
    await showVoicePane($, SETUP_TITLE)
    const found = await checkMac($)
    if (!found) return
    if (!isSetUp) {
      await update($, setup, () => found)

      return
    }
  }
  await startTalking($)
}

async function startTalking($: EngineInterface): Promise<void> {
  await update($, setup, () => null)
  await showVoicePane($, VOICE_TITLE)
  toNewest($)
  if (!isActive(await read($, talk))) void talkLoop($)
}

// ---- Setup -----------------------------------------------------------------
// The first press of the microphone checks this Mac (setup/jarvis-setup.sh
// check), says what will be installed and how much space it takes, and
// installs only once the person presses Install.

const SETUP_TITLE = 'Open Jarvis Talk · Setup'
const UV_MB = 45
let isSetUp = false

function setupScript($: EngineInterface): string {
  return `${$.plugin.root}/setup/jarvis-setup.sh`
}

function checking(): Setup {
  return {
    phase: 'checking',
    checks: [],
    blocker: '',
    needsTools: false,
    dictation: 'unknown',
    isVoiceInstalled: false,
    isVoiceSupported: true,
    voiceWhy: '',
    needsUv: false,
    needsListener: true,
    withVoice: true,
    voiceDiskMb: 560,
    voiceDownloadMb: 400,
    uvMb: UV_MB,
    steps: [],
    error: '',
  }
}

function megabytes(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.max(1, Math.round(mb))} MB`
}

/** Reads `check`'s key=value lines into the setup screen. */
function fromCheck(stdout: string, withVoice = true): Setup {
  const info: Record<string, string> = {}
  for (const line of stdout.split('\n')) {
    const at = line.indexOf('=')
    if (at > 0) info[line.slice(0, at)] = line.slice(at + 1).trim()
  }
  const number = (key: string) => Number(info[key] ?? 0) || 0
  const needsListener = info.listener !== 'ready'
  const isVoiceInstalled = info.voice === 'ready'
  const isVoiceSupported = info.voice_supported === 'yes'
  const hasTools = info.tools === 'yes'
  const dictation = info.dictation === 'on' || info.dictation === 'off' ? info.dictation : 'unknown'
  const needMb = number('need_mb')
  const freeMb = number('free_mb')
  const isSilicon = info.arch === 'arm64'
  const checks: SetupCheck[] = [
    {
      label: `macOS ${info.macos ?? '?'}`,
      isOk: info.macos_ok === 'yes',
      detail: info.macos_ok === 'yes' ? 'supported' : 'Open Jarvis Talk needs macOS 13 or later',
    },
    {
      label: isSilicon ? 'Apple Silicon' : `${info.arch ?? 'unknown'} processor`,
      isOk: true,
      detail: isSilicon ? 'runs the natural voice' : 'the natural voice needs Apple Silicon; the Mac voice works',
    },
    {
      label: `${number('ram_gb')} GB memory`,
      isOk: true,
      detail: number('ram_gb') >= 8 ? 'enough' : 'the natural voice needs 8 GB; the Mac voice works',
    },
    {
      label: `${megabytes(freeMb)} free`,
      isOk: freeMb >= needMb + number('spare_mb'),
      detail: freeMb >= needMb + number('spare_mb') ? 'enough space' : `needs about ${megabytes(needMb)} plus room to spare`,
    },
    {
      label: 'Xcode Command Line Tools',
      isOk: hasTools || !needsListener,
      detail: hasTools ? 'found' : needsListener ? 'needed once, to build the speech listener' : 'not needed',
    },
    {
      label: 'Dictation',
      isOk: dictation !== 'off',
      detail:
        dictation === 'on'
          ? 'on'
          : dictation === 'off'
            ? 'off: macOS speech recognition needs it (System Settings > Keyboard > Dictation)'
            : 'could not check; if listening fails, turn it on in System Settings > Keyboard > Dictation',
    },
  ]
  const blocker =
    info.macos_ok !== 'yes'
      ? 'This Mac cannot run Open Jarvis Talk: it needs macOS 13 or later.'
      : freeMb < needMb + number('spare_mb')
        ? `Not enough free space: Open Jarvis Talk needs about ${megabytes(needMb)}.`
        : ''

  return {
    ...checking(),
    phase: 'review',
    checks,
    blocker,
    needsTools: needsListener && !hasTools,
    dictation,
    isVoiceInstalled,
    isVoiceSupported,
    voiceWhy: info.voice_why ?? '',
    needsUv: info.uv === 'none',
    needsListener,
    withVoice: withVoice && isVoiceSupported,
    voiceDiskMb: number('voice_disk_mb') || 560,
    voiceDownloadMb: number('voice_download_mb') || 400,
  }
}

/** Runs the check; marks Jarvis set up when it is. Resolves the screen to
 * show, or null when the check could not run (the screen says why). */
async function checkMac($: EngineInterface, withVoice = true): Promise<Setup | null> {
  try {
    const run = await $.process.run(['/bin/bash', setupScript($), 'check'], { timeoutMs: 30000 })
    if (run.exitCode !== 0) throw new Error(run.stderr.trim() || `exit ${run.exitCode}`)
    const found = fromCheck(run.stdout, withVoice)
    isSetUp = /^ready=yes$/m.test(run.stdout)
    jlog($, `setup check ready=${isSetUp} listener=${found.needsListener ? 'needed' : 'ok'} voice=${found.isVoiceInstalled ? 'ok' : 'missing'}`)

    return found
  } catch (error) {
    jlog($, `setup check failed: ${String(error)}`)
    await update($, setup, () => ({
      ...checking(),
      phase: 'failed',
      error: `Could not check this Mac: ${String(error).slice(0, 300)}`,
    }))

    return null
  }
}

async function recheck($: EngineInterface): Promise<void> {
  const before = await read($, setup)
  await update($, setup, () => checking())
  const found = await checkMac($, before?.withVoice ?? true)
  if (found) await update($, setup, () => found)
}

function installSize(view: Setup): number {
  const voice = view.withVoice && !view.isVoiceInstalled
  return (view.needsListener ? 1 : 0) + (voice ? view.voiceDiskMb + (view.needsUv ? view.uvMb : 0) : 0)
}

function downloadSize(view: Setup): number {
  const voice = view.withVoice && !view.isVoiceInstalled
  return voice ? view.voiceDownloadMb + (view.needsUv ? view.uvMb : 0) : 0
}

async function runInstall($: EngineInterface): Promise<void> {
  const view = await read($, setup)
  if (!view || view.phase === 'installing') return
  const withVoice = view.withVoice && view.isVoiceSupported
  await update($, setup, now => (now ? { ...now, phase: 'installing' as const, steps: [], error: '' } : now))
  jlog($, `setup install voice=${withVoice}`)
  const argv = ['/bin/bash', setupScript($), 'install', ...(withVoice ? [] : ['--no-voice'])]
  let isDone = false
  let error = ''
  let tail = ''
  let pending = ''
  try {
    for await (const piece of $.process.spawn({ argv })) {
      pending += piece.text
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        tail = (tail + '\n' + line).slice(-400)
        if (line === 'done') isDone = true
        else if (line.startsWith('error: ')) error = line.slice(7)
        else if (/^(step|ok|warn): /.test(line)) {
          const shown = line.startsWith('ok: ') ? `✓ ${line.slice(4)}` : line.replace(/^(step|warn): /, '')
          await update($, setup, now => (now ? { ...now, steps: [...now.steps, shown] } : now))
        }
      }
    }
  } catch (thrown) {
    error = error || String(thrown).slice(0, 300)
  }
  jlog($, `setup install ${isDone ? 'done' : `failed: ${error || tail}`}`)
  if (isDone) {
    isSetUp = true
    await update($, setup, now => (now ? { ...now, phase: 'done' as const } : now))
  } else {
    await update($, setup, now =>
      now ? { ...now, phase: 'failed' as const, error: error || tail.trim() || 'The installer stopped.' } : now,
    )
  }
}

/** The setup screen, drawn in the conversation pane until Jarvis is set up. */
function setupScreen($: EngineInterface, els: ReturnType<EngineInterface['ui']['resolve']>, view: Setup) {
  const { Box, Text, Button } = els
  const size = installSize(view)
  const download = downloadSize(view)
  const canInstall = view.phase === 'review' && view.blocker === '' && !view.needsTools

  return (
    <Box flexDirection="column" gap={1} paddingY={1}>
      <Text bold>Set up Open Jarvis Talk</Text>

      {view.phase === 'checking' && <Text dimColor>Checking your Mac…</Text>}

      {view.phase !== 'checking' && view.checks.length > 0 && (
        <Box flexDirection="column">
          <Text bold>Your Mac</Text>
          {view.checks.map((check, index) => (
            <Text key={`check${index}`} color={check.isOk ? undefined : 'warning'} wrap="wrap">
              {check.isOk ? '✓' : '✗'} {check.label} <Text dimColor>· {check.detail}</Text>
            </Text>
          ))}
        </Box>
      )}

      {view.phase === 'review' &&
        (view.blocker !== '' ? (
          <Text color="error">{view.blocker}</Text>
        ) : (
          <Text color="success">Your Mac can run Open Jarvis Talk.</Text>
        ))}

      {view.phase === 'review' && (view.needsTools || view.dictation === 'off') && (
        <Box gap={1}>
          {view.needsTools && (
            <Button
              key="install-tools"
              label="Install Command Line Tools"
              onPress={() => $.process.run(['/bin/bash', setupScript($), 'tools']).then(() => undefined)}
            />
          )}
          {view.dictation === 'off' && (
            <Button
              key="open-dictation"
              label="Open Dictation settings"
              onPress={() => $.process.run(['/bin/bash', setupScript($), 'dictation']).then(() => undefined)}
            />
          )}
          <Button key="recheck" label="Check again" dimColor onPress={() => recheck($)} />
        </Box>
      )}

      {view.phase === 'review' && view.blocker === '' && (
        <Box flexDirection="column">
          <Text bold>To install</Text>
          <Text wrap="wrap">
            • Speech listener{' '}
            <Text dimColor>
              {view.needsListener
                ? '· built on your Mac from the included source · about 1 MB'
                : '· already installed'}
            </Text>
          </Text>
          <Text wrap="wrap">
            • Natural voice (Kokoro, optional){' '}
            <Text dimColor>
              {view.isVoiceInstalled
                ? '· already installed'
                : !view.isVoiceSupported
                  ? `· not available: ${view.voiceWhy}. Jarvis will use the built-in Mac voice.`
                  : view.withVoice
                    ? `· Python 3.12, the Kokoro voice engine and its voice model · about ${megabytes(view.voiceDiskMb)} on disk, ${megabytes(view.voiceDownloadMb)} download from PyPI and GitHub`
                    : '· skipped: Jarvis will use the built-in Mac voice'}
            </Text>
          </Text>
          {view.withVoice && !view.isVoiceInstalled && view.needsUv && (
            <Text wrap="wrap">
              • uv <Text dimColor>· the Python installer, from GitHub (astral-sh/uv) · about {view.uvMb} MB</Text>
            </Text>
          )}
          <Text dimColor wrap="wrap">
            Everything goes into ~/.claude/jarvis and nothing else on your Mac changes. To remove it later: rm -rf ~/.claude/jarvis
          </Text>
          <Text>
            Total: about {megabytes(size)} on disk{download > 0 ? `, ${megabytes(download)} to download` : ''}.
          </Text>
        </Box>
      )}

      {view.phase === 'installing' && (
        <Box flexDirection="column">
          {view.steps.map((step, index) => (
            <Text key={`step${index}`} dimColor={index < view.steps.length - 1} wrap="wrap">
              {step}
            </Text>
          ))}
          <Text color="claude">Installing… this can take a few minutes.</Text>
        </Box>
      )}

      {view.phase === 'failed' && (
        <Box flexDirection="column">
          {view.steps.map((step, index) => (
            <Text key={`step${index}`} dimColor wrap="wrap">
              {step}
            </Text>
          ))}
          <Text color="error" wrap="wrap">
            Setup stopped: {view.error}
          </Text>
        </Box>
      )}

      {view.phase === 'done' && (
        <Box flexDirection="column">
          {view.steps.map((step, index) => (
            <Text key={`step${index}`} dimColor wrap="wrap">
              {step}
            </Text>
          ))}
          <Text color="success" bold>
            Open Jarvis Talk is ready.
          </Text>
          <Text dimColor wrap="wrap">
            The first time you talk, macOS asks to allow the microphone and speech recognition. Click Allow.
          </Text>
        </Box>
      )}

      <Box gap={1}>
        {view.phase === 'review' && view.isVoiceSupported && !view.isVoiceInstalled && view.blocker === '' && (
          <Button
            key="toggle-voice"
            label={view.withVoice ? 'Skip natural voice' : 'Include natural voice'}
            dimColor
            onPress={() => update($, setup, now => (now ? { ...now, withVoice: !now.withVoice } : now))}
          />
        )}
        {canInstall && (
          <Button
            key="install"
            label={size > 0 ? `Install (about ${megabytes(size)})` : 'Finish setup'}
            variant="primary"
            onPress={() => runInstall($)}
          />
        )}
        {view.phase === 'failed' && (
          <Button key="retry" label="Try again" variant="primary" onPress={() => recheck($)} />
        )}
        {view.phase === 'done' && (
          <Button key="start" label="Start talking" variant="primary" onPress={() => startTalking($)} />
        )}
        {view.phase !== 'installing' && view.phase !== 'done' && (
          <Button
            key="later"
            label="Not now"
            dimColor
            onPress={async () => {
              await update($, setup, () => null)
              await $.ui.close({ id: VOICE_PANE })
            }}
          />
        )}
      </Box>
    </Box>
  )
}

const ACCENT = '#D97757'
const ACCENT_LIGHT = '#F0A27F'
const IDLE = '#9A9A9A'

/**
 * The orb's tap layer: one blank Button over the middle circle (r 62 of the
 * 360 x 240 drawing), sized by percentages so it fits whatever unit the
 * surface measures in. One short line: the desktop joins lines and cuts a
 * long one with "…". Under the pointer the desktop draws its hover box; the
 * plugin cannot hide it.
 */
const ORB_CORE = { width: '35%', height: '52%' }
const ORB_TAP_BLANK = '\u00a0'.repeat(18)

/** The animated orb, as one SVG the desktop runs CSS animation in. */
function orb(state: TalkState): string {
  const color = state === 'paused' || state === 'off' ? IDLE : ACCENT
  const bars = Array.from({ length: 9 }, (_, i) => {
    const x = 132 + i * 12
    const height = [18, 30, 44, 56, 64, 56, 44, 30, 18][i] ?? 30
    const delay = (i * 0.11).toFixed(2)
    const speed = state === 'speaking' ? 0.55 + (i % 3) * 0.12 : 1.1 + (i % 3) * 0.2

    return `<rect class="bar" x="${x}" y="${120 - height / 2}" width="6" height="${height}" rx="3" style="animation-duration:${speed}s;animation-delay:-${delay}s"/>`
  }).join('')
  const ripples =
    state === 'listening'
      ? '<circle class="ripple" cx="180" cy="120" r="62"/><circle class="ripple late" cx="180" cy="120" r="62"/>'
      : ''
  const spinner =
    state === 'thinking'
      ? '<circle class="spin" cx="180" cy="120" r="78" fill="none" stroke-width="4" stroke-linecap="round" stroke-dasharray="70 420"/>'
      : ''
  const showBars = state === 'listening' || state === 'speaking'

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 240" width="360" height="240">
<defs><radialGradient id="jarvis-${state}" cx="40%" cy="35%" r="70%"><stop offset="0%" stop-color="${state === 'paused' || state === 'off' ? '#CFCFCF' : ACCENT_LIGHT}"/><stop offset="100%" stop-color="${color}"/></radialGradient></defs>
<style>
.core{transform-box:fill-box;transform-origin:center;animation:breathe ${state === 'speaking' ? '0.9s' : '2.6s'} ease-in-out infinite}
.ripple{fill:none;stroke:${ACCENT_LIGHT};stroke-width:3;transform-box:fill-box;transform-origin:center;animation:ripple 2.2s ease-out infinite}
.ripple.late{animation-delay:1.1s}
.spin{stroke:${ACCENT};transform-box:fill-box;transform-origin:center;animation:spin 1.1s linear infinite}
.bar{fill:#FFFFFF;opacity:.92;transform-box:fill-box;transform-origin:center;animation-name:wave;animation-timing-function:ease-in-out;animation-iteration-count:infinite}
.still .core{animation:none}
@keyframes breathe{0%,100%{transform:scale(1)}50%{transform:scale(${state === 'speaking' ? 1.09 : 1.05})}}
@keyframes ripple{0%{transform:scale(1);opacity:.85}100%{transform:scale(1.85);opacity:0}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes wave{0%,100%{transform:scaleY(.25)}50%{transform:scaleY(1)}}
</style>
<g class="${state === 'paused' || state === 'off' ? 'still' : ''}">
${ripples}${spinner}<circle class="core" cx="180" cy="120" r="62" fill="url(#jarvis-${state})"/>
${showBars ? bars : ''}
</g></svg>`
}

const STATE_WORDS: Record<TalkState, string> = {
  off: 'Starting…',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
  paused: 'Paused',
}

// ---- Settings screen -------------------------------------------------------

/** Set when opening settings paused a conversation, so leaving resumes it. */
let resumeAfterSettings = false

async function loadSettings($: EngineInterface): Promise<void> {
  const saved = await $.store.get('settings').catch(() => undefined)
  await update($, settings, () => settingsFrom(saved))
}

/** Opens the settings in the conversation pane; a running conversation
 * pauses, so it does not hear a voice test. */
async function openSettings($: EngineInterface): Promise<void> {
  resumeAfterSettings = isActive(await read($, talk))
  if (resumeAfterSettings) await stopTalking($, 'paused', 'settings opened')
  const current = await read($, settings)
  await update($, settingsDraft, () => ({ ...current }))
}

async function closeSettings($: EngineInterface): Promise<void> {
  kill($, 'speaker')
  await update($, settingsDraft, () => null)
  if (resumeAfterSettings) {
    resumeAfterSettings = false
    void talkLoop($)
  }
}

async function saveSettings($: EngineInterface): Promise<void> {
  const edited = await read($, settingsDraft)
  if (edited === null) return
  const chosen = settingsFrom(edited)
  await $.store.set('settings', chosen)
  await update($, settings, () => chosen)
  jlog($, `settings saved style=${chosen.replyStyle} engine=${chosen.engine} voice=${chosen.voice} speed=${chosen.speed} locale=${chosen.locale} pause=${chosen.pause} research=${chosen.research} speak=${chosen.speakReplies} instructions=${chosen.instructions.length}ch`)
  await update($, chat, list => [...list, note('Settings saved.')])
  await closeSettings($)
}

async function editSettings($: EngineInterface, change: Partial<JarvisSettings>): Promise<void> {
  await update($, settingsDraft, now => (now === null ? now : { ...now, ...change }))
}

/** Plays a sample in the voice and speed being edited. */
async function testVoice($: EngineInterface): Promise<void> {
  const edited = await read($, settingsDraft)
  if (edited === null) return
  kill($, 'speaker')
  const name = edited.engine === 'natural' ? voiceName(edited.voice) : 'the Mac voice'
  jlog($, `voice test ${edited.engine} ${edited.voice} ${edited.speed}`)
  await speakAs($, `Hi, I'm ${name}. This is how I would sound as Jarvis.`, talkToken, edited)
}

function settingsScreen(
  $: EngineInterface,
  els: ReturnType<EngineInterface['ui']['resolve']>,
  edited: JarvisSettings,
) {
  const { Box, Text, Button } = els
  const Input = 'Input' in els ? els.Input : undefined
  const Select = 'Select' in els ? els.Select : undefined
  if (!Input || !Select) {
    return (
      <Box flexDirection="column" gap={1} paddingY={1}>
        <Text bold>Settings</Text>
        <Text dimColor>Settings can be changed in the Claude desktop app or the terminal.</Text>
        <Button key="settings-back" label="Back" onPress={() => closeSettings($)} />
      </Box>
    )
  }
  const field = (label: string, hint?: string) => (
    <Box flexDirection="column">
      <Text bold>{label}</Text>
      {hint !== undefined && <Text dimColor>{hint}</Text>}
    </Box>
  )

  return (
    <Box flexDirection="column" gap={1} paddingY={1}>
      <Box justifyContent="space-between" alignItems="center">
        <Text bold>Settings</Text>
        <Button key="settings-back" label="← Back" plain dimColor onPress={() => closeSettings($)} />
      </Box>

      {field('Instructions for Jarvis', 'Followed in every answer, for example: answer in simple words and keep it brief.')}
      <Input
        key="settings-instructions"
        rows={4}
        placeholder="Your own instructions for how Jarvis answers"
        value={edited.instructions}
        onInput={value => editSettings($, { instructions: value.slice(0, MAX_INSTRUCTIONS) })}
        onSubmit={value => editSettings($, { instructions: value.slice(0, MAX_INSTRUCTIONS) })}
      />

      {field('Reply style')}
      <Select
        key="settings-style"
        options={REPLY_STYLES}
        value={edited.replyStyle}
        onSelect={value => editSettings($, { replyStyle: settingsFrom({ replyStyle: value }).replyStyle })}
      />

      {field('Voice')}
      <Select
        key="settings-engine"
        options={ENGINES}
        value={edited.engine}
        onSelect={value => editSettings($, { engine: value === 'mac' ? 'mac' : 'natural' })}
      />
      {edited.engine === 'natural' && (
        <Select
          key="settings-voice"
          options={VOICES}
          value={edited.voice}
          onSelect={value => editSettings($, { voice: settingsFrom({ voice: value }).voice })}
        />
      )}

      {field('Speed')}
      <Select
        key="settings-speed"
        options={SPEEDS}
        value={edited.speed}
        onSelect={value => editSettings($, { speed: settingsFrom({ speed: value }).speed })}
      />
      <Button key="settings-test" label="▶ Test voice" onPress={() => testVoice($)} />

      {field('Listening language')}
      <Select
        key="settings-locale"
        options={LOCALES}
        value={edited.locale}
        onSelect={value => editSettings($, { locale: settingsFrom({ locale: value }).locale })}
      />

      {field('Pause that ends what you say', 'Or tap “Listening…” to send at once.')}
      <Select
        key="settings-pause"
        options={PAUSES}
        value={edited.pause}
        onSelect={value => editSettings($, { pause: settingsFrom({ pause: value }).pause })}
      />

      {field('Web research')}
      <Select
        key="settings-research"
        options={ON_OFF('On: Jarvis may search the web', 'Off')}
        value={edited.research ? 'on' : 'off'}
        onSelect={value => editSettings($, { research: value === 'on' })}
      />

      {field('Replies')}
      <Select
        key="settings-speak"
        options={ON_OFF('Spoken aloud', 'Text only')}
        value={edited.speakReplies ? 'on' : 'off'}
        onSelect={value => editSettings($, { speakReplies: value === 'on' })}
      />

      <Box gap={1}>
        <Button key="settings-save" label="Save" variant="primary" onPress={() => saveSettings($)} />
        <Button key="settings-cancel" label="Cancel" onPress={() => closeSettings($)} />
        <Button
          key="settings-reset"
          label="Reset to defaults"
          dimColor
          onPress={() => update($, settingsDraft, () => ({ ...DEFAULTS }))}
        />
      </Box>
    </Box>
  )
}

/** What pressing the state under the orb does now, or null when nothing.
 * On the desktop, Space presses it too (it holds the keyboard focus). */
function tapHint(state: TalkState, hearing: string, isArmed: boolean, surface: string): string | null {
  if (!isArmed) return null
  const how = surface === 'desktop' ? 'tap or press Space' : 'tap'
  if (state === 'listening') return hearing.trim() === '' ? null : `${how} to send now`
  if (state === 'thinking') return `${how} to stop`
  if (state === 'speaking') return `${how} to interrupt`

  return null
}

// ---- Hooks -----------------------------------------------------------------

async function openPane($: EngineInterface): Promise<void> {
  const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true })
  if (opened.isPlaced) await update($, isOpen, () => true)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // The listener and voice died with the previous load: start clean.
    await setTalk($, 'off')
    await update($, heard, () => '')
    await update($, setup, () => null)
    await update($, settingsDraft, () => null)
    await loadSettings($)
    await $.command.register({
      name: 'open-jarvis-talk-chat',
      description: 'Open Jarvis Talk: a typed side chat about this session',
    })
    await $.command.register({
      name: 'open-jarvis-talk',
      description: 'Open Jarvis Talk: talk about this session by voice',
    })

    return next(e)
  })

  on('command.run', { command: 'open-jarvis-talk-chat' }, async $ => {
    await openPane($)

    return { text: 'Jarvis opened.' }
  })

  on('command.run', { command: 'open-jarvis-talk' }, async $ => {
    await openConversation($)

    return { text: 'Conversation with Jarvis started.' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    await update($, isOpen, () => false)

    return closed
  }).catch(($, e, next) => next(e))

  on('ui.close', { id: VOICE_PANE }, async ($, e, next) => {
    const closed = await next(e)
    await stopTalking($, 'off', `pane closed by ${e.origin.kind}`)
    await update($, setup, now => (now?.phase === 'installing' ? now : null))

    return closed
  }).catch(($, e, next) => next(e))

  // One microphone icon in the footer under the prompt, beside the mode labels
  // the footer already shows (kept as they were): the way into a conversation.
  // (Mods cannot add icons to the app's own toolbar; this is the nearest place.)
  // It stays while a conversation runs: pressing it then shows that conversation.
  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const modes = e.props.modes.join(' & ')

    return (
      <Box gap={1} alignItems="center">
        {modes !== '' && <Text dimColor>{modes}</Text>}
        <Button key="talk-jarvis" label={MIC} plain onPress={() => openConversation($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: VOICE_PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = els
    const Svg = 'Svg' in els ? els.Svg : undefined
    const view = await read($, setup)
    if (view !== null) return setupScreen($, els, view)
    const edited = await read($, settingsDraft)
    if (edited !== null) return settingsScreen($, els, edited)
    const state = await read($, talk)
    const hearing = await read($, heard)
    const isArmed = await read($, tapArmed)
    const hint = tapHint(state, hearing, isArmed, e.surface)
    // Drawn as a Button whenever a tap is armed, even before anything is said,
    // so the keyboard focus can stay on it from one state to the next.
    const isTappable = isArmed && isActive(state)
    const pending = await read($, draft)
    const list = await read($, chat)
    const shownFrom = Math.max(0, list.length - 200)
    const canReplay = state !== 'thinking'

    return (
      <Box flexDirection="column" gap={1} paddingY={1}>
        <Box justifyContent="flex-end">
          <Button key="open-settings" label="⚙" plain dimColor onPress={() => openSettings($)} />
        </Box>
        {list.length === 0 && (
          <Text dimColor>Start talking. What you both say stays here to scroll back through.</Text>
        )}
        {list.slice(shownFrom).map((entry, index) =>
          entry.role === 'note' ? (
            <Text key={`vn${index}`} dimColor>
              {entry.text}
            </Text>
          ) : (
            <Box key={`vm${index}`} flexDirection="column">
              {entry.role === 'jarvis' ? (
                <Box gap={1} alignItems="center">
                  <Text bold color="claude">
                    Jarvis
                  </Text>
                  {canReplay && (
                    <Button
                      key={`replay-${shownFrom + index}`}
                      label={SPEAKER}
                      plain
                      dimColor
                      onPress={() => void replay($, entry.text).catch(() => undefined)}
                    />
                  )}
                </Box>
              ) : (
                <Text bold>You</Text>
              )}
              <Markdown text={entry.text} />
            </Box>
          ),
        )}

        <Box flexDirection="column" alignItems="center" gap={1}>
          {Svg ? (
            <Box key="orb" position="relative">
              <Svg source={orb(state)} alt={STATE_WORDS[state]} width={240} height={160} isInteractive />
              {hint !== null && (
                <Box
                  position="absolute"
                  top={0}
                  left={0}
                  right={0}
                  bottom={0}
                  justifyContent="center"
                  alignItems="center"
                >
                  <Box
                    width={ORB_CORE.width}
                    height={ORB_CORE.height}
                    overflow="hidden"
                    flexDirection="row"
                    alignItems="stretch"
                    justifyContent="center"
                  >
                    <Button key="tap-orb-area" plain onPress={() => tapOrb($)}>
                      {ORB_TAP_BLANK}
                    </Button>
                  </Box>
                </Box>
              )}
            </Box>
          ) : (
            <Text color="claude" bold>
              {state === 'listening' ? '((( ● )))' : state === 'speaking' ? '▁▃▅▇▅▃▁' : '●'}
            </Text>
          )}

          {!isTappable ? (
            <Text bold color={state === 'paused' ? undefined : 'claude'}>
              {STATE_WORDS[state]}
            </Text>
          ) : hint === null ? (
            <Button key={TAP_KEY} plain autoFocus onPress={() => tapOrb($)}>
              <Text bold color="claude">
                {STATE_WORDS[state]}
              </Text>
            </Button>
          ) : (
            <Button key={TAP_KEY} plain autoFocus onPress={() => tapOrb($)}>
              <Text bold color="claude">
                {STATE_WORDS[state]}
              </Text>{' '}
              <Text dimColor>· {hint}</Text>
            </Button>
          )}

          {state === 'listening' && hearing !== '' && (
            <Text dimColor wrap="wrap">
              “{hearing}”
            </Text>
          )}
        </Box>

        {pending !== null && (
          <Box flexDirection="column" borderStyle="round" paddingX={1}>
            <Text bold>Draft command for the session</Text>
            <Text dimColor>Say “send it” or “discard”, or press a button.</Text>
            <Markdown text={'```\n' + pending + '\n```'} />
            <Box gap={1}>
              <Button
                key="voice-send"
                label="Send to session"
                variant="primary"
                onPress={() => sendDraft($, pending)}
              />
              <Button
                key="voice-discard"
                label="Discard"
                dimColor
                onPress={() => update($, draft, () => null)}
              />
            </Box>
          </Box>
        )}

        <Box gap={1}>
          {state === 'paused' ? (
            <Button
              key="resume"
              label="Resume"
              variant="primary"
              onPress={() => void talkLoop($)}
            />
          ) : (
            <Button
              key="pause"
              label="Pause"
              dimColor
              onPress={() => stopTalking($, 'paused', 'Pause pressed')}
            />
          )}
          <Button
            key="end"
            label="End conversation"
            onPress={async () => {
              await stopTalking($, 'off', 'End pressed')
              await $.ui.close({ id: VOICE_PANE })
            }}
          />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = els
    const Input = 'Input' in els ? els.Input : undefined
    const list = await read($, chat)
    const pending = await read($, draft)
    const working = await read($, busy)
    const fieldId = await read($, field)
    const talking = isActive(await read($, talk))

    return (
      <Box flexDirection="column" gap={1}>
        <Box gap={1}>
          {!talking && (
            <Button
              key="talk"
              label="Talk"
              variant="primary"
              onPress={() => openConversation($)}
            />
          )}
          {list.length > 0 && (
            <Button
              key="clear"
              label="Clear"
              dimColor
              onPress={async () => {
                await update($, chat, () => [])
                await update($, draft, () => null)
              }}
            />
          )}
        </Box>

        {list.length === 0 && working === null && (
          <Box flexDirection="column">
            <Text dimColor>Ask about this session by typing, or press Talk. Or start with:</Text>
            {SUGGESTIONS.map((text, index) => (
              <Button
                key={`s${index}`}
                label={text}
                dimColor
                onPress={() => askJarvis($, text, false)}
              />
            ))}
          </Box>
        )}

        {list.slice(-40).map((entry, index) =>
          entry.role === 'note' ? (
            <Text key={`n${index}`} dimColor>
              {entry.text}
            </Text>
          ) : (
            <Box key={`m${index}`} flexDirection="column">
              <Text bold color={entry.role === 'jarvis' ? 'claude' : undefined}>
                {entry.role === 'you' ? (entry.isVoice ? 'You (spoken)' : 'You') : 'Jarvis'}
              </Text>
              <Markdown text={entry.text} />
            </Box>
          ),
        )}

        {working !== null && !talking && <Text dimColor>{working}</Text>}

        {pending !== null && !talking && (
          <Box flexDirection="column" borderStyle="round" paddingX={1}>
            <Text bold>Draft command for the session</Text>
            <Markdown text={'```\n' + pending + '\n```'} />
            <Box gap={1}>
              <Button
                key="send"
                label="Send to session"
                variant="primary"
                onPress={() => sendDraft($, pending)}
              />
              <Button
                key="fill"
                label="Edit in prompt box"
                onPress={async () => {
                  await $.prompt.fill({ text: pending })
                  await update($, draft, () => null)
                }}
              />
              <Button
                key="discard"
                label="Discard"
                dimColor
                onPress={() => update($, draft, () => null)}
              />
            </Box>
          </Box>
        )}

        {Input ? (
          <Input
            key={`ask-${fieldId}`}
            placeholder="Ask Jarvis about this session…"
            submitLabel="ask"
            rows={2}
            onSubmit={value => {
              const question = value.trim()
              if (!question) return
              void update($, field, n => n + 1)
              void askJarvis($, question, false)
            }}
          />
        ) : (
          <Text dimColor>Typing to Jarvis needs the desktop app or terminal.</Text>
        )}
      </Box>
    )
  })
}
