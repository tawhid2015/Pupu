"""Local Bengali take transcription, run by the bundled Mac Python runtime.

One short-lived process per take: load the pinned Bengali Whisper Medium once, decode the WAV the voice helper left
behind, and print one JSON line. No network, no files outside the take path, no changes to the app's Python packages.
The compatibility and chunking helpers travel next to this script; the model itself is downloaded and verified by the
sidecar before it ever gets here.
"""
import argparse
import json
import sys
import wave

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

import numpy as np

from pause_chunks import plan_chunks
from whisper_compat import apply_tokenizer_fix

try:
    from mlx_audio.stt.utils import load_model
except ImportError as exc:  # a clear error for a build that shipped without the MLX packages
    print(json.dumps({"ok": False, "error": f"mlx_audio is unavailable: {exc}"}, ensure_ascii=False))
    sys.exit(0)


def load(model_dir):
    model = load_model(model_dir, strict=True)
    apply_tokenizer_fix(model)
    model.eval()
    return model


def read_take(path):
    with wave.open(path, "rb") as w:
        rate, channels, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
        if rate != 16000 or channels != 1 or width != 2:
            raise ValueError(f"take must be 16 kHz mono 16-bit PCM (got {rate} Hz, {channels} ch, {width * 8} bit)")
        raw = w.readframes(w.getnframes())
    audio = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if not np.isfinite(audio).all() or not audio.size:
        raise ValueError("take audio was empty or invalid")
    return audio


import re


def clean_repetitions(text):
    s = str(text or "").strip()
    s = re.sub(r"^[।?,!\s]+", "", s)
    s = re.sub(r"([^\s।?,!]+[\s।?,!]*)(?:\s*\1){2,}", "", s)
    return s.strip()


def transcribe(model, path):
    audio = read_take(path)
    parts = []
    for span in plan_chunks(audio):
        piece = audio[span["start_sample"]:span["end_sample"]]
        if not np.any(piece):
            continue
        result = model.generate(
            piece,
            language="bn",
            task="transcribe",
            temperature=0.0,
            condition_on_previous_text=False,
            return_timestamps=False,
            verbose=None,
            sample_len=440,
            no_speech_threshold=None,
        )
        text = str(getattr(result, "text", result) or "").strip()
        cleaned = clean_repetitions(text)
        if cleaned:
            parts.append(cleaned)
    return clean_repetitions(" ".join(parts).strip())


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model", required=True)
    p.add_argument("--wav")
    p.add_argument("--check", action="store_true")
    args = p.parse_args()
    try:
        model = load(args.model)
        if args.check:
            out = {"ok": True, "ready": True}
        else:
            if not args.wav:
                raise ValueError("a take WAV is required")
            text = transcribe(model, args.wav)
            out = {"ok": True, "text": text, "lang": "bn"}
    except Exception as exc:
        out = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    print(json.dumps(out, ensure_ascii=False), flush=True)
    sys.exit(0 if out["ok"] else 1)


if __name__ == "__main__":
    main()
