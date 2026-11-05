# Jarvis for Claude Code

Talk to your Claude Code session out loud. Press the 🎙️ under the message box and a conversation screen opens. Ask Jarvis what the session is doing, why, or what to do next, and it answers in a natural voice. When you say something like "let's add tests", Jarvis drafts a message for the session. Nothing reaches the session until you approve it, by saying "send it" or pressing **Send to session**.

- **Knows the session.** Jarvis reads the conversation you're in, so it can answer questions about it.
- **Hands-free.** It listens, answers, and listens again. A pause doesn't cut you off. Say "goodbye", or press **End conversation**, to stop.
- **Natural voice, on your Mac.** Replies are spoken by [Kokoro](https://github.com/thewh1teagle/kokoro-onnx), a text-to-speech model that runs locally. If it isn't installed, Jarvis uses the built-in Mac voice.
- **On-device speech recognition.** Jarvis uses macOS speech recognition.
- **Web research when needed.** For questions that need the web, Jarvis runs a separate `claude -p` search and answers from what it finds.
- **You approve every command.** Drafts appear on screen with **Send to session** and **Discard** buttons.

## Requirements

- macOS 13 or later.
- Claude Code: the desktop app or the terminal.
- Dictation turned on, in System Settings > Keyboard > Dictation. macOS speech recognition needs it.
- The first setup needs the Xcode Command Line Tools to build the small speech listener. Setup offers to install them.
- The natural voice needs an Apple Silicon Mac with 8 GB of memory and about 600 MB of disk space. On other Macs, Jarvis uses the built-in Mac voice.

## Install

At the prompt of a terminal Claude Code session:

```
/plugin install jarvis --marketplace omegasoft7/claude-jarvis
```

Answer `y` to add the marketplace, then choose a scope. Use the user scope to have Jarvis in every session.

From a shell:

```bash
claude plugin install jarvis --marketplace omegasoft7/claude-jarvis
```

In the Claude desktop app, where `/plugin` doesn't run:
1. Click **+** next to the prompt box, then **Plugins**.
2. Click **Add marketplace** and enter `omegasoft7/claude-jarvis`.
3. Click **Add plugin**.


## First use: guided setup

The first time you press 🎙️, Jarvis opens a setup screen. Nothing is installed until you press **Install**. The screen:

1. **Checks your Mac:** macOS version, processor, memory, free space, the Xcode Command Line Tools, and Dictation.
2. **Lists what it will install, and how big each part is:**

   | Part | Size | Source |
   | --- | --- | --- |
   | Speech listener | about 1 MB | Built on your Mac from [`voice/listen.swift`](voice/listen.swift) |
   | Natural voice (optional) | about 560 MB on disk, about 400 MB download | Python 3.12, the Kokoro voice engine and its voice model, from PyPI and GitHub; downloads are checked against pinned checksums |
   | uv (only if you don't have it) | about 45 MB | [astral-sh/uv](https://github.com/astral-sh/uv) on GitHub, checked against a pinned checksum |

   Press **Skip natural voice** to install only the speech listener, about 1 MB.
3. **Installs on Install.** Progress shows on the setup screen. When it finishes, press **Start talking**.

Everything is installed into `~/.claude/jarvis`. Nothing else on your Mac changes. The first time you talk, macOS asks you to allow the microphone and speech recognition.

You can also run the setup from a terminal:

```bash
setup/jarvis-setup.sh check
setup/jarvis-setup.sh install              # add --no-voice to skip the natural voice
```

## Using it

- **🎙️ in the footer under the message box** starts a conversation. The microphone icon is hidden while a conversation is running.
- **Interrupt** stops Jarvis mid-sentence. **Pause** stops listening, and **Resume** starts again. **End conversation** closes the screen.
- Saying **"send it"** sends the drafted command, and **"discard"** drops it. Saying **"goodbye"** or **"stop"** ends the conversation.
- The whole conversation stays on the screen, so you can scroll back through it.
- `/jarvis-talk` starts a conversation. `/jarvis` opens a typed side chat about the session.

## Changing the voice

The default voice is `af_heart`. To use another voice, write its name to `~/.claude/jarvis/voice`:

```bash
echo bm_george > ~/.claude/jarvis/voice
```

Jarvis's next answer uses the new voice. Delete the file to go back to the default.

The voices are:
- American: `af_heart`, `af_bella`, `af_nicole`, `af_sarah`, `af_sky`, `am_michael`, `am_adam`, `am_eric`, `am_liam`, `am_onyx` and more.
- British: `bf_emma`, `bf_isabella`, `bf_alice`, `bf_lily`, `bm_george`, `bm_fable`, `bm_daniel`, `bm_lewis`.

## Privacy

- **Speech recognition** uses macOS speech recognition, which runs on your Mac when it can.
- **The voice** runs on your Mac.
- **Your questions** go to Claude through your Claude Code session, the same way your messages to Claude do.
- **Web research** uses a separate `claude -p` run that can only search and fetch web pages.

## Remove

1. Uninstall the plugin:
   ```bash
   claude plugin uninstall jarvis
   ```
2. Delete the voice files:
   ```bash
   rm -rf ~/.claude/jarvis
   ```

## Troubleshooting

Jarvis writes logs to `~/.claude/jarvis/`:
- `jarvis.log` records what Jarvis did, including why it switched to the Mac voice.
- `listen.log` comes from the speech listener.
- `setup.log` and `build.log` come from setup.

Common problems:
- **"macOS Dictation is turned off"**: turn it on in System Settings > Keyboard > Dictation, then press **Resume**.
- **Listening stops at once**: check that Claude is allowed to use the microphone, in System Settings > Privacy & Security > Microphone.
- **Research fails**: run `claude` in a terminal once, and sign in if it asks.

## Development

```bash
claude plugin validate .
claude plugin test .
```

The plugin is a Claude Code hooks module:
- [`hooks/register.tsx`](hooks/register.tsx) is the mod.
- [`voice/`](voice) holds the listener and voice programs.
- [`setup/jarvis-setup.sh`](setup/jarvis-setup.sh) is the installer.

## License

MIT, see [LICENSE](LICENSE). The natural voice uses kokoro-onnx (MIT) and the Kokoro-82M model (Apache 2.0), downloaded from their authors at setup and not part of this repository. This project is not affiliated with Anthropic or with OpenJarvis.
