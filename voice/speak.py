"""Jarvis's voice: speaks text with Kokoro, a local neural text-to-speech model.

    speak.py [--voice NAME] [--speed X] -- "text to say"   speak, then exit
    speak.py --serve                                       the warm server
    speak.py --stop-server                                 stop the server

The speaking process plays the audio itself, so killing it by pid stops the
sound at once (Interrupt, Pause, End conversation). It asks a small server
that keeps the model loaded for the audio, one sentence at a time, so speech
starts quickly; when no server answers, it starts one in the background for
next time and synthesizes this reply itself.

Prints `speaking` when sound starts and `done` when it ends; on a failure,
`error: <why>` and a non-zero exit, so Jarvis can fall back to macOS `say`.

The voice is --voice, else the first line of ~/.claude/jarvis/voice, else
af_heart. The server exits after 15 idle minutes. $JARVIS_HOME moves
~/.claude/jarvis (for testing).
"""

import json
import os
import re
import socket
import struct
import subprocess
import sys
import time

HOME = os.environ.get("JARVIS_HOME") or os.path.expanduser("~/.claude/jarvis")
MODELS = os.path.join(HOME, "kokoro-models")
SOCKET = os.path.join(HOME, "kokoro.sock")
VOICE_FILE = os.path.join(HOME, "voice")
DEFAULT_VOICE = "af_heart"
RATE = 24000
IDLE_SECONDS = 15 * 60


def say(line):
    print(line, flush=True)


def sentences(text):
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return [part for part in parts if part.strip()]


def load_model():
    from kokoro_onnx import Kokoro

    return Kokoro(
        os.path.join(MODELS, "kokoro-v1.0.onnx"),
        os.path.join(MODELS, "voices-v1.0.bin"),
    )


def chosen_voice(arg):
    if arg:
        return arg
    try:
        with open(VOICE_FILE) as handle:
            name = handle.readline().strip()
            if name:
                return name
    except OSError:
        pass
    return DEFAULT_VOICE


# ---- server -----------------------------------------------------------------


def read_exact(conn, size):
    data = b""
    while len(data) < size:
        chunk = conn.recv(size - len(data))
        if not chunk:
            raise ConnectionError("closed")
        data += chunk
    return data


def serve():
    import numpy as np

    model = load_model()
    voices = set(model.get_voices())
    try:
        os.unlink(SOCKET)
    except FileNotFoundError:
        pass
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(SOCKET)
    os.chmod(SOCKET, 0o600)
    server.listen(4)
    server.settimeout(IDLE_SECONDS)
    while True:
        try:
            conn, _ = server.accept()
        except socket.timeout:
            break
        with conn:
            try:
                size = struct.unpack(">I", read_exact(conn, 4))[0]
                request = json.loads(read_exact(conn, size))
                if request.get("stop"):
                    break
                voice = request.get("voice") or DEFAULT_VOICE
                if voice not in voices:
                    message = f"unknown voice {voice}".encode()
                    conn.sendall(struct.pack(">i", -len(message)) + message)
                    continue
                for part in sentences(request["text"]):
                    audio, _ = model.create(part, voice=voice, speed=float(request.get("speed", 1.0)))
                    data = np.asarray(audio, dtype=np.float32).tobytes()
                    conn.sendall(struct.pack(">i", len(data)) + data)
                conn.sendall(struct.pack(">i", 0))
            except (ConnectionError, BrokenPipeError, OSError):
                continue  # the speaker was stopped: drop the rest of the reply
    server.close()
    try:
        os.unlink(SOCKET)
    except FileNotFoundError:
        pass


def start_server():
    subprocess.Popen(
        [sys.executable, "-I", os.path.abspath(__file__), "--serve"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=open(os.path.join(HOME, "kokoro-server.log"), "a"),
        start_new_session=True,
    )


# ---- speaking ---------------------------------------------------------------


def chunks_from_server(text, voice, speed):
    import numpy as np

    conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    conn.settimeout(30)
    conn.connect(SOCKET)
    body = json.dumps({"text": text, "voice": voice, "speed": speed}).encode()
    conn.sendall(struct.pack(">I", len(body)) + body)

    def generate():
        with conn:
            while True:
                size = struct.unpack(">i", read_exact(conn, 4))[0]
                if size == 0:
                    return
                if size < 0:
                    raise RuntimeError(read_exact(conn, -size).decode())
                yield np.frombuffer(read_exact(conn, size), dtype=np.float32)

    return generate()


def chunks_here(text, voice, speed):
    model = load_model()
    if voice not in model.get_voices():
        raise RuntimeError(f"unknown voice {voice}")
    for part in sentences(text):
        audio, _ = model.create(part, voice=voice, speed=speed)
        yield audio


def speak(text, voice, speed):
    import sounddevice as sd

    try:
        chunks = chunks_from_server(text, voice, speed)
        via = "server"
    except OSError:
        start_server()  # warm for the next reply
        chunks = chunks_here(text, voice, speed)
        via = "direct"
    started = time.time()
    with sd.OutputStream(samplerate=RATE, channels=1, dtype="float32") as stream:
        for index, audio in enumerate(chunks):
            if index == 0:
                say(f"speaking voice={voice} via={via} after={time.time() - started:.2f}s")
            stream.write(audio.reshape(-1, 1))
    say("done")


def main(argv):
    if "--serve" in argv:
        serve()
        return 0
    if "--stop-server" in argv:
        try:
            conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            conn.connect(SOCKET)
            body = b'{"stop": true}'
            conn.sendall(struct.pack(">I", len(body)) + body)
            conn.close()
        except OSError:
            pass
        return 0
    voice = None
    speed = 1.0
    text = ""
    rest = list(argv)
    while rest:
        arg = rest.pop(0)
        if arg == "--voice" and rest:
            voice = rest.pop(0)
        elif arg == "--speed" and rest:
            speed = float(rest.pop(0))
        elif arg == "--":
            text = " ".join(rest)
            break
        else:
            text = " ".join([arg] + rest)
            break
    if not text.strip():
        say("error: nothing to say")
        return 2
    try:
        speak(text, chosen_voice(voice), speed)
    except Exception as error:  # any failure: Jarvis falls back to `say`
        say(f"error: {type(error).__name__}: {error}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
