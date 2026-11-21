// Voice helper for Roamies on Windows and Linux: the twin of voice/main.swift, with the same JSON lines in and out.
// Watches the talk chord (GetAsyncKeyState on Windows, the X server on Linux X11 sessions; neither needs a
// permission), records the default microphone and
// transcribes on this PC with NVIDIA Parakeet TDT 0.6B v3 (int8 ONNX via parakeet-rs). Parakeet isn't a
// streaming model, so live text comes from re-reading the take about once a second.
// Hold the chord = push-to-talk (release sends). Quick tap = hands-free (ends on a pause or another tap).
// While the chord is held, moving the cursor round something circles it (ink.rs); the circled area goes out with
// what was said, as on macOS (Windows only). On Wayland no app can watch the keyboard, so there {"cmd":"toggle"}
// (sent for `roamies --talk`, which people bind to a key) starts a take, and sends it when it comes again or on a
// pause. With the wake word on, the mic stays open between takes and each thing said is read once, on this PC, for
// "Hey Roamies" (wake.rs); hearing it starts a hands-free take. Exits when stdin closes.
//
// roamies-voice --model <dir> [--chord control,option]   normal use (Roamies starts it)
// roamies-voice --perms                                   prints {"type":"perms","mic":…}
// roamies-voice --devices                                 prints {"type":"devices",…}: every mic, the default, formats
// roamies-voice --model <dir> --transcribe <wav>          dev: transcribe a file and exit
// roamies-voice --model <dir> --test-audio <wav>          dev: a file stands in for the mic ({"cmd":"listen"} starts)
// roamies-voice --model <dir> --test-audio <wav> --wake   dev: the same with the wake word on, so "Hey Roamies" starts
//                                                         a take (tests/wake_e2e.rs runs it on a spoken recording)

mod audio;
mod ink;
mod keys;
mod wake;

use audio::{MicError, Sink, Source};
use parakeet_rs::{ExecutionConfig, ParakeetTDT, Transcriber};
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

pub const RATE: u32 = 16_000;

pub fn emit(v: Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{v}");
    let _ = out.flush();
}

pub fn log(s: &str) {
    eprintln!("[voice] {s}");
}

/// The error the app shows when the microphone can't be used; `reason` picks what the Roamie says.
fn mic_error(e: &MicError) -> Value {
    json!({ "type": "error", "code": "no_input", "reason": e.reason, "message": e.detail })
}

pub enum Ev {
    Cmd(Value),
    StdinClosed,
    Level(f64),
    AudioFailed(MicError),
    Text { take: u64, text: String, last: bool, wake: bool },
    EngineFailed(String),
}

// ---------- transcription (its own thread: loading and reading never stall the hotkey loop) ----------

struct Job {
    take: u64,
    audio: Vec<f32>,
    last: bool,
    /// A read of something said while listening for the wake phrase.
    wake: bool,
}

fn model_present(dir: &Path) -> bool {
    dir.join("vocab.txt").is_file() && dir.join("encoder-model.int8.onnx").is_file() && dir.join("decoder_joint-model.int8.onnx").is_file()
}

fn load_model(dir: &Path) -> Result<ParakeetTDT, String> {
    // Half the cores: quick enough to read a minute of speech in a second or two, without starving the PC.
    let threads = thread::available_parallelism().map(|n| n.get() / 2).unwrap_or(2).clamp(1, 8);
    let t0 = Instant::now();
    let env = parakeet_rs::ort::init().with_name("roamies-voice").build().map_err(|e| e.to_string())?;
    let config = ExecutionConfig::new().with_environment(env).with_intra_threads(threads);
    let mut asr = ParakeetTDT::from_pretrained(dir, Some(config)).map_err(|e| e.to_string())?;
    // One short warm-up run, so the first real request doesn't pay for ONNX Runtime's setup.
    let _ = asr.transcribe_samples(vec![0.0; RATE as usize / 2], RATE, 1, None);
    log(&format!("model ready in {:.1}s ({threads} threads)", t0.elapsed().as_secs_f64()));
    Ok(asr)
}

fn transcribe(asr: &mut ParakeetTDT, audio: Vec<f32>) -> String {
    if audio.len() < RATE as usize / 5 {
        return String::new();
    }
    match asr.transcribe_samples(audio, RATE, 1, None) {
        Ok(r) => r.text.split_whitespace().collect::<Vec<_>>().join(" "),
        Err(e) => {
            log(&format!("transcribe: {e}"));
            String::new()
        }
    }
}

fn spawn_engine(dir: PathBuf, tx: Sender<Ev>) -> (Sender<Job>, thread::JoinHandle<()>) {
    let (jtx, jrx) = mpsc::channel::<Job>();
    let handle = thread::spawn(move || {
        let mut asr = match load_model(&dir) {
            Ok(a) => a,
            Err(e) => {
                log(&format!("model failed to load: {e}"));
                let _ = tx.send(Ev::EngineFailed(e));
                return;
            }
        };
        while let Ok(first) = jrx.recv() {
            // Only the newest live read matters; a closing read always runs.
            let mut jobs = vec![first];
            jobs.extend(jrx.try_iter());
            let job = match jobs.iter().rposition(|j| j.last) {
                Some(i) => jobs.swap_remove(i),
                None => jobs.pop().expect("at least one job"),
            };
            let text = transcribe(&mut asr, job.audio);
            if tx.send(Ev::Text { take: job.take, text, last: job.last, wake: job.wake }).is_err() {
                return;
            }
        }
    });
    (jtx, handle)
}

// ---------- the talk session (port of the Voice class in voice/main.swift) ----------

#[derive(Clone, Copy, PartialEq, Debug)]
enum Phase {
    Idle,
    // Listening quietly for the wake phrase (nothing shown); hearing it turns into a hands-free take.
    Wake,
    Armed,
    Holding,
    HandsFree,
    Finishing,
}

