#!/bin/bash
# Jarvis setup: checks this Mac and installs what Jarvis's voice needs.
#
#   jarvis-setup.sh check                 what this Mac has, as key=value lines
#   jarvis-setup.sh install [--no-voice]  install (the natural voice included
#                                         unless --no-voice)
#   jarvis-setup.sh tools                 ask macOS to install the Xcode
#                                         Command Line Tools (Apple's dialog)
#   jarvis-setup.sh dictation             open System Settings at Dictation
#
# Everything goes into ~/.claude/jarvis (or $JARVIS_HOME); nothing outside it
# is changed. Install prints `step: …`, `ok: …`, `warn: …`, then `done`, or
# `error: …` and a non-zero exit.
#
# To remove Jarvis's voice files later:  rm -rf ~/.claude/jarvis

set -u

SETUP_VERSION=1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
J="${JARVIS_HOME:-$HOME/.claude/jarvis}"

UV_VERSION=0.12.18
UV_SHA_ARM64=cf40e0c6a202190ccd9e0406dcfdd5b2d6668a9a5c779b17948963df32aafe5b
UV_SHA_X86=2e4108f5395397c8bc5d43bf83d3bdbb2d0e92b90d0efa607756be704905fa33

MODELS_URL=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
MODEL_SHA=7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5
MODEL_BYTES=325532387
VOICES_SHA=bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d
VOICES_BYTES=28214398

# Disk and download estimates, in MB, measured on an Apple Silicon Mac.
LISTENER_MB=1
VOICE_DISK_MB=560 # Python 3.12 ~75, voice engine ~135, voice model ~350
VOICE_DOWNLOAD_MB=400
UV_MB=45
SPARE_MB=500

listener_hash() {
  cat "$ROOT/voice/listen.swift" "$ROOT/voice/Info.plist" | shasum -a 256 | cut -d' ' -f1
}

find_uv() {
  local candidate
  for candidate in "$J/tools/uv" "$(command -v uv 2>/dev/null)" /opt/homebrew/bin/uv \
    /usr/local/bin/uv "$HOME/.local/bin/uv" "$HOME/.cargo/bin/uv"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

has_tools() {
  xcode-select -p >/dev/null 2>&1 && xcrun --find swiftc >/dev/null 2>&1
}

file_bytes() {
  stat -f %z "$1" 2>/dev/null || echo 0
}

voice_state() {
  if [ -x "$J/kokoro/bin/python" ] && [ -f "$J/speak.py" ] &&
    [ "$(file_bytes "$J/kokoro-models/kokoro-v1.0.onnx")" = "$MODEL_BYTES" ] &&
    [ "$(file_bytes "$J/kokoro-models/voices-v1.0.bin")" = "$VOICES_BYTES" ]; then
    echo ready
  else
    echo missing
  fi
}

listener_state() {
  if [ ! -x "$J/jarvis-listen" ]; then
    echo missing
  elif [ "$(cat "$J/jarvis-listen.sha256" 2>/dev/null)" != "$(listener_hash)" ]; then
    echo outdated
  else
    echo ready
  fi
}

check() {
  local macos major arch ram free tools uv dictation listener voice supported why need download ready
  macos="$(sw_vers -productVersion 2>/dev/null || echo unknown)"
  major="${macos%%.*}"
  arch="$(uname -m)"
  ram=$(($(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1073741824))
  free="$(df -Pk "$HOME" | awk 'NR==2 { print int($4 / 1024) }')"
  tools=no
  has_tools && tools=yes
  uv="$(find_uv || echo none)"
  case "$(defaults read com.apple.assistant.support "Dictation Enabled" 2>/dev/null)" in
  1) dictation=on ;;
  0) dictation=off ;;
  *) dictation=unknown ;;
  esac
  listener="$(listener_state)"
  voice="$(voice_state)"

  supported=yes
  why=""
  if [ "$arch" != arm64 ]; then
    supported=no
    why="the natural voice needs an Apple Silicon Mac"
  elif [ "$ram" -lt 8 ]; then
    supported=no
    why="the natural voice needs 8 GB of memory"
  fi

  need=0
  download=0
  [ "$listener" != ready ] && need=$((need + LISTENER_MB))
  if [ "$voice" != ready ] && [ "$supported" = yes ]; then
    need=$((need + VOICE_DISK_MB))
    download=$((download + VOICE_DOWNLOAD_MB))
    if [ "$uv" = none ]; then
      need=$((need + UV_MB))
      download=$((download + UV_MB))
    fi
  fi

  ready=no
  [ "$listener" = ready ] && [ "$(cat "$J/setup-version" 2>/dev/null)" = "$SETUP_VERSION" ] && ready=yes

  echo "macos=$macos"
  echo "macos_ok=$([ "${major:-0}" -ge 13 ] 2>/dev/null && echo yes || echo no)"
  echo "arch=$arch"
  echo "ram_gb=$ram"
  echo "free_mb=$free"
  echo "spare_mb=$SPARE_MB"
  echo "tools=$tools"
  echo "uv=$uv"
  echo "dictation=$dictation"
  echo "listener=$listener"
  echo "voice=$voice"
  echo "voice_supported=$supported"
  echo "voice_why=$why"
  echo "need_mb=$need"
  echo "download_mb=$download"
  echo "voice_disk_mb=$VOICE_DISK_MB"
  echo "voice_download_mb=$VOICE_DOWNLOAD_MB"
  echo "ready=$ready"
}

