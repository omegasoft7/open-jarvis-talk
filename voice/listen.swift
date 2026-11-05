// jarvis-listen: listens on the default microphone with macOS speech
// recognition (on-device when available) and prints, one per line:
//   listening | partial: <text> | final: <text> | error: <why>
// It stops on its own after a pause in speech, or when killed.
import AVFoundation
import Foundation
import Speech

setvbuf(stdout, nil, _IOLBF, 0)
func log(_ line: String) {
  let stamp = ISO8601DateFormatter().string(from: Date())
  FileHandle.standardError.write("\(stamp) [\(getpid())] \(line)\n".data(using: .utf8)!)
}
func out(_ line: String) { print(line); fflush(stdout); if !line.hasPrefix("partial: ") { log("out: \(line)") } }

// macOS asks the *responsible* process for privacy permissions: launched by
// the Claude Code engine, that is the engine, which declares no microphone use,
// and TCC kills us. So relaunch ourselves disclaimed: we become our own
// responsible process and our embedded Info.plist is what macOS reads.
@_silgen_name("responsibility_spawnattrs_setdisclaim")
func responsibility_spawnattrs_setdisclaim(_ attrs: UnsafeMutablePointer<posix_spawnattr_t?>, _ disclaim: Int32) -> Int32

var childPid: pid_t = 0
if !CommandLine.arguments.contains("--disclaimed") {
  var size: UInt32 = 4096
  var buffer = [CChar](repeating: 0, count: Int(size))
  _NSGetExecutablePath(&buffer, &size)
  let path = String(cString: buffer)
  var attr: posix_spawnattr_t?
  posix_spawnattr_init(&attr)
  _ = responsibility_spawnattrs_setdisclaim(&attr, 1)
  let argv = [path] + CommandLine.arguments.dropFirst() + ["--disclaimed", "--parent", String(getpid())]
  var cargs: [UnsafeMutablePointer<CChar>?] = argv.map { strdup($0) }
  cargs.append(nil)
  print("pid: \(getpid())"); fflush(stdout)
  let rc = posix_spawn(&childPid, path, nil, &attr, cargs, environ)
  if rc != 0 {
    print("error: could not start the listener (\(rc))")
    exit(6)
  }
  let forward: @convention(c) (Int32) -> Void = { sig in
    if childPid > 0 { kill(childPid, SIGTERM) }
    exit(0)
  }
  signal(SIGTERM, forward)
  signal(SIGINT, forward)
  signal(SIGHUP, forward)
  var status: Int32 = 0
  while waitpid(childPid, &status, 0) == -1 && errno == EINTR {}
  let code = (status & 0x7f) == 0 ? (status >> 8) & 0xff : 128 + (status & 0x7f)
  exit(code)
}

let args = CommandLine.arguments
func option(_ name: String) -> String? {
  guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
  return args[i + 1]
}

if args.contains("--status") {
  out("speech:\(SFSpeechRecognizer.authorizationStatus().rawValue) mic:\(AVCaptureDevice.authorizationStatus(for: .audio).rawValue)")
  exit(0)
}

let locale = Locale(identifier: option("--locale") ?? "en-US")
log("start locale=\(locale.identifier) speech=\(SFSpeechRecognizer.authorizationStatus().rawValue) mic=\(AVCaptureDevice.authorizationStatus(for: .audio).rawValue)")
let pause = Double(option("--pause") ?? "") ?? 3.0
let maxSeconds = 180.0
let waitForSpeech = 20.0

let speechGate = DispatchSemaphore(value: 0)
var speechOK = false
SFSpeechRecognizer.requestAuthorization { status in speechOK = status == .authorized; speechGate.signal() }
speechGate.wait()
if !speechOK {
  out("error: Speech Recognition is not allowed for Claude (System Settings > Privacy & Security > Speech Recognition)")
  exit(2)
}

let micGate = DispatchSemaphore(value: 0)
var micOK = false
AVCaptureDevice.requestAccess(for: .audio) { ok in micOK = ok; micGate.signal() }
micGate.wait()
if !micOK {
  out("error: the microphone is not allowed for Claude (System Settings > Privacy & Security > Microphone)")
  exit(3)
}

guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
  out("error: speech recognition is not available for \(locale.identifier)")
  exit(4)
}

