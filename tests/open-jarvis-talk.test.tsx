import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'open-jarvis-talk',
  component: 'Pane',
  requestId: 'jarvis',
  props: {
    title: 'Open Jarvis Talk · Chat',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const usage = {
  input_tokens: 1,
  output_tokens: 1,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
}

const DRAFTING = {
  value: {
    isAnswered: true,
    text: 'I will ask it to add tests.\n<command>Add unit tests for the parser.</command>',
    usage,
  },
}

test('opening asks nothing; suggestions are offered instead', async ($, on) => {
  let forks = 0
  on('command.register', () => ({ value: { command: 'open-jarvis-talk-chat' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('model.fork', () => {
    forks += 1

    return DRAFTING
  })

  await $.command.run({ command: 'open-jarvis-talk-chat', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(forks).toBe(0)
  await ui.press({ key: 's0' })
  expect(forks).toBe(1)
  expect(await ui.find({ type: 'Text', text: /Draft command/ })).toBeDefined()
  await ui.unmount()
})

test('typed: ask, get a draft, approve it: it is submitted to the session', async ($, on) => {
  const forks: string[] = []
  const submitted: string[] = []
  on('model.fork', (_, e) => {
    forks.push(e.prompt)

    return DRAFTING
  })
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)

    return { text: e.text }
  })

  for (const [round, surface] of (['terminal', 'desktop'] as const).entries()) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.input({ key: `ask-${round}`, text: "let's add tests" })

    expect(forks.at(-1)).toContain("User: let's add tests")
    await ui.press({ key: 'send' })
    expect(submitted.at(-1)).toBe('Add unit tests for the parser.')
    expect(await ui.find({ type: 'Text', text: /Draft command/ })).toBeUndefined()

    await ui.press({ key: 'clear' })
    await ui.unmount()
  }
})

const FOOTER = {
  plugin: 'open-jarvis-talk',
  surface: 'desktop',
  component: 'SessionMode',
  requestId: 'footer',
  props: { modes: [] as string[] },
} as const

const isSetup = (argv: readonly string[]) => (argv[1] ?? '').endsWith('setup/jarvis-setup.sh')
const CHECK = {
  macos: '27.2', macos_ok: 'yes', arch: 'arm64', ram_gb: '32', free_mb: '100000', spare_mb: '500',
  tools: 'yes', uv: '/opt/homebrew/bin/uv', dictation: 'on', listener: 'ready', voice: 'ready',
  voice_supported: 'yes', voice_why: '', need_mb: '0', download_mb: '0', voice_disk_mb: '560',
  voice_download_mb: '400', ready: 'yes',
}
const checked = (change: Partial<typeof CHECK> = {}) => ({
  value: {
    exitCode: 0,
    stdout: Object.entries({ ...CHECK, ...change }).map(([key, value]) => `${key}=${value}`).join('\n') + '\n',
    stderr: '',
  },
})
const FRESH = { listener: 'missing', voice: 'missing', uv: 'none', ready: 'no', need_mb: '606', download_mb: '445' }
const RAN = { value: { exitCode: 0, stdout: '', stderr: '' } }
/** process.run for a Mac that is set up: the check says ready, the rest succeed. */
const runReady = (_: unknown, e: { argv: readonly string[] }) => (isSetup(e.argv) && e.argv[2] === 'check' ? checked() : RAN)

const isKokoro = (argv: readonly string[]) => (argv[2] ?? '').includes('speak.py')
const isMacSay = (argv: readonly string[]) => (argv[2] ?? '').includes('/usr/bin/say')
const isSay = (argv: readonly string[]) => isKokoro(argv) || isMacSay(argv)
const KOKORO_SPOKE = { stream: 'stdout' as const, text: 'pid: 9001\nspeaking voice=af_heart via=server after=0.30s\ndone\n' }

const VOICE = { ...PANE, requestId: 'jarvis-voice', props: { ...PANE.props, title: 'Open Jarvis Talk' } } as const

test('conversation mode: hears, speaks the answer, "send it" approves, silence pauses', async ($, on) => {
  const said: string[] = []
  const submitted: string[] = []
  const opened: string[] = []
  const heard = ["let's add tests", 'send it']
  mock.clock(on)
  on('process.run', runReady)
  on('ui.open', (_, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('model.fork', (_, e) => {
    expect(e.prompt).toContain('TALKING to you by voice')

    return DRAFTING
  })
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)

    return { text: e.text }
  })
  on('process.spawn', async function* (_, e) {
    if (isSay(e.argv)) {
      said.push(e.argv[4] ?? '')
      yield KOKORO_SPOKE
    } else {
      const words = heard.shift() ?? ''
      yield { stream: 'stdout' as const, text: `listening\npartial: ${words}\nfinal: ${words}\n` }
    }

    return { value: { code: 0, signal: null } }
  })

  const chatPane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await chatPane.press({ key: 'talk' })
  expect(opened).toContain('jarvis-voice')

  expect(said[0]).toContain('I will ask it to add tests.')
  expect(said[0]).toContain('send it')
  expect(submitted).toEqual(['Add unit tests for the parser.'])
  expect(said[1]).toBe('Sent.')
  await chatPane.unmount()

  for (const surface of ['desktop', 'terminal'] as const) {
    const voice = await $.ui.mount({ ...VOICE, surface })
    expect((await voice.find({ type: 'Text', text: /^Paused$/ }))?.text).toBe('Paused')
    expect(await voice.find({ type: 'Button', key: 'resume' })).toBeDefined()
    expect(await voice.find({ type: 'Button', key: 'end' })).toBeDefined()
    await voice.unmount()
  }
})

test('a listener error is shown and the conversation pauses', async ($, on) => {
  mock.clock(on)
  on('process.run', runReady)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: 'error: the microphone is not allowed for Claude\n' }

    return { value: { code: 3, signal: null } }
  })

  await $.command.run({ command: 'open-jarvis-talk', args: '' })
  const voice = await $.ui.mount({ ...VOICE, surface: 'desktop' })

  expect((await voice.find({ type: 'Text', text: /Conversation stopped/ }))?.text).toContain('microphone')
  expect(await voice.find({ type: 'Button', key: 'resume' })).toBeDefined()
  await voice.unmount()
})

