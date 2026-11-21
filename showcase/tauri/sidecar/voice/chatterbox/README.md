# Roamies' built-in voice

This folder is the voice that lives inside Roamies: **Chatterbox 4-bit on MLX**, with the small Python helper
`engine.py` that the sidecar starts and stops for you. No VoiceStudio app, no launch agent, no key, no internet.

- `voices/` — the clips it can speak in. Each `*.wav` is a 12-second, cleaned-up piece of a reference clip;
  `voices.json` gives them their names in the Speaking page. Add a wav + a name there to add a voice to the picker.
- `models/` — Chatterbox 4-bit + S3Tokenizer. Created by `./prepare.sh` from the local development copy.
- `runtime/`, `site-packages/` — a relocatable Python 3.11 with mlx-audio, also created by `./prepare.sh`.
- `engine.py` — the helper. Listens only on 127.0.0.1, on a port the OS picks, and exits when the sidecar closes its
  pipe or after 15 idle minutes.

## First setup / after changing the voice clips or weights

```sh
cd showcase/tauri/sidecar/voice/chatterbox
./prepare.sh
cd ../../.. && ./build.sh
```

`prepare.sh` looks for the development venv and weights in
`~/Library/Application Support/RoamiesVoice/`; set `ROAMIES_VOICE_ROOT` to use another folder.

## Picking the voice

Speaking → Voice provider **Built-in voice** → Voice for [look]. Each look starts with its own clip, set in
`sidekick.mjs` (`BUILTIN_LOOK_VOICES`); a pick on the Speaking page overrides it for that look, and is saved in
`~/Roamies/Data/settings.json`.

## Speed

The engine is warmed in the background when the provider is picked and when the user starts talking (all reference
voices are prepared then, so switching looks is instant). Speech starts as soon as a short first clause is in — the
reply keeps streaming on screen while that audio is made — and the playback rate is never changed. A short first
clause takes about 1.5 s to render, a full sentence about 2–2.5 s, on an Apple silicon Mac. Everything stays local,
on CPU/GPU and about 1.5 GB of memory while the engine is awake.