const TAP_LIMIT: f64 = 0.25;
// A release must last this long to count, so one glitchy frame of key state can't end a session.
const RELEASE_DEBOUNCE: f64 = 0.09;
const PAUSE_ENDS: f64 = 1.5;
const MAX_SESSION: f64 = 60.0;
// Keep the mic open a moment after release so a word said while letting go isn't clipped.
const TAIL: f64 = 0.3;
const FINAL_TIMEOUT: f64 = 30.0;
const READ_EVERY: f64 = 0.8;
// Parakeet makes up words ("Thank you.") from silence, so a take is only read once the mic heard a voice:
// about -49 dBFS, above room noise and below quiet speech.
const SPEECH_LEVEL: f64 = 0.15;
// Hands-free, a take also ends once this much more sound came in without new words: steady noise or a voice in the
// background can keep the level up, but it doesn't keep adding to what was said (#64).
const STALE_ENDS: f64 = 4.0;
// Wake listening keeps this much sound while nobody talks, and starts what's said this far before the voice was heard.
const WAKE_KEEP: f64 = 0.5;
const WAKE_PREROLL: f64 = 0.3;
// Something said is read once for the phrase: at its first pause, or this long after it started (the phrase has to
// come first, so a longer read wouldn't find it anyway).
const WAKE_PAUSE: f64 = 0.7;
const WAKE_LONGEST: f64 = 2.5;
const WAKE_COOLDOWN: f64 = 2.0;

/// The room's steady noise on the level scale, so background noise (a fan, a TV, a busy room) doesn't count as talking
/// and keep a hands-free take open (#64). It starts at the take's first reading, falls almost at once to a quieter
/// level and rises slowly to a louder one: speech dips between words, so it barely moves the floor, while noise that
/// stays up soon becomes it.
#[derive(Default)]
struct NoiseFloor {
    level: f64,
    at: Option<f64>,
}

impl NoiseFloor {
    const FALL: f64 = 0.05;
    const RISE: f64 = 4.0;
    // A voice is at least this far above the floor (0.25 is 10 dB) and above the old fixed bar.
    const ABOVE: f64 = 0.25;
    const VOICE: f64 = 0.2;

    /// Takes the next level reading; true when it's loud enough over the room to be someone talking.
    fn is_voice(&mut self, v: f64, now: f64) -> bool {
        let Some(at) = self.at.replace(now) else {
            self.level = v;
            return v > Self::VOICE;
        };
        let dt = (now - at).clamp(0.0, 1.0);
        let voice = v > Self::VOICE.max(self.level + Self::ABOVE);
        let tau = if v < self.level { Self::FALL } else { Self::RISE };
        self.level += (v - self.level) * (dt / tau).min(1.0);
        voice
    }
}

/// What was said, ignoring case and punctuation: a re-read that only moves a comma isn't new words.
fn words(text: &str) -> String {
    text.chars().filter(|c| c.is_alphanumeric() || c.is_whitespace()).flat_map(char::to_lowercase).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ")
}

struct Voice {
    phase: Phase,
    chord: u8,
    chord_at: f64,
    listen_at: f64,
    /// How long a hands-free take waits for words before giving up (auto-listen's setting; 8 s otherwise).
    nothing_wait: f64,
    heard_at: f64,
    voice_at: f64,
    floor: NoiseFloor,
    level_at: f64,
    released_at: Option<f64>,
    blocked: bool,
    prev_chord: bool,
    report_empty: bool,
    spoke: bool,
    best: String,
    // Each session gets a new take number; results for older takes are ignored.
    take: u64,
    buf: Arc<Mutex<Vec<f32>>>,
    source: Option<Source>,
    engine: Option<Sender<Job>>,
    engine_error: Option<String>,
    reading: bool,
    read_at: f64,
    read_len: usize,
    // How much of the take had come in when its words last changed.
    heard_len: usize,
    tail_until: Option<f64>,
    final_until: Option<f64>,
    test_audio: Option<PathBuf>,
    ink: ink::Ink,
    // Wake word: on in settings; held off while Roamies answers and speaks; resting just after a take.
    wake_on: bool,
    wake_hold: bool,
    wake: wake::WakeWord,
    wake_cooldown_until: f64,
    wake_retry_at: f64,
    wake_started_at: f64,
    wake_drops: usize,
    // What's being said while listening for the phrase: where it starts in the buffer, when, whether it was read.
    utter: Option<usize>,
    utter_at: f64,
    utter_read: bool,
    wake_reading: bool,
    // This take was started by the phrase, which took this many words: they aren't part of what was said.
    woke: bool,
    wake_words: usize,
    tx: Sender<Ev>,
    t0: Instant,
}

impl Voice {
    fn new(engine: Option<Sender<Job>>, test_audio: Option<PathBuf>, tx: Sender<Ev>) -> Voice {
        Voice {
            phase: Phase::Idle,
            chord: keys::mask(&["control".into(), "option".into()]).expect("default chord"),
            chord_at: 0.0,
            listen_at: 0.0,
            nothing_wait: 8.0,
            heard_at: 0.0,
            voice_at: 0.0,
            floor: NoiseFloor::default(),
            level_at: 0.0,
            released_at: None,
            blocked: false,
            prev_chord: false,
            report_empty: false,
            spoke: false,
            best: String::new(),
            take: 0,
            buf: Arc::new(Mutex::new(Vec::new())),
            source: None,
            engine,
            engine_error: None,
            reading: false,
            read_at: 0.0,
            read_len: 0,
            heard_len: 0,
            tail_until: None,
            final_until: None,
            test_audio,
            ink: ink::Ink::default(),
            wake_on: false,
            wake_hold: false,
            wake: wake::WakeWord::default(),
            wake_cooldown_until: 0.0,
            wake_retry_at: 0.0,
            wake_started_at: 0.0,
            wake_drops: 0,
            utter: None,
            utter_at: 0.0,
            utter_read: false,
            wake_reading: false,
            woke: false,
            wake_words: 0,
            tx,
            t0: Instant::now(),
        }
    }