fail() {
  echo "error: $*"
  exit 1
}

# Downloads $1 to $2, checking its sha256 is $3.
fetch() {
  local url="$1" target="$2" sha="$3" got
  rm -f "$target.part"
  curl -fL --retry 3 --silent --show-error -o "$target.part" "$url" || return 1
  got="$(shasum -a 256 "$target.part" | cut -d' ' -f1)"
  if [ "$got" != "$sha" ]; then
    rm -f "$target.part"
    echo "warn: checksum mismatch for $url"
    return 1
  fi
  mv -f "$target.part" "$target"
}

install_listener() {
  if [ "$(listener_state)" = ready ]; then
    echo "ok: Speech listener already installed"
    return 0
  fi
  echo "step: Building the speech listener"
  has_tools || fail "the Xcode Command Line Tools are needed to build the speech listener. Install them, then try again."
  xcrun swiftc -O -swift-version 5 "$ROOT/voice/listen.swift" -o "$J/jarvis-listen.new" \
    -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker "$ROOT/voice/Info.plist" \
    >"$J/build.log" 2>&1 || fail "the speech listener did not build (details in $J/build.log)"
  mv -f "$J/jarvis-listen.new" "$J/jarvis-listen"
  listener_hash >"$J/jarvis-listen.sha256"
  echo "ok: Speech listener built"
}

get_uv() {
  local uv arch sha
  if [ "${JARVIS_FORCE_UV_DOWNLOAD:-}" != 1 ] && uv="$(find_uv)"; then
    echo "$uv"
    return 0
  fi
  case "$(uname -m)" in
  arm64)
    arch=aarch64
    sha=$UV_SHA_ARM64
    ;;
  *)
    arch=x86_64
    sha=$UV_SHA_X86
    ;;
  esac
  echo "step: Downloading uv $UV_VERSION (Python installer, from github.com/astral-sh/uv)" >&2
  mkdir -p "$J/tools"
  fetch "https://github.com/astral-sh/uv/releases/download/$UV_VERSION/uv-$arch-apple-darwin.tar.gz" \
    "$J/tools/uv.tar.gz" "$sha" >&2 || return 1
  tar -xzf "$J/tools/uv.tar.gz" -C "$J/tools" --strip-components 1 || return 1
  rm -f "$J/tools/uv.tar.gz"
  echo "$J/tools/uv"
}

