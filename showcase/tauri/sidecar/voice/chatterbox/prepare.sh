#!/bin/bash
# Assembles everything the built-in voice needs into this folder, so build.sh can put it in the app:
#   runtime/        a relocatable Python 3.11 (python-build-standalone, as uv downloads it)
#   site-packages/  mlx-audio and its dependencies, from the dev venv
#   models/         Chatterbox 4-bit (English), Chatterbox Bangla 8-bit, and the S3 tokenizer (the weights)
# The Bangla fine-tune must stay 8-bit: 4-bit makes it speak gibberish (verified against the model author's audio).
# The clips in voices/ are already part of the source tree (11s references taken from the five supplied voice
# recordings). Run once, then ./build.sh.
# Override with ROAMIES_VOICE_ROOT (dev venv + models, ~/Library/Application Support/RoamiesVoice by default) and
# ROAMIES_VOICE_PY (a CPython prefix, ~/.local/share/uv/python/cpython-3.11-* by default).
set -euo pipefail
cd "$(dirname "$0")"

ROOT="${ROAMIES_VOICE_ROOT:-$HOME/Library/Application Support/RoamiesVoice}"
VENV="$ROOT/.venv"
MODELS="$ROOT/models"
PYSRC="${ROAMIES_VOICE_PY:-}"
[ -n "$PYSRC" ] || PYSRC="$(ls -d "$HOME/.local/share/uv/python/cpython-3.11."* 2>/dev/null | tail -1)"

[ -x "$VENV/bin/python" ] || { echo "prepare: no dev venv at $VENV (make one: uv venv --python 3.11 .venv && uv pip install mlx-audio)" >&2; exit 1; }
[ -d "$MODELS/chatterbox-4bit" ] || { echo "prepare: no weights at $MODELS/chatterbox-4bit" >&2; exit 1; }
[ -d "$MODELS/chatterbox-bangla" ] || { echo "prepare: no Bangla weights at $MODELS/chatterbox-bangla" >&2; exit 1; }
[ -x "$PYSRC/bin/python3.11" ] || { echo "prepare: no Python 3.11 at $PYSRC" >&2; exit 1; }

# cp -c clones files on APFS (instant, no extra space); elsewhere it's a plain copy.
clone() { cp -Rc "$1" "$2" 2>/dev/null || cp -R "$1" "$2"; }

echo "prepare: python runtime"
rm -rf runtime && mkdir -p runtime
clone "$PYSRC/." runtime/
# The runtime's own bin/python3.11 is what the sidecar runs; the venv's entry points are of no use inside the app.
rm -rf runtime/lib/python3.11/test runtime/lib/python3.11/idlelib runtime/lib/python3.11/tkinter runtime/lib/python3.11/turtledemo

echo "prepare: site-packages"
rm -rf site-packages && mkdir -p site-packages
for p in "$VENV"/lib/python3.11/site-packages/*; do
  name="$(basename "$p")"
  case "$name" in
    __pycache__) continue ;;
  esac
  clone "$p" site-packages/"$name"
done
# Tests and type stubs are ship weight only.
rm -rf site-packages/*/tests site-packages/*/*/tests site-packages/*/*-stubs site-packages/bin 2>/dev/null || true

# Bytecode compiled now, not on the first reply: a cold import of mlx_audio otherwise costs seconds.
echo "prepare: bytecode"
PYTHONPATH="$PWD/site-packages" ./runtime/bin/python3.11 -m compileall -q -f site-packages >/dev/null 2>&1 || true

echo "prepare: weights"
rm -rf models && mkdir -p models
clone "$MODELS/chatterbox-4bit" models/chatterbox-4bit
clone "$MODELS/chatterbox-bangla" models/chatterbox-bangla
clone "$MODELS/s3tokenizer" models/s3tokenizer

echo "prepare: check"
PYTHONPATH="$PWD/site-packages" PYTHONDONTWRITEBYTECODE=1 HF_HUB_OFFLINE=1 \
  ./runtime/bin/python3.11 -c "import mlx.core, mlx_audio; print('mlx', mlx.core.__version__ if hasattr(mlx.core,'__version__') else 'ok')"
du -sh runtime site-packages models
echo "prepare: done"
