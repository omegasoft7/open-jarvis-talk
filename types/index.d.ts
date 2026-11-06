export type ChatEntry = { role: 'you' | 'jarvis' | 'note'; text: string; isVoice?: boolean }

export type TalkState = 'off' | 'listening' | 'thinking' | 'speaking' | 'paused'

/** One line of the computer check on the setup screen. */
export type SetupCheck = { label: string; isOk: boolean; detail: string }

/** What `jarvis-setup.sh check` found, and where the setup screen stands. */
export type Setup = {
  phase: 'checking' | 'review' | 'installing' | 'failed' | 'done'
  checks: SetupCheck[]
  /** Why this Mac cannot run Jarvis at all; '' when it can. */
  blocker: string
  needsTools: boolean
  dictation: 'on' | 'off' | 'unknown'
  isVoiceInstalled: boolean
  isVoiceSupported: boolean
  voiceWhy: string
  needsUv: boolean
  needsListener: boolean
  withVoice: boolean
  voiceDiskMb: number
  voiceDownloadMb: number
  uvMb: number
  /** Progress lines while installing. */
  steps: string[]
  error: string
}

export type ReplyStyle = 'brief' | 'normal' | 'detailed' | 'simple'

/** What the person chose on the settings screen; kept across sessions. */
export type JarvisSettings = {
  /** The person's own standing instructions for Jarvis's answers. */
  instructions: string
  replyStyle: ReplyStyle
  /** 'natural' is Kokoro; 'mac' is the built-in Mac voice (`say`). */
  engine: 'natural' | 'mac'
  /** A Kokoro voice id, such as af_heart. */
  voice: string
  /** Speech speed, as text: '0.8' to '1.5'. */
  speed: string
  /** The listening language, an Apple locale such as en-US. */
  locale: string
  /** Seconds of silence that end what you say, as text. */
  pause: string
  research: boolean
  speakReplies: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'open-jarvis-talk': {
      chat: Shaped<ChatEntry[]>
      draft: string | null
      busy: string | null
      field: number
      isOpen: boolean
      talk: TalkState
      heard: string
      tapArmed: boolean
      setup: Setup | null
      settings: JarvisSettings
      settingsDraft: JarvisSettings | null
    }
  }
}