    fn now(&self) -> f64 {
        self.t0.elapsed().as_secs_f64()
    }

    fn set_chord(&mut self, names: &[String]) {
        let Some(m) = keys::mask(names) else { return log(&format!("ignored chord {names:?}")) };
        if self.phase == Phase::Wake {
            self.stop_wake();
        } else if self.phase != Phase::Idle {
            self.cancel();
        }
        self.chord = m;
        self.blocked = true;
        log(&format!("talk chord: {}", names.join("+")));
    }

    fn tick(&mut self) {
        let now = self.now();
        self.tick_keys(now, keys::held());
        self.ink.set_armed(matches!(self.phase, Phase::Armed | Phase::Holding), now);
        self.ink.follow(now);
        match self.phase {
            Phase::Holding | Phase::HandsFree => self.maybe_read(now),
            Phase::Wake => self.tick_wake(now),
            Phase::Finishing => {
                if self.tail_until.is_some_and(|t| now >= t) {
                    self.tail_until = None;
                    self.close_take(now);
                } else if self.final_until.is_some_and(|t| now >= t) {
                    log("final read timed out");
                    self.finalize();
                }
            }
            _ => {}
        }
    }

    fn tick_keys(&mut self, now: f64, f: keys::Held) {
        let held = f.mods & self.chord;
        let down = held == self.chord; // once talking, a stray extra modifier doesn't count as letting go
        let extra = f.mods & !self.chord != 0 || f.altgr;
        let chord = down && !extra;
        let prev = self.prev_chord;
        self.prev_chord = chord;
        if held == 0 {
            self.blocked = false;
        }
        let released = if down {
            self.released_at = None;
            false
        } else {
            let at = *self.released_at.get_or_insert(now);
            now - at >= RELEASE_DEBOUNCE
        };

        match self.phase {
            Phase::Idle => {
                if chord && !prev && !self.blocked {
                    self.arm(now);
                } else if self.wake_allowed(now) {
                    self.start_wake(now);
                }
            }
            Phase::Wake => {
                if chord && !prev && !self.blocked {
                    self.stop_wake();
                    self.arm(now);
                } else if !self.wake_on || self.wake_hold {
                    self.stop_wake();
                }
            }
            Phase::Armed => {
                // Only the first moment decides shortcut vs. talk: the chord plus a key or another modifier is a shortcut.
                if down && (extra || keys::other_key_down()) {
                    log("not a talk: the chord was part of a shortcut");
                    self.cancel();
                    self.blocked = true;
                } else if released {
                    self.phase = Phase::HandsFree;
                    self.show_listening("handsfree", now);
                } else if down && now - self.chord_at >= TAP_LIMIT {
                    self.phase = Phase::Holding;
                    self.show_listening("hold", now);
                }
            }
            Phase::Holding => {
                if released {
                    self.end("released", now);
                    self.finish();
                } else if now - self.listen_at > MAX_SESSION {
                    self.end("max length", now);
                    self.finish();
                }
            }
            Phase::HandsFree => {
                // Pressing again switches to push-to-talk; letting go then sends.
                if chord && !prev && !self.blocked {
                    self.phase = Phase::Holding;
                    self.released_at = None;
                    return;
                }
                let quiet = now - self.heard_at.max(self.voice_at);
                let stale = self.read_len.saturating_sub(self.heard_len) as f64 / RATE as f64;
                if !self.best.is_empty() && quiet > PAUSE_ENDS {
                    self.end("pause", now);
                    self.finish();
                } else if !self.best.is_empty() && stale > STALE_ENDS {
                    self.end("no new words", now);
                    self.finish();
                } else if self.best.is_empty() && !self.reading && now - self.listen_at > self.nothing_wait && now - self.voice_at > PAUSE_ENDS {
                    self.end("nothing heard", now);
                    self.cancel();
                } else if now - self.listen_at > MAX_SESSION {
                    self.end("max length", now);
                    self.finish();
                }
            }
            Phase::Finishing => {}
        }
    }

    fn end(&self, why: &str, now: f64) {
        log(&format!("session end: {why} after {:.1}s", now - self.listen_at));
    }

    fn arm(&mut self, now: f64) {
        self.phase = Phase::Armed;
        self.nothing_wait = 8.0;
        self.chord_at = now;
        self.best.clear();
        self.spoke = false;
        self.take += 1;
        self.reading = false;
        self.read_len = 0;
        self.heard_len = 0;
        // Start the mic now so the first word isn't lost (a shortcut cancels it a moment later).
        if self.engine.is_some() && keys::mic_allowed() {
            self.start_audio();
        }
    }

    fn show_listening(&mut self, mode: &str, now: f64) {
        self.listen_at = now;
        self.heard_at = now;
        self.voice_at = now;
        self.read_at = now;
        if self.engine.is_none() {
            let code = if self.engine_error.is_some() { "recognition" } else { "model_missing" };
            emit(json!({ "type": "error", "code": code, "message": self.engine_error.clone().unwrap_or_default() }));
            return self.cancel();
        }
        if !keys::mic_allowed() {
            emit(json!({ "type": "error", "code": "permission", "what": "microphone" }));
            return self.cancel();
        }
        if self.source.is_none() {
            self.start_audio();
            if self.phase == Phase::Idle {
                return;
            }
        }
        emit(json!({ "type": "state", "state": "listening", "mode": mode }));
        if !self.best.is_empty() {
            emit(json!({ "type": "partial", "text": self.best }));
        }
    }

    fn open_audio(&mut self) -> Result<(), MicError> {
        self.buf.lock().unwrap().clear();
        self.floor = NoiseFloor::default();
        let sink = Sink::new(self.buf.clone(), self.tx.clone());
        let started = match &self.test_audio {
            Some(p) => audio::play_file(p, sink).map_err(|e| MicError::new("failed", e)),
            None => audio::open_mic(sink),
        };
        self.source = Some(started?);
        Ok(())
    }

