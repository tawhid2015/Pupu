#!/usr/bin/env python3
"""Roamies' built-in voice: Chatterbox (4-bit, MLX) served over loopback HTTP.

Started and stopped by the sidecar (chatterbox.mjs); never exposed beyond 127.0.0.1.
  GET  /health                  -> { ok, engine, voices: [{ id, name }], languages, sample_rate }
  POST /say  { text, voice, lang } -> raw PCM, 16-bit little-endian, mono, 24 kHz
  POST /warm { voice, lang }    -> { ok } after that language's conditionals are ready
The model is read from ROAMIES_VOICE_MODELS (default: <this dir>/models); reference wavs from
ROAMIES_VOICE_REFS (default: <this dir>/voices). Nothing is downloaded: both must ship with the app.
"""
import json
import os
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.environ.get("ROAMIES_VOICE_MODELS", os.path.join(HERE, "models"))
REFS = os.environ.get("ROAMIES_VOICE_REFS", os.path.join(HERE, "voices"))
PORT = int(os.environ.get("ROAMIES_VOICE_PORT", "0"))  # 0: the OS picks one, printed below for the sidecar
SAMPLE_RATE = 24000
IDLE_EXIT_S = float(os.environ.get("ROAMIES_VOICE_IDLE", "900"))  # the sidecar sends /idle to end it earlier

_lock = threading.Lock()  # one generation at a time: MLX is happiest that way
_models = {}  # 'en': the original Chatterbox, 'bn': the Bengali fine-tune
_conds = {}  # (lang, voice) -> conditionals
LANGUAGES = ('en', 'bn')
_last = time.time()
_log = lambda *a: print("[voice]", *a, file=sys.stderr, flush=True)


def has_bengali(s):
    return any("\u0980" <= c <= "\u09FF" for c in str(s or ""))


def local_snapshot(repo_id=None, **_):
    """huggingface_hub.snapshot_download stand-in: our weights are local, never fetched."""
    if repo_id and os.path.isdir(str(repo_id)):
        return str(repo_id)
    return os.path.join(MODELS, "s3tokenizer")


def model_dir(lang="en"):
    return os.path.join(MODELS, "chatterbox-bangla" if lang == "bn" else "chatterbox-4bit")


def load(lang="en"):
    if lang in _models:
        return _models[lang]
    import huggingface_hub

    huggingface_hub.snapshot_download = local_snapshot
    from mlx_audio.tts.models.chatterbox.chatterbox import Model

    t0 = time.time()
    _models[lang] = Model.from_pretrained(model_dir(lang))
    _log(f"{lang} model loaded in {time.time() - t0:.1f}s")
    return _models[lang]


def voices():
    out = []
    try:
        names = json.load(open(os.path.join(REFS, "voices.json"), encoding="utf-8"))
    except Exception:
        names = {}
    for f in sorted(os.listdir(REFS)):
        if not f.endswith(".wav"):
            continue
        vid = f[:-4]
        out.append({"id": vid, "name": names.get(vid, vid.replace("-", " ").title())})
    return out


def ref_path(vid, lang="en"):
    name = os.path.basename(str(vid or ""))
    voice_ids = {v["id"] for v in voices()}
    if name not in voice_ids:
        name = "bengali" if (lang == "bn" and "bengali" in voice_ids) else (voices()[0]["id"] if voices() else "")
    return os.path.join(REFS, name + ".wav")


def conditionals(vid, lang="en"):
    key = (lang, os.path.basename(ref_path(vid, lang)))
    if key in _conds:
        return _conds[key]
    from mlx_audio.utils import load_audio

    model = load(lang)
    ref = load_audio(ref_path(vid, lang), sample_rate=SAMPLE_RATE)
    t0 = time.time()
    conds = model.prepare_conditionals(ref, SAMPLE_RATE, 0.35)
    _conds[key] = conds
    _log(f"{lang} conditionals for {key[1]} in {time.time() - t0:.1f}s")
    return conds