voice_works() {
  "$J/kokoro/bin/python" -I -c "import kokoro_onnx, sounddevice" >/dev/null 2>&1
}

install_voice() {
  local uv
  if [ "$(voice_state)" = ready ] && voice_works; then
    cp -f "$ROOT/voice/speak.py" "$J/speak.py"
    echo "ok: Natural voice already installed"
    return 0
  fi
  [ "$(uname -m)" = arm64 ] || fail "the natural voice needs an Apple Silicon Mac"

  uv="$(get_uv)" || fail "could not download uv"
  echo "ok: Using uv at $uv"

  export UV_CACHE_DIR="$J/.uv-cache"
  export UV_PYTHON_INSTALL_DIR="$J/python"
  if [ -x "$J/kokoro/bin/python" ] && "$J/kokoro/bin/python" -V >/dev/null 2>&1; then
    echo "ok: Python environment already there"
  else
    echo "step: Setting up Python 3.12 (about 20 MB download)"
    rm -rf "$J/kokoro"
    "$uv" venv --quiet --python 3.12 --python-preference only-managed "$J/kokoro" >>"$J/setup.log" 2>&1 ||
      fail "could not set up Python (details in $J/setup.log)"
  fi

  echo "step: Installing the voice engine (Kokoro, about 30 MB download)"
  "$uv" pip install --quiet --python "$J/kokoro/bin/python" -r "$ROOT/voice/requirements.txt" >>"$J/setup.log" 2>&1 ||
    fail "could not install the voice engine (details in $J/setup.log)"
  rm -rf "$UV_CACHE_DIR"

  mkdir -p "$J/kokoro-models"
  if [ "$(file_bytes "$J/kokoro-models/kokoro-v1.0.onnx")" != "$MODEL_BYTES" ]; then
    echo "step: Downloading the voice model (325 MB, from github.com/thewh1teagle/kokoro-onnx)"
    fetch "$MODELS_URL/kokoro-v1.0.onnx" "$J/kokoro-models/kokoro-v1.0.onnx" "$MODEL_SHA" ||
      fail "could not download the voice model"
  fi
  if [ "$(file_bytes "$J/kokoro-models/voices-v1.0.bin")" != "$VOICES_BYTES" ]; then
    echo "step: Downloading the voices (28 MB)"
    fetch "$MODELS_URL/voices-v1.0.bin" "$J/kokoro-models/voices-v1.0.bin" "$VOICES_SHA" ||
      fail "could not download the voices"
  fi
  cp -f "$ROOT/voice/speak.py" "$J/speak.py"

  echo "step: Checking the natural voice"
  voice_works || fail "the voice engine was installed but does not start (details in $J/setup.log)"
  echo "ok: Natural voice installed"
}

install() {
  local with_voice=yes
  [ "${1:-}" = --no-voice ] && with_voice=no
  mkdir -p "$J" || fail "could not create $J"
  echo "step: Checking this Mac"
  local major
  major="$(sw_vers -productVersion | cut -d. -f1)"
  [ "$major" -ge 13 ] || fail "Jarvis needs macOS 13 or later"

  install_listener
  if [ "$with_voice" = yes ]; then
    install_voice
  else
    echo "ok: Skipped the natural voice: Jarvis will use the built-in Mac voice"
  fi
  echo "$SETUP_VERSION" >"$J/setup-version"
  echo "done"
}

case "${1:-}" in
check) check ;;
install)
  shift
  install "$@"
  ;;
tools)
  xcode-select --install 2>&1 || true
  echo "done"
  ;;
dictation)
  open "x-apple.systempreferences:com.apple.Keyboard-Settings.extension" 2>&1 || true
  echo "done"
  ;;
*)
  echo "usage: jarvis-setup.sh check | install [--no-voice] | tools | dictation" >&2
  exit 2
  ;;
esac