    fn start_audio(&mut self) {
        if let Err(e) = self.open_audio() {
            log(&format!("audio: {} ({})", e.detail, e.reason));
            emit(mic_error(&e));
            self.cancel();
        }
    }

    fn stop_audio(&mut self) {
        self.source = None;
    }

    // While listening: re-read the whole take now and then, for live text and pause detection.
    fn maybe_read(&mut self, now: f64) {
        let Some(engine) = &self.engine else { return };
        if !self.spoke || self.reading || now - self.read_at < READ_EVERY {
            return;
        }
        let audio = self.buf.lock().unwrap().clone();
        if audio.len() < RATE as usize / 2 || audio.len() < self.read_len + RATE as usize * 3 / 10 {
            return;
        }
        self.read_at = now;
        self.read_len = audio.len();
        self.reading = engine.send(Job { take: self.take, audio, last: false, wake: false }).is_ok();
    }

    fn finish(&mut self) {
        if !matches!(self.phase, Phase::Armed | Phase::Holding | Phase::HandsFree) {
            return;
        }
        let shown = self.phase != Phase::Armed;
        self.report_empty = shown;
        self.phase = Phase::Finishing;
        self.ink.capture(self.now());
        if shown {
            emit(json!({ "type": "state", "state": "processing" }));
        }
        if self.source.is_none() {
            return self.finalize();
        }
        self.tail_until = Some(self.now() + TAIL);
    }

    // Mic off, then one last read of the whole take; its result ends the session.
    fn close_take(&mut self, now: f64) {
        self.stop_audio();
        let audio = std::mem::take(&mut *self.buf.lock().unwrap());
        match &self.engine {
            Some(engine) if self.spoke && engine.send(Job { take: self.take, audio, last: true, wake: false }).is_ok() => self.final_until = Some(now + FINAL_TIMEOUT),
            _ => self.finalize(),
        }
    }

    fn on_text(&mut self, take: u64, text: String, last: bool) {
        if take != self.take {
            return;
        }
        if !last {
            self.reading = false;
        }
        // A take started by the wake phrase: the phrase itself isn't part of what was said.
        let text = if self.woke && !text.is_empty() { self.wake.match_rest(&text).unwrap_or_else(|| wake::dropping(self.wake_words, &text)) } else { text };
        // A closing read that came back empty keeps whatever the live reads heard.
        if !text.is_empty() && text != self.best {
            if words(&text) != words(&self.best) {
                self.heard_at = self.now();
                if !last {
                    self.heard_len = self.read_len;
                }
            }
            self.best = text;
            if !matches!(self.phase, Phase::Idle | Phase::Armed) {
                emit(json!({ "type": "partial", "text": self.best }));
            }
        }
        if last && self.phase == Phase::Finishing {
            self.finalize();
        }
    }

    fn on_level(&mut self, v: f64) {
        let now = self.now();
        if self.floor.is_voice(v, now) {
            self.voice_at = now;
            if self.phase == Phase::Wake && self.utter.is_none() {
                let len = self.buf.lock().unwrap().len();
                self.utter = Some(len.saturating_sub((WAKE_PREROLL * RATE as f64) as usize));
                self.utter_at = now;
                self.utter_read = false;
            }
        }
        if v > SPEECH_LEVEL && !matches!(self.phase, Phase::Idle | Phase::Wake) {
            self.spoke = true;
        }
        if !matches!(self.phase, Phase::Holding | Phase::HandsFree) || now - self.level_at < 0.05 {
            return;
        }
        self.level_at = now;
        emit(json!({ "type": "level", "v": (v * 100.0).round() / 100.0 }));
    }

    fn finalize(&mut self) {
        if self.phase != Phase::Finishing {
            return;
        }
        self.stop_audio();
        self.tail_until = None;
        self.final_until = None;
        self.take += 1;
        self.phase = Phase::Idle;
        self.woke = false;
        self.wake_cooldown_until = self.now() + WAKE_COOLDOWN;
        let text = self.best.trim().to_string();
        let area = self.ink.take();
        if !text.is_empty() {
            // What was circled on screen while talking rides along with the words.
            let mut msg = json!({ "type": "final", "text": text });
            if let Some(a) = area {
                msg["area"] = a;
                log("sent what was said, with the circled area");
            }
            emit(msg);
        } else if let Some(f) = area.as_ref().and_then(|a| a["file"].as_str()) {
            // Circled something but said nothing: drop it quietly (no "I didn't hear you").
            let _ = std::fs::remove_file(f);
            log("nothing said, dropped the circled area");
            self.report_empty = false;
        }
        emit(json!({ "type": "state", "state": "idle" }));
        // Listened but got no words: say so instead of closing silently.
        if text.is_empty() && self.report_empty {
            emit(json!({ "type": "error", "code": "nothing_heard", "spoke": self.voice_at > self.listen_at + 0.05 }));
        }
        self.report_empty = false;
    }

    fn cancel(&mut self) {
        self.stop_audio();
        self.buf.lock().unwrap().clear();
        self.tail_until = None;
        self.final_until = None;
        self.take += 1;
        self.reading = false;
        self.phase = Phase::Idle;
        self.report_empty = false;
        let now = self.now();
        self.woke = false;
        self.wake_cooldown_until = now + WAKE_COOLDOWN;
        self.ink.clear(now);
        emit(json!({ "type": "state", "state": "idle", "cancelled": true }));
    }

    /// Start listening hands-free without a key press (after an area snap). Ends on a pause or a tap.
    fn listen_now(&mut self, wait: Option<f64>) {
        self.stop_wake();
        if self.phase != Phase::Idle {
            return;
        }
        let now = self.now();
        self.arm(now);
        self.nothing_wait = wait.unwrap_or(8.0).clamp(3.0, 15.0);
        self.phase = Phase::HandsFree;
        self.blocked = true; // the snap shortcut's keys may still be held: don't read them as a tap
        self.show_listening("handsfree", now);
    }