test('Dictation turned off: the reason is shown on the conversation screen', async ($, on) => {
  mock.clock(on)
  on('process.run', runReady)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.spawn', async function* () {
    yield {
      stream: 'stdout' as const,
      text: 'listening\nerror: macOS Dictation is turned off. Turn it on in System Settings > Keyboard > Dictation, then press Resume.\n',
    }

    return { value: { code: 7, signal: null } }
  })

  await $.command.run({ command: 'open-jarvis-talk', args: '' })
  const voice = await $.ui.mount({ ...VOICE, surface: 'desktop' })

  expect((await voice.find({ type: 'Text', text: /Dictation is turned off/ }))?.text).toContain('Keyboard > Dictation')
  expect((await voice.find({ type: 'Text', text: /^Paused$/ }))?.text).toBe('Paused')
  await voice.unmount()
})

test('listening that keeps ending at once stops instead of looping', async ($, on) => {
  mock.clock(on)
  let rounds = 0
  on('process.run', runReady)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.spawn', async function* () {
    rounds += 1
    yield { stream: 'stdout' as const, text: 'listening\nfinal: \n' }

    return { value: { code: 0, signal: null } }
  })

  await $.command.run({ command: 'open-jarvis-talk', args: '' })
  const voice = await $.ui.mount({ ...VOICE, surface: 'desktop' })

  expect(rounds).toBe(2)
  expect((await voice.find({ type: 'Text', text: /keeps ending at once/ }))?.text).toBeDefined()
  await voice.unmount()
})

test('End conversation kills the running listener by its pid at once', async ($, on) => {
  mock.clock(on)
  const killed: string[] = []
  let releaseListener = () => {}
  const listenerExits = new Promise<void>(resolve => {
    releaseListener = resolve
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    if (isSetup(e.argv)) return checked()
    if (e.argv[0] === '/bin/kill') {
      killed.push(e.argv[2] ?? '')
      releaseListener()
    }

    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: 'pid: 4242\nlistening\n' }
    await listenerExits // a real listener keeps listening until killed

    return { value: { code: null, signal: 'SIGTERM' } }
  })

  await $.command.run({ command: 'open-jarvis-talk', args: '' })
  const voice = await $.ui.mount({ ...VOICE, surface: 'desktop' })
  await voice.press({ key: 'end' })

  expect(killed).toEqual(['4242'])
  await voice.unmount()
})

test('saying "goodbye" ends the conversation and closes it', async ($, on) => {
  const clock = mock.clock(on)
  const said: string[] = []
  const closed: string[] = []
  on('process.run', runReady)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', (_, e) => {
    closed.push(e.id)

    return { value: undefined }
  })
  on('process.spawn', async function* (_, e) {
    if (isSay(e.argv)) {
      said.push(e.argv[4] ?? '')
      yield KOKORO_SPOKE
    } else yield { stream: 'stdout' as const, text: 'listening\nfinal: Goodbye.\n' }

    return { value: { code: 0, signal: null } }
  })

  await $.command.run({ command: 'open-jarvis-talk', args: '' })
  await clock.settle()

  expect(said).toEqual(['Okay, bye.'])
  expect(closed).toContain('jarvis-voice')
})

/** Runs one spoken round: what the listener hears, what the model answers. */
async function oneRound(
  $: Parameters<Parameters<typeof test>[1]>[0],
  on: Parameters<Parameters<typeof test>[1]>[1],
  words: string,
  answer = 'Sure.',
) {
  const clock = mock.clock(on)
  const said: string[] = []
  const closed: string[] = []
  const asked: string[] = []
  let rounds = 0
  on('process.run', runReady)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', (_, e) => {
    closed.push(e.id)

    return { value: undefined }
  })
  on('model.fork', (_, e) => {
    asked.push(e.prompt)

    return { value: { isAnswered: true, text: answer, usage } }
  })
  on('process.spawn', async function* (_, e) {
    if (isSay(e.argv)) {
      said.push(e.argv[4] ?? '')
      yield KOKORO_SPOKE
    } else {
      rounds += 1
      yield {
        stream: 'stdout' as const,
        text: rounds === 1 ? `listening\nfinal: ${words}\n` : 'error: done for this test\n',
      }
    }

    return { value: { code: 0, signal: null } }
  })

  await $.command.run({ command: 'open-jarvis-talk', args: '' })
  await clock.settle()

  return { said, closed, asked }
}

for (const words of ['Bye.', 'Stop.', "Okay, thank you, that's it, you can go."]) {
  test(`when the user says ${JSON.stringify(words)}, the conversation should end without asking the model`, async ($, on) => {
    const { said, closed, asked } = await oneRound($, on, words)

    expect(asked).toEqual([])
    expect(said).toEqual(['Okay, bye.'])
    expect(closed).toContain('jarvis-voice')
  })
}

const NOT_GOODBYES = [
  "That's all right.",
  "That's all good.",
  "That's all fine.",
  "Yes, that's it.",
  "Perfect, that's it.",
  "That's it?",
  "We're done?",
  'Stop?',
  '帮我把测试写完，bye。',
  'stop，然后把这个改了',
  'テストを書いて、OK、bye',
  '테스트 끝내 줘, bye',
]

for (const words of NOT_GOODBYES) {
  test(`when the user says ${JSON.stringify(words)}, Jarvis should answer and the conversation should stay open`, async ($, on) => {
    const { said, closed, asked } = await oneRound($, on, words)

    expect(asked.length).toBe(1)
    expect(said).toEqual(['Sure.'])
    expect(closed).not.toContain('jarvis-voice')
  })
}

