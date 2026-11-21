// The wake word end to end (#97): spoken lines go through the real helper and Parakeet model, each recording standing
// in for the microphone. "Hey Roamies, what time is it?" has to start a take by itself and send only the request;
// other talk must not wake it. Needs the speech model and a voice to say the lines, so it's run by hand:
//   ROAMIES_VOICE_MODEL=<model dir> cargo test --features e2e --test wake_e2e -- --ignored --nocapture
// (add --release on Windows and Linux; on macOS only the debug build links). The lines are spoken with macOS `say`;
// elsewhere set ROAMIES_WAKE_WAV and ROAMIES_OTHER_WAV to 16 kHz mono WAVs of them.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// The helper with the wake word on, hearing `line`: whether a take started by the phrase, and what was sent.
/// None when there's no model or recording here (the test is skipped).
fn hear(env: &str, line: &str, wait: Duration) -> Option<(bool, Vec<String>)> {
    let Ok(model) = std::env::var("ROAMIES_VOICE_MODEL") else {
        eprintln!("skipped: set ROAMIES_VOICE_MODEL to the Parakeet model folder");
        return None;
    };
    let dir = std::env::temp_dir().join(format!("roamies-wake-e2e-{}-{env}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let wav = match std::env::var(env) {
        Ok(p) => PathBuf::from(p),
        Err(_) => {
            let wav = dir.join("line.wav");
            if !Command::new("say").arg("-o").arg(&wav).args(["--data-format=LEI16@16000", line]).status().is_ok_and(|s| s.success()) {
                eprintln!("skipped: no `say` here; set {env} to a recording of {line:?}");
                return None;
            }
            wav
        }
    };
    let mut child = Command::new(env!("CARGO_BIN_EXE_roamies-voice"))
        .args(["--model", &model, "--test-audio"])
        .arg(&wav)
        .arg("--wake")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("the helper starts");
    let stdin = child.stdin.take(); // kept open: the helper exits when it closes
    let (tx, rx) = mpsc::channel();
    let out = child.stdout.take().unwrap();
    std::thread::spawn(move || {
        for l in BufReader::new(out).lines().map_while(Result::ok) {
            let _ = tx.send(l);
        }
    });
    let (mut woke, mut finals) = (false, Vec::new());
    let t0 = Instant::now();
    while t0.elapsed() < wait && finals.is_empty() {
        let Ok(l) = rx.recv_timeout(Duration::from_millis(200)) else { continue };
        let v: serde_json::Value = serde_json::from_str(&l).unwrap_or_default();
        if v["type"] != "level" {
            println!("{l}");
        }
        if v["type"] == "state" && v["state"] == "listening" {
            assert_eq!(v["mode"], "wake", "only the phrase starts a take here");
            woke = true;
        }
        if v["type"] == "final" {
            finals.push(v["text"].as_str().unwrap_or_default().to_string());
        }
    }
    drop(stdin);
    let _ = child.kill();
    let _ = child.wait();
    let _ = std::fs::remove_dir_all(&dir);
    Some((woke, finals))
}

#[test]
#[ignore = "needs the speech model (ROAMIES_VOICE_MODEL) and a spoken recording"]
fn hey_roamies_starts_a_take_and_only_the_request_is_sent() {
    let Some((woke, finals)) = hear("ROAMIES_WAKE_WAV", "Hey Roamies, what time is it?", Duration::from_secs(90)) else { return };
    assert!(woke, "hearing \"Hey Roamies\" started a take");
    let text = finals.first().expect("what was said was sent").to_lowercase();
    assert!(text.contains("what time is it"), "the request was heard: {text:?}");
    assert!(!text.contains("hey"), "the wake phrase isn't part of the request: {text:?}");
}

#[test]
#[ignore = "needs the speech model (ROAMIES_VOICE_MODEL) and a spoken recording"]
fn other_talk_does_not_wake_it() {
    let Some((woke, finals)) = hear("ROAMIES_OTHER_WAV", "So I told him the meeting is at noon.", Duration::from_secs(15)) else { return };
    assert!(!woke && finals.is_empty(), "nothing starts and nothing is sent: {finals:?}");
}
