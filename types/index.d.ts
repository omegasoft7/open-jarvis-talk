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

declare module 'claude-code' {
  interface PluginState {
    jarvis: {
      chat: Shaped<ChatEntry[]>
      draft: string | null
      busy: string | null
      field: number
      isOpen: boolean
      talk: TalkState
      heard: string
      setup: Setup | null
    }
  }
}