test('when the user says "Yes, that\'s it." with a draft pending, the conversation should stay open and the draft unsent', async ($, on) => {
  const clock = mock.clock(on)
  const closed: string[] = []
  const asked: string[] = []
  const submitted: string[] = []
  const heard = ["let's add tests", "Yes, that's it."]
  on('process.run', runReady)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', (_, e) => {
    closed.push(e.id)

    return { value: undefined }
  })
  on('prompt.submit', (_, e) => {
    submitted.push(e.text)

    return { text: e.text }
  })
  on('model.fork', (_, e) => {
    asked.push(e.prompt)

    return asked.length === 1 ? DRAFTING : { value: { isAnswered: true, text: 'Sure.', usage } }
  })
  on('process.spawn', async function* (_, e) {
    if (isSay(e.argv)) {
      yield KOKORO_SPOKE
    } else {
      const words = heard.shift()
      yield { stream: 'stdout' as const, text: words ? `listening\nfinal: ${words}\n` : 'error: done for this test\n' }
    }

    return { value: { code: 0, signal: null } }
  })

  await $.command.run({ command: 'open-jarvis-talk', args: '' })
  await clock.settle()

  expect(asked.length).toBe(2)
  expect(submitted).toEqual([])
  expect(closed).not.toContain('jarvis-voice')
})

test('when a reply drafts a command and also carries <end/>, the conversation should stay open', async ($, on) => {
  const { said, closed } = await oneRound(
    $,
    on,
    'Tell it to finalize everything.',
    'Will do. <command>Please finalize everything.</command> <end/>',
  )

  expect(said[0]).toContain('send it')
  expect(said[0]).not.toContain('<end')
  expect(closed).not.toContain('jarvis-voice')
})

test('"that\'s it" followed by a request is not a goodbye: Jarvis answers it', async ($, on) => {
  const { said, closed, asked } = await oneRound($, on, "That's it for the readme, now finish the tests.")

  expect(asked.length).toBe(1)
  expect(said).toEqual(['Sure.'])
  expect(closed).not.toContain('jarvis-voice')
})

test('Jarvis ends the conversation itself when its reply carries <end/>', async ($, on) => {
  const { said, closed, asked } = await oneRound($, on, 'Alright, I think we are good here.', 'Talk soon! <end/>')

  expect(asked[0]).toContain('<end/>')
  expect(said).toEqual(['Talk soon!'])
  expect(closed).toContain('jarvis-voice')
})

test('drafted commands relay the request instead of planning it', async ($, on) => {
  const { asked } = await oneRound($, on, 'Ask the session to finalize everything.')

  expect(asked[0]).toContain('relays the user\'s request; it is not your plan')
  expect(asked[0]).toContain('never add steps, files to touch, an approach or tasks the user did not mention')
  expect(asked[0]).toContain('naming the file when that is what the user meant')
})

test('a tap right as the state changes is ignored; it works once the state has held', async ($, on) => {
  const clock = mock.clock(on)
  const killed: string[] = []
  let releaseSpeaker = () => {}
  const speakerExits = new Promise<void>(resolve => {
    releaseSpeaker = resolve
  })
  let rounds = 0
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', (_, e) => {
    if (isSetup(e.argv)) return checked()
    if (e.argv[0] === '/bin/kill') {
      killed.push(e.argv[2] ?? '')
      releaseSpeaker()
    }

    return RAN
  })
  on('model.fork', () => ({ value: { isAnswered: true, text: 'A long answer.', usage } }))
  on('process.spawn', async function* (_, e) {
    if (isSay(e.argv)) {
      yield { stream: 'stdout' as const, text: 'pid: 9002\n' }
      await speakerExits
    } else {
      rounds += 1
      yield {
        stream: 'stdout' as const,
        text: rounds === 1 ? 'listening\npartial: hi\nfinal: hi\n' : 'error: done for this test\n',
      }
    }

    return { value: { code: 0, signal: null } }
  })

  await $.command.run({ command: 'open-jarvis-talk', args: '' })
  const voice = await $.ui.mount({ ...VOICE, surface: 'desktop' })
  // Speaking has only just started: no tap target yet, and a press does nothing.
  expect(await voice.find({ type: 'Text', text: /tap to interrupt/ })).toBeUndefined()
  expect(await voice.find({ type: 'Text', text: /^Speaking…$/ })).toBeDefined()
  await clock.advance(300)
  expect(await voice.find({ type: 'Button', key: 'tap-orb' })).toBeUndefined()
  expect(killed).toEqual([])

  await clock.advance(600)
  expect(await voice.find({ type: 'Text', text: /tap to interrupt/ })).toBeDefined()
  await voice.press({ key: 'tap-orb' })
  expect(killed).toEqual(['9002'])
  // The tap disarms at once: a second press has nothing to land on.
  expect(await voice.find({ type: 'Button', key: 'tap-orb' })).toBeUndefined()
  await voice.unmount()
})

test('the conversation stops when its pane is no longer shown', async ($, on) => {
  const clock = mock.clock(on)
  const killed: string[] = []
  let releaseListener = () => {}
  const listenerExits = new Promise<void>(resolve => {
    releaseListener = resolve
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({
    value: [{ id: 'jarvis-voice', title: 'x', isShown: false, isFocused: false, isPlaced: true }],
  }))
  on('process.run', (_, e) => {
    if (isSetup(e.argv)) return checked()
    if (e.argv[0] === '/bin/kill') {
      killed.push(e.argv[2] ?? '')
      releaseListener()
    }

    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: 'pid: 777\nlistening\n' }
    await listenerExits

    return { value: { code: null, signal: 'SIGTERM' } }
  })

  await $.command.run({ command: 'open-jarvis-talk', args: '' })
  await clock.advance(2500)
  await clock.settle()

  expect(killed).toEqual(['777'])
})