    /// The talk shortcut where the keys can't be watched (`roamies --talk`): the first one starts listening
    /// hands-free, the next one sends what was said (so does a pause).
    fn toggle(&mut self) {
        match self.phase {
            Phase::Idle | Phase::Wake => self.listen_now(None),
            Phase::Armed | Phase::Holding | Phase::HandsFree => {
                let now = self.now();
                self.end("toggled", now);
                self.finish();
            }
            Phase::Finishing => {}
        }
    }

    /// Roamies saw its show/hide shortcut: that chord press was a shortcut, not a request to talk.
    fn external_cancel(&mut self) {
        if matches!(self.phase, Phase::Armed | Phase::Holding | Phase::HandsFree) {
            self.cancel();
        }
        self.blocked = true;
    }

    // ---------- wake word ----------

    fn set_wake(&mut self, on: bool) {
        if on == self.wake_on {
            return;
        }
        self.wake_on = on;
        if on {
            self.wake_drops = 0;
            self.wake_retry_at = 0.0;
        }
        log(&format!("wake word {}", if on { "on" } else { "off" }));
        if !on {
            self.stop_wake();
        }
    }

    fn set_wake_hold(&mut self, on: bool) {
        if self.wake_on && on != self.wake_hold {
            log(if on { "wake: paused while Roamies answers" } else { "wake: resumed" });
        }
        self.wake_hold = on;
        if on {
            self.stop_wake();
        }
    }

    // Never asks for anything: wake listening starts only once the model is there and the mic is allowed.
    fn wake_allowed(&mut self, now: f64) -> bool {
        if !self.wake_on || self.wake_hold || self.engine.is_none() || now < self.wake_cooldown_until || now < self.wake_retry_at {
            return false;
        }
        if !keys::mic_allowed() {
            self.wake_retry_at = now + 5.0;
            return false;
        }
        true
    }

    fn start_wake(&mut self, now: f64) {
        self.wake_started_at = now;
        self.phase = Phase::Wake;
        self.take += 1;
        self.best.clear();
        self.woke = false;
        self.utter = None;
        self.utter_read = false;
        self.wake_reading = false;
        self.voice_at = now;
        self.heard_at = now;
        match self.open_audio() {
            Ok(()) => log("wake: listening"),
            Err(e) => {
                log(&format!("wake: couldn't open the mic: {} ({})", e.detail, e.reason));
                self.stop_wake();
                self.back_off_wake(now);
            }
        }
    }

    // Wake listening that stops soon after starting, again and again: wait longer each time (5 s, 30 s, 2 min, 10 min).
    fn back_off_wake(&mut self, now: f64) {
        self.wake_drops = if now - self.wake_started_at < 20.0 { self.wake_drops + 1 } else { 1 };
        let wait = [5.0, 30.0, 120.0, 600.0][(self.wake_drops - 1).min(3)];
        self.wake_retry_at = now + wait;
        if self.wake_drops > 1 {
            log(&format!("wake: stopped again soon after starting: next try in {wait} s"));
        }
    }

    fn stop_wake(&mut self) {
        if self.phase != Phase::Wake {
            return;
        }
        self.stop_audio();
        self.buf.lock().unwrap().clear();
        self.phase = Phase::Idle;
        self.take += 1; // a wake read still running is dropped
        self.utter = None;
        self.wake_reading = false;
        self.best.clear();
    }

    // Reads each thing said once, and keeps only the last moment of sound while nobody talks.
    fn tick_wake(&mut self, now: f64) {
        let quiet = now - self.voice_at >= WAKE_PAUSE;
        if let Some(start) = self.utter {
            if !self.utter_read && !self.wake_reading && (quiet || now - self.utter_at >= WAKE_LONGEST) {
                self.utter_read = true;
                let audio = {
                    let buf = self.buf.lock().unwrap();
                    buf[start.min(buf.len())..].to_vec()
                };
                if let Some(engine) = &self.engine {
                    self.wake_reading = engine.send(Job { take: self.take, audio, last: false, wake: true }).is_ok();
                }
                return;
            }
            if self.utter_read && !self.wake_reading && quiet {
                self.utter = None;
            }
        }
        // Read and not the phrase (or nothing being said): the start of it is no longer needed.
        if self.utter.is_none() || (self.utter_read && !self.wake_reading) {
            let keep = (WAKE_KEEP * RATE as f64) as usize;
            let mut buf = self.buf.lock().unwrap();
            if buf.len() > keep + RATE as usize / 10 {
                let cut = buf.len() - keep;
                buf.drain(..cut);
            }
        }
    }

    fn on_wake_text(&mut self, take: u64, text: String) {
        if take != self.take || self.phase != Phase::Wake {
            return;
        }
        self.wake_reading = false;
        let scan = self.wake.scan(&text);
        let Some(rest) = scan.rest else {
            if !text.is_empty() {
                log(&format!("wake: heard {} words, not the phrase", wake::tokens(&text).len()));
            }
            return;
        };
        log(&format!("wake: heard the phrase (distance {})", scan.distance.unwrap_or(0)));
        let now = self.now();
        // Same mic, same buffer from where the phrase began: the rest of the sentence is already the take's start.
        let start = self.utter.take().unwrap_or(0);
        {
            let mut buf = self.buf.lock().unwrap();
            let cut = start.min(buf.len());
            buf.drain(..cut);
        }
        self.woke = true;
        self.wake_words = wake::tokens(&text).len().saturating_sub(wake::tokens(&rest).len());
        self.phase = Phase::HandsFree;
        self.nothing_wait = 8.0;
        self.chord_at = now;
        self.take += 1;
        self.spoke = true;
        self.reading = false;
        self.read_len = 0;
        self.heard_len = 0;
        self.best = rest;
        self.show_listening("wake", now);
    }

