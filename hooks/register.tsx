import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ChatEntry, Setup, SetupCheck, TalkState } from '../types'

const PANE = 'jarvis'
const TITLE = 'Open Jarvis Talk · Chat'
const MAX_RESEARCH_ROUNDS = 2
const LANGUAGE = 'en-US'
const LISTEN =
  'exec "$HOME/.claude/jarvis/jarvis-listen" --locale ' +
  LANGUAGE +
  ' 2>>"$HOME/.claude/jarvis/listen.log"'

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

const SUGGESTIONS = [
  'Brief me on this session',
  'What is it doing right now?',
  'Is anything waiting on me?',
  'What should we do next?',
]

const RULES = `[Jarvis side channel. This is NOT a turn of this session.]
The user opened "Jarvis", a side assistant next to this session. For this reply only, you are Jarvis:
- You are an observer. You cannot run tools, and nothing you write reaches the session's agent.
- Answer about THIS session (the conversation above): what it is doing, why, what happened, what is next.
- Be brief and plain: short paragraphs or a few bullets, no filler.
- If you truly need facts from the web to answer, reply with ONLY <research>one precise question</research> and nothing else. You will get the findings back.
- When the user wants the session to do something ("let's do X", "tell it to..."), write the message the session's agent should receive inside ONE <command>...</command> block, as clear instructions to that agent, plus one line saying what it will do. The user approves it before it is sent.
- Never claim you did something in the session yourself.`

const VOICE_RULES = `
The user is TALKING to you by voice and your reply is read aloud: answer in one to three short spoken sentences, plain text only (no markdown, lists, code or URLs). The <research> and <command> rules still apply; when you draft a command, say in one sentence what it will do.`