test('the microphone sits in the footer under the prompt, still offered after a pause', async ($, on) => {
  mock.clock(on)
  on('process.run', runReady)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: { command: 'open-jarvis-talk-chat' } }))
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: 'error: the microphone is not allowed for Claude\n' }

    return { value: { code: 3, signal: null } }
  })

  await $.command.run({ command: 'open-jarvis-talk-chat', args: '' }) // the chat pane is open
  await $.command.run({ command: 'open-jarvis-talk', args: '' }) // and the talk paused

  for (const surface of ['desktop', 'terminal'] as const) {
    const footer = await $.ui.mount({ ...FOOTER, surface, props: { modes: ['focus', 'memory paused'] } })
    expect((await footer.find({ type: 'Button', key: 'talk-jarvis' }))?.props.label).toBe('🎙️')
    expect(await footer.find({ type: 'Text', text: 'focus & memory paused' })).toBeDefined() // modes kept
    expect(await footer.find({ type: 'Button', key: 'open-jarvis' })).toBeUndefined()
    await footer.unmount()
  }

  const chatPane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await chatPane.find({ type: 'Button', key: 'talk' })).toBeDefined()
  await chatPane.unmount()
})

test('a reload resets a stale conversation state', async ($, on) => {
  const clock = mock.clock(on)
  on('process.run', runReady)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: { command: 'open-jarvis-talk-chat' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: 'error: the microphone is not allowed for Claude\n' }

    return { value: { code: 3, signal: null } }
  })

  await $.command.run({ command: 'open-jarvis-talk', args: '' })
  await clock.settle()
  const before = await $.ui.mount({ ...VOICE, surface: 'desktop' })
  expect(await before.find({ type: 'Button', key: 'resume' })).toBeDefined()
  await before.unmount()

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const voice = await $.ui.mount({ ...VOICE, surface: 'desktop' })
  expect(await voice.find({ type: 'Button', key: 'resume' })).toBeUndefined()
  await voice.unmount()
})

test('the conversation screen keeps the whole talk history', async ($, on) => {
  const clock = mock.clock(on)
  const heard = ['What is the session doing?', 'And what is next?']
  let answers = 0
  on('process.run', runReady)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('model.fork', () => {
    answers += 1

    return { value: { isAnswered: true, text: `Answer number ${answers}.`, usage } }
  })
  on('process.spawn', async function* (_, e) {
    if (isSay(e.argv)) {
      yield KOKORO_SPOKE
    } else {
      const words = heard.shift()
      if (words === undefined) {
        yield { stream: 'stdout' as const, text: 'error: test over\n' }
      } else {
        yield { stream: 'stdout' as const, text: `listening\nfinal: ${words}\n` }
      }
    }

    return { value: { code: 0, signal: null } }
  })

  const voice = await $.ui.mount({ ...VOICE, surface: 'desktop' })
  await $.command.run({ command: 'open-jarvis-talk', args: '' })
  await clock.settle()

  for (const text of [/What is the session doing/, /Answer number 1/, /And what is next/, /Answer number 2/]) {
    expect(await voice.find({ type: 'Markdown', text })).toBeDefined()
  }
  expect(await voice.find({ type: 'Text', text: /^Paused$/ })).toBeDefined() // the orb sits below
  await voice.unmount()
})