def synth(text, vid, lang="en"):
    import numpy as np

    if has_bengali(text):
        lang = "bn"
    if lang == "bn" and (not vid or vid in ("sarah", "default", "classic", "")):
        vid = "bengali"

    model = load(lang)
    conds = conditionals(vid, lang)
    chunks = []
    for r in model.generate(
        text,
        conds=conds,
        exaggeration=0.35,
        cfg_weight=0.3,  # Chatterbox's own tip: 0.3 gives a calmer, more natural pace for fast reference voices
        temperature=0.8,
        verbose=False,
    ):
        chunks.append(np.asarray(r.audio).reshape(-1))
    if not chunks:
        return b""
    audio = np.concatenate(chunks)
    # A DC offset would push the speaker cone without making sound (a deep thump) and eat headroom. Remove it
    # before measuring level: RMS includes DC, so matching that would make the audible part far too loud.
    audio = audio - float(audio.mean()) if audio.size else audio
    # Match loudness by RMS, then cap the peaks. Volume only: never speed, pitch or the model's audio.
    rms = float(np.sqrt(np.mean(audio.astype("float64") ** 2))) if audio.size else 0.0
    target_rms = 0.10  # a little below the English clips, so Bangla never booms
    if rms > 0.0001:
        audio = audio * min(25.0, target_rms / rms)
    peak = float(np.abs(audio).max() or 0.0)
    if peak > 0.85:
        audio = audio * (0.85 / peak)
    return (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True

    def do_GET(self):
        global _last
        _last = time.time()
        if self.path == "/health":
            langs = [x for x in LANGUAGES if os.path.isdir(model_dir(x))]
            return self._json(200, {"ok": True, "engine": "Chatterbox (MLX, 4-bit)", "voices": voices(), "languages": langs, "sample_rate": SAMPLE_RATE})
        self._json(404, {"ok": False})

    def do_POST(self):
        global _last
        _last = time.time()
        n = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._json(400, {"ok": False, "error": "bad json"})
        if self.path == "/idle":
            return self._json(200, {"ok": True})
        requested_lang = str(body.get("lang") or "en").lower()
        lang = "bn" if requested_lang in ("bn", "bangla", "bn-bd") else "en"
        text = str(body.get("text") or "").strip()
        if has_bengali(text):
            lang = "bn"
        vid = body.get("voice")
        if lang == "bn" and (not vid or vid in ("sarah", "default", "classic", "")):
            vid = "bengali"
        if self.path == "/warm":
            try:
                with _lock:
                    # Prepare the voice that's about to speak. Warming every reference here used to queue minutes of
                    # work in front of the first sentence when a look or language changed; each voice is prepared on
                    # its own first use (or when it's picked) instead. The audio itself is identical.
                    conditionals(vid, lang)
                return self._json(200, {"ok": True})
            except Exception as e:  # noqa: BLE001
                _log("warm failed:", e)
                return self._json(500, {"ok": False, "error": str(e)})
        if not text:
            return self._json(400, {"ok": False, "error": "no text"})
        if self.path != "/say":
            return self._json(404, {"ok": False})
        t0 = time.time()
        try:
            with _lock:
                pcm = synth(text[:1200], vid, lang)
        except Exception as e:  # noqa: BLE001
            _log("say failed:", e)
            return self._json(500, {"ok": False, "error": str(e)})
        secs = len(pcm) / 2 / SAMPLE_RATE
        _log(f"{lang} say {secs:.2f}s audio in {time.time() - t0:.2f}s: {text[:60]!r}")
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("X-Sample-Rate", str(SAMPLE_RATE))
        self.send_header("X-Seconds", f"{secs:.2f}")
        self.send_header("Content-Length", str(len(pcm)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(pcm)
        self.close_connection = True


def leash():
    """Exit when the sidecar's pipe closes (the app quit or crashed), so nothing is left holding memory."""
    try:
        while sys.stdin.buffer.read(1):
            pass
    except Exception:
        pass
    _log("leash: sidecar gone, exiting")
    os._exit(0)


def reap():
    while True:
        time.sleep(30)
        if time.time() - _last > IDLE_EXIT_S:
            _log("idle: exiting")
            os._exit(0)


def main():
    if not os.path.isdir(os.path.join(MODELS, "chatterbox-4bit")):
        _log("no model at", MODELS)
        sys.exit(2)
    load("en")  # fail fast, before the app waits on a socket
    if os.path.isdir(os.path.join(MODELS, "chatterbox-bangla")):
        try:
            load("bn")
        except Exception as e:
            _log("warning: failed to preload bn model:", e)
    if os.isatty(0):  # typed by hand: warm before serving, so the first timed run is fair
        with _lock:
            conditionals(None, "en")
            synth("Ready.", None, "en")
            if "bn" in _models:
                conditionals("bengali", "bn")
        _log("warm")
    threading.Thread(target=reap, daemon=True).start()
    threading.Thread(target=leash, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    srv.daemon_threads = True
    _log(f"listening on 127.0.0.1:{srv.server_address[1]}")
    srv.serve_forever()


if __name__ == "__main__":
    main()