    /// Returns true when Roamies has gone (stdin closed) and the helper should exit.
    fn handle(&mut self, ev: Ev) -> bool {
        match ev {
            Ev::Cmd(msg) => match msg.get("cmd").and_then(Value::as_str) {
                Some("cancel") => self.external_cancel(),
                Some("listen") => self.listen_now(msg.get("wait").and_then(Value::as_f64)),
                Some("toggle") => self.toggle(),
                // The panel's mic picker: the list, and a pick (a name from it; none or "" is the default), used from the
                // next time the mic opens.
                Some("mics") => emit(audio::mics()),
                Some("mic") => {
                    let id = msg.get("id").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_owned);
                    log(&format!("mic: {}", id.as_deref().unwrap_or("default")));
                    *audio::CHOSEN.lock().unwrap() = id;
                    self.stop_wake(); // wake listening starts again on the new mic
                }
                Some("wake") => self.set_wake(msg.get("on").and_then(Value::as_bool) == Some(true)),
                Some("wake_name") => {
                    let ok = self.wake.set_name(msg.get("word").and_then(Value::as_str));
                    log(if !ok { "wake name refused" } else if self.wake.custom().is_some() { "wake name: custom" } else { "wake name: Roamies" });
                }
                // Roamies is answering or speaking: don't listen for the phrase (it mustn't wake itself).
                Some("wake_hold") => self.set_wake_hold(msg.get("on").and_then(Value::as_bool) == Some(true)),
                Some("chord") => {
                    let mods: Vec<String> = msg.get("mods").and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_owned)).collect()).unwrap_or_default();
                    self.set_chord(&mods);
                }
                // Muting the speakers while listening is macOS-only for now.
                _ => {}
            },
            Ev::StdinClosed => return true,
            Ev::Level(v) => self.on_level(v),
            Ev::AudioFailed(e) => {
                log(&format!("audio stream: {} ({})", e.detail, e.reason));
                if self.phase == Phase::Wake {
                    // Wake listening never bothers the user: it tries again later.
                    self.stop_wake();
                    let now = self.now();
                    self.back_off_wake(now);
                } else if matches!(self.phase, Phase::Armed | Phase::Holding | Phase::HandsFree) {
                    emit(mic_error(&e));
                    self.cancel();
                }
            }
            Ev::Text { take, text, wake: true, .. } => self.on_wake_text(take, text),
            Ev::Text { take, text, last, wake: false } => self.on_text(take, text, last),
            Ev::EngineFailed(e) => {
                self.engine = None;
                self.engine_error = Some(e);
            }
        }
        false
    }
}

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned()
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--perms") {
        emit(json!({ "type": "perms", "mic": if keys::mic_allowed() { "granted" } else { "denied" }, "input": audio::has_input() }));
        return;
    }
    if args.iter().any(|a| a == "--devices") {
        let mut v = audio::devices();
        v["mic_allowed"] = json!(keys::mic_allowed());
        emit(v);
        return;
    }
    let model = arg(&args, "--model").map(PathBuf::from);
    // Cursor positions and captures in real pixels on every monitor (ink.rs turns them into screen points).
    #[cfg(windows)]
    // SAFETY: a plain call at startup, before any window or thread exists.
    unsafe {
        windows_sys::Win32::UI::HiDpi::SetProcessDpiAwarenessContext(windows_sys::Win32::UI::HiDpi::DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }

    if let Some(wav) = arg(&args, "--transcribe") {
        let dir = model.expect("--transcribe needs --model <dir>");
        let mut asr = load_model(&dir).unwrap_or_else(|e| panic!("model: {e}"));
        let (samples, rate) = audio::read_wav(Path::new(&wav)).unwrap_or_else(|e| panic!("{wav}: {e}"));
        let t0 = Instant::now();
        let text = transcribe(&mut asr, samples.clone());
        emit(json!({ "text": text, "seconds": (t0.elapsed().as_secs_f64() * 100.0).round() / 100.0, "audio": samples.len() as f64 / rate as f64 }));
        return;
    }

    let (tx, rx): (Sender<Ev>, Receiver<Ev>) = mpsc::channel();
    let (engine, engine_thread) = match &model {
        Some(dir) if model_present(dir) => {
            let (jobs, handle) = spawn_engine(dir.clone(), tx.clone());
            (Some(jobs), Some(handle))
        }
        _ => {
            log("speech model not downloaded yet");
            (None, None)
        }
    };
    let mut voice = Voice::new(engine, arg(&args, "--test-audio").map(PathBuf::from), tx.clone());
    if args.iter().any(|a| a == "--wake") {
        voice.set_wake(true);
    }
    if let Some(c) = arg(&args, "--chord") {
        voice.set_chord(&c.split(',').map(str::to_owned).collect::<Vec<_>>());
    }

    let stdin_tx = tx.clone();
    thread::spawn(move || {
        for line in std::io::stdin().lock().lines().map_while(Result::ok) {
            if let Ok(v) = serde_json::from_str::<Value>(&line) {
                let _ = stdin_tx.send(Ev::Cmd(v));
            }
        }
        let _ = stdin_tx.send(Ev::StdinClosed);
    });

    emit(json!({ "type": "ready", "engine": "parakeet", "model": voice.engine.is_some() }));
    loop {
        let quit = match rx.recv_timeout(Duration::from_millis(16)) {
            Ok(ev) => {
                let mut quit = voice.handle(ev);
                while let Ok(ev) = rx.try_recv() {
                    quit |= voice.handle(ev);
                }
                quit
            }
            Err(RecvTimeoutError::Timeout) => false,
            Err(RecvTimeoutError::Disconnected) => true,
        };
        if quit {
            break;
        }
        voice.tick();
    }
    // Let the engine thread finish (a model still loading included) before exiting: tearing ONNX Runtime
    // down under it crashes.
    drop(voice);
    if let Some(h) = engine_thread {
        let _ = h.join();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // A Voice with a stand-in engine (the test reads its jobs) and a short WAV in place of the microphone.
    fn voice() -> (Voice, Receiver<Job>, PathBuf) {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let wav = std::env::temp_dir().join(format!("roamies-voice-test-{}-{}.wav", std::process::id(), N.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
        let spec = hound::WavSpec { channels: 1, sample_rate: RATE, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
        let mut w = hound::WavWriter::create(&wav, spec).expect("test wav");
        for i in 0..RATE / 2 {
            w.write_sample(((i as f32 * 0.2).sin() * 8000.0) as i16).expect("sample");
        }
        w.finalize().expect("wav written");
        let (jobs, jrx) = mpsc::channel();
        let (tx, _events) = mpsc::channel();
        (Voice::new(Some(jobs), Some(wav.clone()), tx), jrx, wav)
    }

    #[test]
    fn toggle_starts_a_take_and_the_next_one_sends_it() {
        let (mut v, jobs, wav) = voice();
        v.toggle();
        assert_eq!(v.phase, Phase::HandsFree, "the first toggle listens hands-free");
        assert!(v.source.is_some(), "the microphone is on");
        v.on_level(0.5);
        v.on_text(v.take, "hello there".into(), false);
        v.toggle();
        assert_eq!(v.phase, Phase::Finishing, "the second toggle ends the take");
        v.toggle();
        assert_eq!(v.phase, Phase::Finishing, "a third one while it finishes changes nothing");
        // The mic's tail is over: the whole take goes for one last read.
        v.tail_until = Some(0.0);
        v.tick();
        let job = jobs.try_recv().expect("a closing read");
        assert!(job.last && job.take == v.take);
        assert!(v.source.is_none(), "the microphone is off");
        v.on_text(job.take, "hello there friend".into(), true);
        assert_eq!(v.phase, Phase::Idle);
        assert_eq!(v.best, "hello there friend");
        // And it's ready to go again.
        v.toggle();
        assert_eq!(v.phase, Phase::HandsFree);
        let _ = std::fs::remove_file(wav);
    }

    #[test]
    fn steady_background_noise_stops_counting_as_a_voice() {
        // Regression (#64): a fan or TV at a steady level kept a hands-free take open until its 60 s limit.
        let mut f = NoiseFloor::default();
        let mut t = 0.0;
        let mut voiced = 0;
        for i in 0..400 {
            t += 0.01;
            if f.is_voice(0.45 + if i % 2 == 0 { 0.03 } else { -0.03 }, t) && i > 4 {
                voiced += 1;
            }
        }
        assert_eq!(voiced, 0, "steady noise is the floor, not a voice");
        assert!(f.is_voice(0.8, t + 0.01), "speech well above the noise still counts");
        // Speech in a quiet room: from the first dip between words, every word counts.
        let mut q = NoiseFloor::default();
        let mut t = 0.0;
        let (mut spoken, mut voiced) = (0, 0);
        for i in 0..300 {
            t += 0.01;
            let v = if i % 30 < 22 { 0.6 } else { 0.05 };
            let voice = q.is_voice(v, t);
            if i >= 30 && v > 0.5 {
                spoken += 1;
                voiced += voice as u32;
            }
        }
        assert_eq!(voiced, spoken, "a voice over a quiet room counts throughout");
        assert!(!NoiseFloor::default().is_voice(0.19, 0.0), "never below the old fixed bar");
    }

    #[test]
    fn a_hands_free_take_ends_when_no_new_words_come() {
        let (mut v, _jobs, wav) = voice();
        v.toggle();
        v.on_level(0.5);
        v.read_len = RATE as usize * 2;
        v.on_text(v.take, "turn on the".into(), false);
        assert_eq!(v.heard_len, RATE as usize * 2);
        // More sound, but a re-read that only changes punctuation or case isn't new words.
        v.read_len = RATE as usize * 5;
        v.on_text(v.take, "Turn on the.".into(), false);
        assert_eq!(v.heard_len, RATE as usize * 2);
        v.voice_at = v.now();
        v.heard_at = v.now();
        v.tick();
        assert_eq!(v.phase, Phase::HandsFree, "3 s without new words: still listening");
        v.read_len = RATE as usize * 7;
        v.tick();
        assert_eq!(v.phase, Phase::Finishing, "5 s of sound without new words ends it, noise or not");
        let _ = std::fs::remove_file(wav);
    }

    #[test]
    fn the_mic_list_names_each_mic_once() {
        let names = ["USB Mic", "Built-in", "USB Mic", "", "Headset"].map(String::from);
        assert_eq!(audio::unique(names), ["USB Mic", "Built-in", "Headset"]);
    }

    #[test]
    fn words_ignores_case_and_punctuation() {
        assert_eq!(words("Turn on the, lights."), "turn on the lights");
        assert_eq!(words("  Hello   there "), words("hello there!"));
        assert_ne!(words("hello there"), words("hello there friend"));
    }

    #[test]
    fn toggle_without_a_speech_model_stays_idle() {
        let (tx, _events) = mpsc::channel();
        let mut v = Voice::new(None, None, tx);
        v.toggle();
        assert_eq!(v.phase, Phase::Idle);
        assert!(v.source.is_none());
    }

    #[test]
    fn a_toggled_take_with_nothing_said_ends_without_a_read() {
        let (mut v, jobs, wav) = voice();
        v.toggle();
        v.toggle();
        v.tail_until = Some(0.0);
        v.tick();
        assert!(jobs.try_recv().is_err(), "silence isn't read (Parakeet makes words up from it)");
        assert_eq!(v.phase, Phase::Idle);
        let _ = std::fs::remove_file(wav);
    }

    fn wake_cmd(v: &mut Voice, cmd: &str, on: bool) {
        v.handle(Ev::Cmd(json!({ "cmd": cmd, "on": on })));
    }

    // Wake listening with something said: the voice starts, then it's been going long enough to be read.
    fn heard_something(v: &mut Voice, jobs: &Receiver<Job>) -> Job {
        v.floor = NoiseFloor::default(); // a quiet room
        v.on_level(0.6);
        assert!(v.utter.is_some(), "a voice marks the start of what's said");
        v.utter_at -= WAKE_LONGEST;
        v.tick();
        let job = jobs.try_recv().expect("one wake read");
        assert!(job.wake && !job.last);
        v.tick();
        assert!(jobs.try_recv().is_err(), "one read per thing said, and one at a time");
        job
    }

    #[test]
    fn the_wake_phrase_starts_a_hands_free_take_without_itself() {
        let (mut v, jobs, wav) = voice();
        v.tick();
        assert_eq!(v.phase, Phase::Idle, "the wake word is off: the mic stays closed");
        assert!(v.source.is_none());
        wake_cmd(&mut v, "wake", true);
        v.tick();
        assert_eq!(v.phase, Phase::Wake);
        assert!(v.source.is_some(), "the mic is open for the phrase");
        let job = heard_something(&mut v, &jobs);
        v.handle(Ev::Text { take: job.take, text: "Hey Roamies, what time".into(), last: false, wake: true });
        assert_eq!(v.phase, Phase::HandsFree);
        assert!(v.woke);
        assert_eq!(v.best, "what time");
        assert!(v.source.is_some(), "the same mic carries on into the take");
        // Live reads cover the phrase too; it comes off, also when a later reading of it no longer matches.
        v.on_text(v.take, "Hey Roamies, what time is it".into(), false);
        assert_eq!(v.best, "what time is it");
        v.toggle();
        v.tail_until = Some(0.0);
        v.tick();
        let last = jobs.try_recv().expect("a closing read");
        assert!(last.last && !last.wake);
        v.on_text(last.take, "Hey Romy's, what time is it?".into(), true);
        assert_eq!(v.phase, Phase::Idle);
        assert_eq!(v.best, "what time is it?", "the final text is only the request");
        assert!(!v.woke);
        v.tick();
        assert_eq!(v.phase, Phase::Idle, "a short rest after a take before listening again");
        v.wake_cooldown_until = 0.0;
        v.tick();
        assert_eq!(v.phase, Phase::Wake);
        let _ = std::fs::remove_file(wav);
    }

    #[test]
    fn other_talk_keeps_listening_for_the_phrase() {
        let (mut v, jobs, wav) = voice();
        wake_cmd(&mut v, "wake", true);
        v.tick();
        let job = heard_something(&mut v, &jobs);
        v.handle(Ev::Text { take: job.take, text: "so I told him hey Roamies".into(), last: false, wake: true });
        assert_eq!(v.phase, Phase::Wake, "not at the start: no take");
        assert!(!v.wake_reading);
        // Once it's quiet, the next thing said gets its own read; meanwhile only the last moment of sound is kept.
        v.voice_at -= WAKE_PAUSE;
        v.buf.lock().unwrap().extend(vec![0.0; RATE as usize * 3]);
        v.tick();
        assert!(v.utter.is_none());
        assert!(v.buf.lock().unwrap().len() <= (WAKE_KEEP * RATE as f64) as usize + RATE as usize / 10);
        heard_something(&mut v, &jobs);
        let _ = std::fs::remove_file(wav);
    }

    #[test]
    fn holding_the_wake_word_closes_the_mic_and_drops_its_read() {
        let (mut v, jobs, wav) = voice();
        wake_cmd(&mut v, "wake", true);
        v.tick();
        let job = heard_something(&mut v, &jobs);
        wake_cmd(&mut v, "wake_hold", true);
        assert_eq!(v.phase, Phase::Idle);
        assert!(v.source.is_none(), "the mic is off while Roamies answers");
        v.handle(Ev::Text { take: job.take, text: "Hey Roamies".into(), last: false, wake: true });
        v.tick();
        assert_eq!(v.phase, Phase::Idle, "the read that was under way doesn't wake it");
        wake_cmd(&mut v, "wake_hold", false);
        v.tick();
        assert_eq!(v.phase, Phase::Wake);
        wake_cmd(&mut v, "wake", false);
        assert_eq!(v.phase, Phase::Idle);
        assert!(v.source.is_none());
        let _ = std::fs::remove_file(wav);
    }

    #[test]
    fn the_talk_chord_during_wake_listening_starts_a_normal_take() {
        let (mut v, _jobs, wav) = voice();
        wake_cmd(&mut v, "wake", true);
        v.tick();
        assert_eq!(v.phase, Phase::Wake);
        let now = v.now();
        v.tick_keys(now, keys::Held { mods: v.chord, altgr: false });
        assert_eq!(v.phase, Phase::Armed);
        assert!(v.source.is_some(), "the mic opened again for the take");
        assert!(!v.woke);
        let _ = std::fs::remove_file(wav);
    }

    #[test]
    fn wake_listening_backs_off_when_the_mic_keeps_failing() {
        let (mut v, _jobs, wav) = voice();
        let waits: Vec<f64> = (0..5)
            .map(|_| {
                v.wake_started_at = 100.0;
                v.back_off_wake(101.0);
                v.wake_retry_at - 101.0
            })
            .collect();
        assert_eq!(waits, [5.0, 30.0, 120.0, 600.0, 600.0]);
        let _ = std::fs::remove_file(wav);
    }

    #[test]
    fn a_mic_error_tells_the_app_why() {
        let v = mic_error(&MicError::new("busy", "device in use"));
        assert_eq!(v["code"], "no_input", "the code older app builds already handle");
        assert_eq!(v["reason"], "busy");
        assert_eq!(v["message"], "device in use");
    }

    #[test]
    fn losing_the_mic_mid_take_ends_it_and_idle_ignores_it() {
        let (mut v, _jobs, wav) = voice();
        v.handle(Ev::AudioFailed(MicError::new("lost", "unplugged")));
        assert_eq!(v.phase, Phase::Idle, "nothing to end while idle");
        v.toggle();
        assert_eq!(v.phase, Phase::HandsFree);
        v.handle(Ev::AudioFailed(MicError::new("lost", "unplugged")));
        assert_eq!(v.phase, Phase::Idle, "the take ends");
        assert!(v.source.is_none(), "the microphone is off");
        let _ = std::fs::remove_file(wav);
    }
}