test('Kokoro speaks; when it fails, macOS say takes over and the reason is logged', async ($, on) => {
  const clock = mock.clock(on)
  const voices: string[] = []
  const logged: string[] = []
  let kokoroWorks = true
  const heard = ['First question?', 'Second question?']
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('model.fork', () => ({ value: { isAnswered: true, text: 'Here is the answer.', usage } }))
  on('process.run', (_, e) => {
    if (isSetup(e.argv)) return checked()
    if (e.argv[3] === 'jlog') logged.push(e.argv[4] ?? '')

    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('process.spawn', async function* (_, e) {
    if (isKokoro(e.argv)) {
      voices.push('kokoro')
      if (kokoroWorks) {
        yield KOKORO_SPOKE
      } else {
        yield { stream: 'stdout' as const, text: 'pid: 9003\nerror: FileNotFoundError: kokoro-v1.0.onnx\n' }

        return { value: { code: 1, signal: null } }
      }
    } else if (isMacSay(e.argv)) {
      voices.push('say')
      yield { stream: 'stdout' as const, text: 'pid: 9004\n' }
    } else {
      const words = heard.shift()
      if (words === undefined) yield { stream: 'stdout' as const, text: 'error: test over\n' }
      else {
        yield { stream: 'stdout' as const, text: `listening\nfinal: ${words}\n` }
        kokoroWorks = heard.length > 0 // the second answer finds Kokoro broken
      }
    }

    return { value: { code: 0, signal: null } }
  })

  await $.command.run({ command: 'open-jarvis-talk', args: '' })
  await clock.settle()

  expect(voices).toEqual(['kokoro', 'kokoro', 'say'])
  expect(logged.some(line => line.includes('falling back to macOS say') && line.includes('kokoro-v1.0.onnx'))).toBe(true)
})

test('Tapping to interrupt stops the Kokoro voice by pid and does not fall back to say', async ($, on) => {
  const clock = mock.clock(on)
  const voices: string[] = []
  const killed: string[] = []
  let releaseVoice = () => {}
  const voiceKilled = new Promise<void>(resolve => {
    releaseVoice = resolve
  })
  let rounds = 0
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('model.fork', () => ({ value: { isAnswered: true, text: 'A long answer.', usage } }))
  on('process.run', (_, e) => {
    if (isSetup(e.argv)) return checked()
    if (e.argv[0] === '/bin/kill') {
      killed.push(e.argv[2] ?? '')
      releaseVoice()
    }

    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('process.spawn', async function* (_, e) {
    if (isKokoro(e.argv)) {
      voices.push('kokoro')
      yield { stream: 'stdout' as const, text: 'pid: 5150\nspeaking voice=af_heart via=server after=0.30s\n' }
      await voiceKilled // still talking until killed

      return { value: { code: null, signal: 'SIGTERM' } }
    }
    if (isMacSay(e.argv)) voices.push('say')
    else {
      rounds += 1
      yield {
        stream: 'stdout' as const,
        text: rounds === 1 ? 'listening\nfinal: Tell me everything.\n' : 'error: test over\n',
      }
    }

    return { value: { code: 0, signal: null } }
  })

  const voice = await $.ui.mount({ ...VOICE, surface: 'desktop' })
  await $.command.run({ command: 'open-jarvis-talk', args: '' })
  await clock.settle()
  await clock.advance(ARMED)
  await voice.press({ key: 'tap-orb' })
  await clock.settle()

  expect(killed).toEqual(['5150'])
  expect(voices).toEqual(['kokoro'])
  await voice.unmount()
})

/** Past the wait before a tap under the orb acts (TAP_ARM_MS). */
const ARMED = 900

const SETUP_VIEW = { ...VOICE, props: { ...VOICE.props, title: 'Open Jarvis Talk · Setup' } } as const

test('first press on a Mac not set up: checks it, lists what to install, installs on Install, then talks', async ($, on) => {
  const clock = mock.clock(on)
  const titles: string[] = []
  const installs: string[][] = []
  let listened = 0
  on('ui.open', (_, e) => {
    titles.push(e.title ?? '')

    return { value: { isPlaced: true } }
  })
  on('process.run', (_, e) => (isSetup(e.argv) && e.argv[2] === 'check' ? checked(FRESH) : RAN))
  on('process.spawn', async function* (_, e) {
    if (isSetup(e.argv)) {
      installs.push([...e.argv.slice(2)])
      yield { stream: 'stdout' as const, text: 'step: Building the speech listener\nok: Speech listener built\n' }
      yield { stream: 'stderr' as const, text: 'step: Downloading uv 0.12.18\n' }
      yield { stream: 'stdout' as const, text: 'ok: Natural voice installed\ndone\n' }

      return { value: { code: 0, signal: null } }
    }
    listened += 1
    yield { stream: 'stdout' as const, text: 'error: test over\n' }

    return { value: { code: 0, signal: null } }
  })

  const footer = await $.ui.mount(FOOTER)
  await footer.press({ key: 'talk-jarvis' })
  await footer.unmount()
  expect(titles).toEqual(['Open Jarvis Talk · Setup'])
  expect(listened).toBe(0) // nothing is installed or heard before the person says so

  for (const surface of ['desktop', 'terminal'] as const) {
    const view = await $.ui.mount({ ...SETUP_VIEW, surface })
    expect(await view.find({ type: 'Text', text: /Your Mac can run Open Jarvis Talk/ })).toBeDefined()
    expect(await view.find({ type: 'Text', text: /Python 3.12, the Kokoro voice engine/ })).toBeDefined()
    expect(await view.find({ type: 'Text', text: /astral-sh\/uv/ })).toBeDefined()
    expect((await view.find({ type: 'Button', key: 'install' }))?.props.label).toBe('Install (about 606 MB)')
    await view.unmount()
  }

  const view = await $.ui.mount({ ...SETUP_VIEW, surface: 'desktop' })
  await view.press({ key: 'install' })
  expect(installs).toEqual([['install']])
  expect(await view.find({ type: 'Text', text: /Speech listener built/ })).toBeDefined()
  expect(await view.find({ type: 'Text', text: /Downloading uv/ })).toBeDefined()
  expect(await view.find({ type: 'Text', text: /Open Jarvis Talk is ready/ })).toBeDefined()

  await view.press({ key: 'start' })
  await clock.settle()
  expect(titles.at(-1)).toBe('Open Jarvis Talk')
  expect(listened).toBe(1)
  expect(await view.find({ type: 'Text', text: /Conversation stopped: test over/ })).toBeDefined()
  await view.unmount()
})

test('skipping the natural voice installs with --no-voice and shrinks the size', async ($, on) => {
  const installs: string[][] = []
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', (_, e) => (isSetup(e.argv) && e.argv[2] === 'check' ? checked(FRESH) : RAN))
  on('process.spawn', async function* (_, e) {
    installs.push([...e.argv.slice(2)])
    yield { stream: 'stdout' as const, text: 'ok: Skipped the natural voice\ndone\n' }

    return { value: { code: 0, signal: null } }
  })

  await $.command.run({ command: 'open-jarvis-talk', args: '' })
  const view = await $.ui.mount({ ...SETUP_VIEW, surface: 'desktop' })
  await view.press({ key: 'toggle-voice' })
  expect((await view.find({ type: 'Button', key: 'install' }))?.props.label).toBe('Install (about 1 MB)')
  expect(await view.find({ type: 'Text', text: /built-in Mac voice/ })).toBeDefined()
  await view.press({ key: 'install' })
  expect(installs).toEqual([['install', '--no-voice']])
  await view.unmount()
})

test('a Mac too old for Jarvis says why and offers no Install', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', (_, e) =>
    isSetup(e.argv) ? checked({ ...FRESH, macos: '12.7', macos_ok: 'no' }) : RAN,
  )

  await $.command.run({ command: 'open-jarvis-talk', args: '' })
  const view = await $.ui.mount({ ...SETUP_VIEW, surface: 'desktop' })
  expect(await view.find({ type: 'Text', text: /needs macOS 13 or later/ })).toBeDefined()
  expect(await view.find({ type: 'Button', key: 'install' })).toBeUndefined()
  expect(await view.find({ type: 'Button', key: 'later' })).toBeDefined()
  await view.unmount()
})

test('no Command Line Tools: offers to install them and holds Install until they are there', async ($, on) => {
  const asked: string[] = []
  let hasTools = false
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', (_, e) => {
    if (!isSetup(e.argv)) return RAN
    asked.push(e.argv[2] ?? '')
    if (e.argv[2] === 'tools') {
      hasTools = true

      return RAN
    }

    return checked({ ...FRESH, tools: hasTools ? 'yes' : 'no', dictation: 'off' })
  })

  await $.command.run({ command: 'open-jarvis-talk', args: '' })
  const view = await $.ui.mount({ ...SETUP_VIEW, surface: 'desktop' })
  expect(await view.find({ type: 'Button', key: 'install' })).toBeUndefined()
  expect(await view.find({ type: 'Button', key: 'open-dictation' })).toBeDefined()
  await view.press({ key: 'install-tools' })
  await view.press({ key: 'recheck' })
  expect(asked).toEqual(['check', 'tools', 'check'])
  expect(await view.find({ type: 'Button', key: 'install' })).toBeDefined()
  await view.unmount()
})