function buildPrompt(
  history: readonly ChatEntry[],
  findings: readonly string[],
  isVoice: boolean,
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

  return `${RULES}${isVoice ? VOICE_RULES : ''}\n\nJarvis conversation so far:\n${lines.join('\n')}${researchText}\n\nReply as Jarvis to the user's last message.`
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

/** Asks Jarvis; resolves the reply's text (null when there was none). */
async function askJarvis($: EngineInterface, question: string, isVoice: boolean): Promise<string | null> {
  if ((await read($, busy)) !== null) return null

  await update($, chat, list => [...list, { role: 'you' as const, text: question, isVoice }])
  toNewest($)
  await update($, busy, () => 'Thinking…')
  jlog($, `ask voice=${isVoice} q=${JSON.stringify(question.slice(0, 200))}`)

  try {
    const findings: string[] = []
    for (let round = 0; round <= MAX_RESEARCH_ROUNDS; round++) {
      const history = await read($, chat)
      const reply = await $.model.fork({ prompt: buildPrompt(history, findings, isVoice) })

      if (!reply.isAnswered) {
        jlog($, `fork failed reason=${reply.reason} ${'status' in reply ? `status=${String(reply.status)}` : ''}`)
        const why =
          reply.reason === 'nothing-to-fork'
            ? 'Nothing to look at yet. Jarvis works once the session has finished at least one turn.'
            : reply.reason === 'api-error'
              ? `The model call failed (HTTP ${reply.status}).`
              : `No answer (${reply.reason}).`
        await update($, chat, list => [...list, note(why)])

        return why
      }

      const text = reply.text.trim()
      jlog($, `fork answered ${text.length}ch research=${/<research>/.test(text)} command=${/<command>/.test(text)}`)
      const wanted = /^\s*<research>([\s\S]*?)<\/research>\s*$/.exec(text)
      if (wanted && round < MAX_RESEARCH_ROUNDS) {
        const topic = (wanted[1] ?? '').trim()
        await update($, busy, () => `Researching: ${topic}`)
        await update($, chat, list => [...list, note(`Researching: ${topic}`)])
        const answer = await research($, topic)
        findings.push(`Q: ${topic}\nA: ${answer}`)
        await update($, busy, () => 'Thinking…')
        continue
      }

      const command = /<command>([\s\S]*?)<\/command>/.exec(text)
      const shown =
        text
          .replace(/<command>[\s\S]*?<\/command>/g, '')
          .replace(/<\/?research>/g, '')
          .trim() || 'Here is a draft command for the session.'
      await update($, chat, list => [...list, { role: 'jarvis' as const, text: shown }])
      toNewest($)
      if (command) {
        const body = (command[1] ?? '').trim()
        await update($, draft, () => body)

        return `${shown} Say "send it" to send it to the session, or "discard".`
      }

      return shown
    }

    return null
  } finally {
    await update($, busy, () => null)
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
const SILENT_ROUNDS_BEFORE_PAUSE = 6 // the listener waits 20 s a round

type Stream = { return?: (value?: undefined) => unknown }
type Child = { stream: Stream; pid?: number; isKilled?: boolean }
let talkToken = 0
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

async function stopTalking($: EngineInterface, to: TalkState = 'off', why = ''): Promise<void> {
  jlog($, `conversation ${to === 'off' ? 'ended' : 'paused'}${why ? ` (${why})` : ''}`)
  talkToken += 1
  watchdog?.cancel()
  watchdog = null
  kill($, 'listener')
  kill($, 'speaker')
  await update($, talk, () => to)
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
  const stream = $.process.spawn({ argv: ['/bin/zsh', '-c', LISTEN] })
  const me: Child = { stream: stream as unknown as Stream }
  listener = me
  let pending = ''
  let final: string | null = null

  try {
    for await (const piece of stream) {
      if (talkToken !== mine) break
      pending += piece.text
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        if (takePid(me, line)) continue
        if (line.startsWith('partial: ')) {
          const words = line.slice(9)
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

  return final ?? ''
}

// Jarvis's voice: Kokoro, a local neural voice (~/.claude/jarvis/speak.py, its
// model loaded in a small background server), else macOS `say`. Both run as a
// process whose pid Interrupt, Pause and End kill to stop the sound at once.
const NO_KOKORO = 'natural voice not installed'
const KOKORO =
  'echo "pid: $$"; [ -x "$HOME/.claude/jarvis/kokoro/bin/python" ] || { echo "error: ' +
  NO_KOKORO +
  '"; exit 3; }; exec "$HOME/.claude/jarvis/kokoro/bin/python" -I "$HOME/.claude/jarvis/speak.py" -- "$1"'
const SAY = 'echo "pid: $$"; exec /usr/bin/say -- "$1"'

type Spoken = { isDone: boolean; isStopped: boolean; why: string }

async function speakWith(
  $: EngineInterface,
  script: string,
  words: string,
  mine: number,
  printsDone: boolean,
): Promise<Spoken> {
  const stream = $.process.spawn({ argv: ['/bin/zsh', '-c', script, 'jarvis-say', words] })
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

async function speak($: EngineInterface, text: string, mine: number): Promise<void> {
  const words = speakable(text)
  if (!words || talkToken !== mine) return
  jlog($, `speak ${words.length}ch`)
  const kokoro = await speakWith($, KOKORO, words, mine, true)
  if (kokoro.isDone || kokoro.isStopped) return
  // Skipped at setup: the Mac voice is the choice, not a failure worth a log line.
  if (kokoro.why !== NO_KOKORO) jlog($, `Kokoro voice failed, falling back to macOS say: ${kokoro.why}`)
  const fallback = await speakWith($, SAY, words, mine, false)
  if (!fallback.isDone && !fallback.isStopped) jlog($, `say failed too: ${fallback.why}`)
}

const SEND = /^(yes|yeah|yep|ok|okay)?[\s,.!]*(send( it)?|approve( it)?|go ahead|do it)[\s.!]*$/i
const END = /^(ok(ay)?[\s,]*)?(stop( listening)?|end( the)? conversation|that's all|goodbye|bye( jarvis)?|thanks?,? (that's all|bye))[\s.!]*$/i
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
    await update($, talk, () => 'listening')
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

    if (END.test(said)) {
      await you($, said)
      await update($, talk, () => 'speaking')
      await speak($, 'Okay, bye.', mine)
      await stopTalking($, 'off', 'said goodbye')
      await $.ui.close({ id: VOICE_PANE }).catch(() => undefined)

      return
    }

    const pending = await read($, draft)
    if (pending !== null && SEND.test(said)) {
      await you($, said)
      await sendDraft($, pending)
      await update($, talk, () => 'speaking')
      await speak($, 'Sent.', mine)
      continue
    }
    if (pending !== null && DISCARD.test(said)) {
      await you($, said)
      await update($, draft, () => null)
      await update($, talk, () => 'speaking')
      await speak($, 'Discarded.', mine)
      continue
    }

    await update($, talk, () => 'thinking')
    const reply = await askJarvis($, said, true)
    if (talkToken !== mine) return
    if (reply) {
      await update($, talk, () => 'speaking')
      await speak($, reply, mine)
    }
  }
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

// ---- Hooks -----------------------------------------------------------------

async function openPane($: EngineInterface): Promise<void> {
  const opened = await $.ui.open({ id: PANE, title: TITLE, focus: true })
  if (opened.isPlaced) await update($, isOpen, () => true)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // The listener and voice died with the previous load: start clean.
    await update($, talk, () => 'off')
    await update($, heard, () => '')
    await update($, setup, () => null)
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
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (isActive(await read($, talk))) return next(e)
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
    const state = await read($, talk)
    const hearing = await read($, heard)
    const pending = await read($, draft)
    const list = await read($, chat)

    return (
      <Box flexDirection="column" gap={1} paddingY={1}>
        {list.length === 0 && (
          <Text dimColor>Start talking. What you both say stays here to scroll back through.</Text>
        )}
        {list.slice(-200).map((entry, index) =>
          entry.role === 'note' ? (
            <Text key={`vn${index}`} dimColor>
              {entry.text}
            </Text>
          ) : (
            <Box key={`vm${index}`} flexDirection="column">
              <Text bold color={entry.role === 'jarvis' ? 'claude' : undefined}>
                {entry.role === 'you' ? 'You' : 'Jarvis'}
              </Text>
              <Markdown text={entry.text} />
            </Box>
          ),
        )}

        <Box flexDirection="column" alignItems="center" gap={1}>
          {Svg ? (
            <Svg source={orb(state)} alt={STATE_WORDS[state]} width={240} height={160} isInteractive />
          ) : (
            <Text color="claude" bold>
              {state === 'listening' ? '((( ● )))' : state === 'speaking' ? '▁▃▅▇▅▃▁' : '●'}
            </Text>
          )}

          <Text bold color={state === 'paused' ? undefined : 'claude'}>
            {STATE_WORDS[state]}
          </Text>

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
          {state === 'speaking' && (
            <Button key="interrupt" label="Interrupt" onPress={() => kill($, 'speaker')} />
          )}
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