// Recognition runs in segments: macOS ends a segment (isFinal, or a
// "no speech" error) after a pause and starts a fresh transcript. Each ended
// segment is kept in `committed`, and a new request continues on the same
// microphone tap, so a pause never loses what was said before it.
var committed = ""
var current = ""
var changedAt = Date()
let startedAt = Date()
var isDone = false
var request = SFSpeechAudioBufferRecognitionRequest()
var task: SFSpeechRecognitionTask?
var generation = 0

func joined() -> String {
  [committed, current].filter { !$0.isEmpty }.joined(separator: " ")
}

func commitSegment() {
  if !current.isEmpty {
    committed = joined()
    current = ""
  }
}

let engine = AVAudioEngine()
let input = engine.inputNode
let tapLock = NSLock()
input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
  tapLock.lock(); let target = request; tapLock.unlock()
  target.append(buffer)
}

func finish() {
  if isDone { return }
  isDone = true
  engine.stop()
  input.removeTap(onBus: 0)
  request.endAudio()
  task?.cancel()
  out("final: \(joined())")
  exit(0)
}

func startSegment() {
  generation += 1
  let mine = generation
  let next = SFSpeechAudioBufferRecognitionRequest()
  next.shouldReportPartialResults = true
  if recognizer.supportsOnDeviceRecognition { next.requiresOnDeviceRecognition = true }
  tapLock.lock(); let previous = request; request = next; tapLock.unlock()
  previous.endAudio()
  task = recognizer.recognitionTask(with: next) { result, error in
    DispatchQueue.main.async {
      if isDone || mine != generation { return }
      if let result = result {
        let text = result.bestTranscription.formattedString
        if text != current {
          // A transcript that no longer starts like the one before is a new
          // segment the recognizer began on its own: keep the old one.
          let before = current.split(separator: " ").first.map { String($0).lowercased() }
          let now = text.split(separator: " ").first.map { String($0).lowercased() }
          if !current.isEmpty && before != now && text.count < current.count {
            log("segment reset detected, keeping \(current.count) chars")
            commitSegment()
          }
          current = text
          changedAt = Date()
          out("partial: \(joined())")
        }
        if result.isFinal {
          log("segment final")
          commitSegment()
          startSegment()
          return
        }
      }
      if let error = error {
        let ns = error as NSError
        log("recognition error \(ns.domain) \(ns.code): \(ns.localizedDescription)")
        if ns.code == 201 {
          out("error: macOS Dictation is turned off. Turn it on in System Settings > Keyboard > Dictation, then press Resume.")
          exit(7)
        }
        if [1110, 203, 216, 301, 1101].contains(ns.code) || !joined().isEmpty {
          // No speech in this segment, or it ended: carry on with a new one.
          commitSegment()
          startSegment()
          return
        }
        out("error: speech recognition failed (\(ns.code)): \(ns.localizedDescription)")
        exit(8)
      }
    }
  }
}

if let path = option("--file") {
  // Test mode: play an audio file in real time through the same recognition,
  // then silence, as a microphone would deliver it.
  input.removeTap(onBus: 0)
  guard let file = try? AVAudioFile(forReading: URL(fileURLWithPath: path)) else {
    out("error: cannot read \(path)")
    exit(9)
  }
  let format = file.processingFormat
  let chunk = AVAudioFrameCount(format.sampleRate / 10)
  Thread.detachNewThread {
    while true {
      guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: chunk) else { return }
      if file.framePosition < file.length {
        try? file.read(into: buffer, frameCount: chunk)
      } else {
        buffer.frameLength = chunk // zeros: silence
      }
      tapLock.lock(); let target = request; tapLock.unlock()
      target.append(buffer)
      Thread.sleep(forTimeInterval: 0.1)
    }
  }
  log("file test \(path) pause=\(pause)")
} else {
  engine.prepare()
  do { try engine.start() } catch {
    out("error: cannot start the microphone: \(error.localizedDescription)")
    exit(5)
  }
  log("input format \(input.outputFormat(forBus: 0)) pause=\(pause)")
}
startSegment()
out("listening")

Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { _ in
  let now = Date()
  let said = joined()
  if !said.isEmpty && now.timeIntervalSince(changedAt) > pause { finish() }
  if said.isEmpty && now.timeIntervalSince(startedAt) > waitForSpeech { finish() }
  if now.timeIntervalSince(startedAt) > maxSeconds { finish() }
}
signal(SIGTERM) { _ in log("stopped (SIGTERM)"); exit(0) }
let parentPid = pid_t(option("--parent") ?? "") ?? 0
Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
  if parentPid > 0 && kill(parentPid, 0) != 0 { log("wrapper gone, exiting"); exit(0) }
}
RunLoop.main.run()