test('an installer failure shows the reason and Try again checks again', async ($, on) => {
  const asked: string[] = []
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', (_, e) => {
    if (isSetup(e.argv)) asked.push(e.argv[2] ?? '')

    return isSetup(e.argv) ? checked(FRESH) : RAN
  })
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: 'step: Downloading the voice model\nerror: could not download the voice model\n' }

    return { value: { code: 1, signal: null } }
  })

  await $.command.run({ command: 'open-jarvis-talk', args: '' })
  const view = await $.ui.mount({ ...SETUP_VIEW, surface: 'desktop' })
  await view.press({ key: 'install' })
  expect(await view.find({ type: 'Text', text: /Setup stopped: could not download the voice model/ })).toBeDefined()
  await view.press({ key: 'retry' })
  expect(asked).toEqual(['check', 'check'])
  expect(await view.find({ type: 'Button', key: 'install' })).toBeDefined()
  await view.unmount()
})

test('tapping the state under the orb while listening sends what was said at once', async ($, on) => {
  const clock = mock.clock(on)
  const killed: string[] = []
  const asked: string[] = []
  let rounds = 0
  let releaseListener = () => {}
  const listenerExits = new Promise<void>(resolve => {
    releaseListener = resolve
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', (_, e) => {
    if (isSetup(e.argv)) return checked()
    if (e.argv[0] === '/bin/kill') {
      killed.push(e.argv[2] ?? '')
      releaseListener()
    }

    return RAN
  })
  on('model.fork', (_, e) => {
    asked.push(e.prompt)

    return { value: { isAnswered: true, text: 'It is noon.', usage } }
  })
  on('process.spawn', async function* (_, e) {
    if (isSay(e.argv)) {
      yield KOKORO_SPOKE
    } else {
      rounds += 1
      if (rounds === 1) {
        yield { stream: 'stdout' as const, text: 'pid: 4242\nlistening\npartial: what time is it\n' }
        await listenerExits // no pause yet: the person taps instead of waiting
      } else {
        yield { stream: 'stdout' as const, text: 'error: done for this test\n' }
      }
    }

    return { value: { code: 0, signal: null } }
  })

  await $.command.run({ command: 'open-jarvis-talk', args: '' })
  await clock.advance(ARMED)
  const voice = await $.ui.mount({ ...VOICE, surface: 'desktop' })
  expect((await voice.find({ type: 'Text', text: /tap to send now/ }))?.text).toBeDefined()
  await voice.press({ key: 'tap-orb' })
  await voice.unmount()

  expect(killed).toEqual(['4242'])
  for (let wait = 0; wait < 50 && asked.length === 0; wait++) await Promise.resolve()
  expect(asked[0]).toContain('what time is it')
})

test('tapping while speaking interrupts; there is no separate Interrupt button', async ($, on) => {
  const clock = mock.clock(on)
  const killed: string[] = []
  let releaseSpeaker = () => {}
  const speakerExits = new Promise<void>(resolve => {
    releaseSpeaker = resolve
  })
  let rounds = 0
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', (_, e) => {
    if (isSetup(e.argv)) return checked()
    if (e.argv[0] === '/bin/kill') {
      killed.push(e.argv[2] ?? '')
      releaseSpeaker()
    }

    return RAN
  })
  on('model.fork', () => ({ value: { isAnswered: true, text: 'A long answer.', usage } }))
  on('process.spawn', async function* (_, e) {
    if (isSay(e.argv)) {
      yield { stream: 'stdout' as const, text: 'pid: 9001\n' }
      await speakerExits // still speaking until killed
    } else {
      rounds += 1
      yield {
        stream: 'stdout' as const,
        text: rounds === 1 ? 'listening\npartial: hi\nfinal: hi\n' : 'error: done for this test\n',
      }
    }

    return { value: { code: 0, signal: null } }
  })

  await $.command.run({ command: 'open-jarvis-talk', args: '' })
  await clock.advance(ARMED)
  const voice = await $.ui.mount({ ...VOICE, surface: 'terminal' })
  expect((await voice.find({ type: 'Text', text: /tap to interrupt/ }))?.text).toBeDefined()
  expect(await voice.find({ type: 'Button', key: 'interrupt' })).toBeUndefined()
  await voice.press({ key: 'tap-orb' })
  await voice.unmount()

  expect(killed).toEqual(['9001'])
  for (let wait = 0; wait < 50 && rounds < 2; wait++) await Promise.resolve()
  expect(rounds).toBe(2) // it listens again
})

test('tapping while thinking stops: the late answer is dropped and it listens again', async ($, on) => {
  const clock = mock.clock(on)
  const said: string[] = []
  let rounds = 0
  let releaseAnswer = () => {}
  const answerArrives = new Promise<void>(resolve => {
    releaseAnswer = resolve
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', runReady)
  on('model.fork', async () => {
    await answerArrives

    return { value: { isAnswered: true, text: 'A late answer.', usage } }
  })
  on('process.spawn', async function* (_, e) {
    if (isSay(e.argv)) {
      said.push(e.argv[4] ?? '')
      yield KOKORO_SPOKE
    } else {
      rounds += 1
      yield {
        stream: 'stdout' as const,
        text: rounds === 1 ? 'listening\npartial: explain this\nfinal: explain this\n' : 'error: done for this test\n',
      }
    }

    return { value: { code: 0, signal: null } }
  })

  await $.command.run({ command: 'open-jarvis-talk', args: '' })
  await clock.advance(ARMED)
  const voice = await $.ui.mount({ ...VOICE, surface: 'desktop' })
  expect((await voice.find({ type: 'Text', text: /tap to stop/ }))?.text).toBeDefined()
  await voice.press({ key: 'tap-orb' })
  for (let wait = 0; wait < 50 && rounds < 2; wait++) await Promise.resolve()
  expect(rounds).toBe(2)
  releaseAnswer()
  for (let wait = 0; wait < 50; wait++) await Promise.resolve()
  await voice.unmount()

  expect(said).toEqual([])
  const after = await $.ui.mount({ ...VOICE, surface: 'desktop' })
  expect((await after.find({ type: 'Text', text: /Stopped\. Listening again\./ }))?.text).toBeDefined()
  expect(await after.find({ type: 'Text', text: /A late answer/ })).toBeUndefined()
  await after.unmount()
})

/** Listening with words heard and the tap armed; the final arrives on release; the model never answers. */
async function armedListening($: Parameters<Parameters<typeof test>[1]>[0], on: Parameters<Parameters<typeof test>[1]>[1]) {
  const clock = mock.clock(on)
  let rounds = 0
  let releaseFinal = () => {}
  const finalGate = new Promise<void>(resolve => {
    releaseFinal = resolve
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', runReady)
  on('model.fork', async () => {
    await new Promise<void>(() => {})

    return { value: { isAnswered: true, text: 'never', usage } }
  })
  on('process.spawn', async function* (_, e) {
    if (isSay(e.argv)) {
      yield KOKORO_SPOKE
    } else {
      rounds += 1
      if (rounds === 1) {
        yield { stream: 'stdout' as const, text: 'pid: 4242\nlistening\npartial: explain this\n' }
        await finalGate
        yield { stream: 'stdout' as const, text: 'final: explain this\n' }
      } else {
        yield { stream: 'stdout' as const, text: 'error: done for this test\n' }
      }
    }

    return { value: { code: 0, signal: null } }
  })

  await $.command.run({ command: 'open-jarvis-talk', args: '' })
  await clock.advance(ARMED)
  const voice = await $.ui.mount({ ...VOICE, surface: 'desktop' })
  expect((await voice.find({ type: 'Text', text: /tap to send now/ }))?.text).toBeDefined()
  releaseFinal()
  for (let wait = 0; wait < 200; wait++) await Promise.resolve()
  expect(await voice.find({ type: 'Text', text: /^Thinking…$/ })).toBeDefined()

  return { clock, voice, rounds: () => rounds }
}

test('when listening was armed and Jarvis starts thinking, the tap should wait until thinking has held', async ($, on) => {
  const { clock, voice } = await armedListening($, on)

  expect(await voice.find({ type: 'Button', key: 'tap-orb' })).toBeUndefined()
  expect(await voice.find({ type: 'Text', text: /tap to stop/ })).toBeUndefined()
  await clock.advance(ARMED)
  expect(await voice.find({ type: 'Text', text: /tap to stop/ })).toBeDefined()
  expect(await voice.find({ type: 'Text', text: /Stopped\. Listening again\./ })).toBeUndefined()
  await voice.unmount()
})

test('when two taps land at the same moment while thinking, it should stop once and listen again once', async ($, on) => {
  const { clock, voice, rounds } = await armedListening($, on)
  await clock.advance(ARMED)
  expect(await voice.find({ type: 'Text', text: /tap to stop/ })).toBeDefined()

  await Promise.all([voice.press({ key: 'tap-orb' }), voice.press({ key: 'tap-orb' })])
  for (let wait = 0; wait < 200; wait++) await Promise.resolve()

  expect(await voice.findAll({ type: 'Text', text: /Stopped\. Listening again\./ })).toHaveLength(1)
  expect(rounds()).toBe(2)
  await voice.unmount()
})

test('when the orb itself is pressed while thinking, it should stop as the words under it do', async ($, on) => {
  const { clock, voice, rounds } = await armedListening($, on)
  expect(await voice.find({ type: 'Button', key: 'tap-orb-area' })).toBeUndefined()
  await clock.advance(ARMED)
  // One blank Button over the orb: no label, one short line (the desktop joins
  // lines and cuts a long one with "…").
  const layer = (await voice.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('tap-orb-area'))
  expect(layer).toHaveLength(1)
  expect(String(layer[0]?.props.label ?? '').trim()).toBe('')
  expect(layer[0]?.text.trim()).toBe('')
  expect(layer[0]?.text).not.toContain('\n')

  await voice.press({ key: 'tap-orb-area' })
  for (let wait = 0; wait < 200; wait++) await Promise.resolve()

  expect(await voice.findAll({ type: 'Text', text: /Stopped\. Listening again\./ })).toHaveLength(1)
  expect(rounds()).toBe(2)
  await voice.unmount()
})

test('when the orb and the words under it are pressed together, it should count once', async ($, on) => {
  const { clock, voice, rounds } = await armedListening($, on)
  await clock.advance(ARMED)

  await Promise.all([voice.press({ key: 'tap-orb-area' }), voice.press({ key: 'tap-orb' })])
  for (let wait = 0; wait < 200; wait++) await Promise.resolve()

  expect(await voice.findAll({ type: 'Text', text: /Stopped\. Listening again\./ })).toHaveLength(1)
  expect(rounds()).toBe(2)
  await voice.unmount()
})

test('settings: ⚙ opens them, the conversation pauses; saved choices reach voice, listening and answers', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const listens: (readonly string[])[] = []
  const speaks: (readonly string[])[] = []
  const asked: string[] = []
  let releaseFirst = () => {}
  const firstListenerKilled = new Promise<void>(resolve => {
    releaseFirst = resolve
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', (_, e) => {
    if (isSetup(e.argv)) return checked()
    if (e.argv[0] === '/bin/kill') releaseFirst()

    return RAN
  })
  on('model.fork', (_, e) => {
    asked.push(e.prompt)

    return { value: { isAnswered: true, text: 'Sure.', usage } }
  })
  on('process.spawn', async function* (_, e) {
    if (isSay(e.argv)) {
      speaks.push(e.argv)
      yield KOKORO_SPOKE
    } else {
      listens.push(e.argv)
      if (listens.length === 1) {
        yield { stream: 'stdout' as const, text: 'pid: 5151\nlistening\n' }
        await firstListenerKilled
      } else if (listens.length === 2) {
        yield { stream: 'stdout' as const, text: 'listening\npartial: hello\nfinal: hello\n' }
      } else {
        yield { stream: 'stdout' as const, text: 'error: done for this test\n' }
      }
    }

    return { value: { code: 0, signal: null } }
  })

  await $.command.run({ command: 'open-jarvis-talk', args: '' })
  for (let wait = 0; wait < 400 && listens.length < 1; wait++) await Promise.resolve()
  expect(listens[0]?.slice(4)).toEqual(['en-US', '3'])

  const voice = await $.ui.mount({ ...VOICE, surface: 'desktop' })
  await voice.press({ key: 'open-settings' })
  expect((await voice.find({ type: 'Text', text: /^Settings$/ }))?.text).toBe('Settings')
  await voice.input({ key: 'settings-instructions', text: 'Answer in simple words.', kind: 'change' })
  await voice.select({ key: 'settings-voice', value: 'am_michael' })
  await voice.select({ key: 'settings-speed', value: '1.25' })
  await voice.select({ key: 'settings-locale', value: 'en-GB' })
  await voice.select({ key: 'settings-pause', value: '2' })

  await voice.press({ key: 'settings-test' })
  expect(speaks[0]?.[4]).toContain("Hi, I'm Michael")
  expect(speaks[0]?.slice(5, 7)).toEqual(['am_michael', '1.25'])

  await voice.press({ key: 'settings-save' })
  for (let wait = 0; wait < 400 && listens.length < 3; wait++) await Promise.resolve()
  await voice.unmount()

  expect(listens[1]?.slice(4)).toEqual(['en-GB', '2'])
  expect(asked[0]).toContain('Answer in simple words.')
  expect(speaks[1]?.[4]).toBe('Sure.')
  expect(speaks[1]?.slice(5, 7)).toEqual(['am_michael', '1.25'])
})

test('settings: research off, text-only replies, and the Mac voice at the chosen speed', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const speaks: (readonly string[])[] = []
  const asked: string[] = []
  let rounds = 0
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', runReady)
  on('model.fork', (_, e) => {
    asked.push(e.prompt)

    return { value: { isAnswered: true, text: 'Done.', usage } }
  })
  on('process.spawn', async function* (_, e) {
    if (isSay(e.argv)) {
      speaks.push(e.argv)
      yield { stream: 'stdout' as const, text: 'pid: 9004\n' }
    } else {
      rounds += 1
      yield {
        stream: 'stdout' as const,
        text: rounds === 1 ? 'listening\npartial: hi\nfinal: hi\n' : 'error: done for this test\n',
      }
    }

    return { value: { code: 0, signal: null } }
  })

  await $.command.run({ command: 'open-jarvis-talk-chat', args: '' })
  const voice = await $.ui.mount({ ...VOICE, surface: 'desktop' })
  await voice.press({ key: 'open-settings' })
  await voice.select({ key: 'settings-engine', value: 'mac' })
  expect(await voice.find({ type: 'Select', key: 'settings-voice' })).toBeUndefined()
  await voice.select({ key: 'settings-speed', value: '1.25' })
  await voice.select({ key: 'settings-research', value: 'off' })
  await voice.press({ key: 'settings-test' })
  expect(isMacSay(speaks[0] ?? [])).toBe(true)
  expect(speaks[0]?.[6]).toBe('219')
  await voice.select({ key: 'settings-speak', value: 'off' })
  await voice.press({ key: 'settings-save' })
  await voice.unmount()

  await $.command.run({ command: 'open-jarvis-talk', args: '' })
  await clock.settle()
  expect(asked[0]).toContain('Web research is turned off')
  expect(asked[0]).not.toContain('<research>')
  expect(speaks.length).toBe(1) // only the test; replies are text only
})

test('the 🎙️ stays in the footer while talking, and brings the conversation back', async ($, on) => {
  mock.clock(on)
  const opened: string[] = []
  let releaseListener = () => {}
  const listenerExits = new Promise<void>(resolve => {
    releaseListener = resolve
  })
  on('ui.open', (_, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('process.run', (_, e) => {
    if (isSetup(e.argv)) return checked()
    if (e.argv[0] === '/bin/kill') releaseListener()

    return RAN
  })
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: 'pid: 4343\nlistening\n' }
    await listenerExits

    return { value: { code: 0, signal: null } }
  })

  await $.command.run({ command: 'open-jarvis-talk', args: '' })
  const footer = await $.ui.mount({ ...FOOTER, surface: 'desktop', props: { modes: ['Auto'] } })
  expect((await footer.find({ type: 'Button', key: 'talk-jarvis' }))?.props.label).toBe('🎙️')
  const before = opened.length
  await footer.press({ key: 'talk-jarvis' })
  expect(opened.slice(before)).toEqual(['jarvis-voice'])
  await footer.unmount()

  const voice = await $.ui.mount({ ...VOICE, surface: 'desktop' })
  await voice.press({ key: 'end' })
  await voice.unmount()
})
