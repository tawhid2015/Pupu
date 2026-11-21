// The type-to-ask shortcut: a quick tap of two modifier keys with nothing else. A pure state machine, fed the keys
// held on every beat of the shell's cursor loop (main.rs), so it works with voice off and is tested without a keyboard.

pub const CONTROL: u8 = 1;
pub const OPTION: u8 = 2;
pub const SHIFT: u8 = 4;
pub const COMMAND: u8 = 8;
/// A modifier no pair uses (Fn on a Mac, AltGr): held, it spoils a tap.
pub const OTHER_MOD: u8 = 16;

/// Down and back up within this long counts as a tap; longer is a hold, which is someone doing something else.
const TAP_MS: u64 = 600;

/// The pair as bits, from the names the sidecar sends (the talk keys' names). None unless it's two different ones.
pub fn mask(names: &[String]) -> Option<u8> {
    let mut m = 0u8;
    for n in names {
        m |= match n.as_str() {
            "control" => CONTROL,
            "option" => OPTION,
            "shift" => SHIFT,
            "command" => COMMAND,
            _ => return None,
        };
    }
    (names.len() == 2 && m.count_ones() == 2).then_some(m)
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum State {
    /// No modifier is held.
    Idle,
    /// Part or all of the pair is held and nothing else has been; `full` once both were down together.
    Pressing { since: u64, full: bool },
    /// Something else joined in, or it was held too long: nothing fires until every modifier is up again.
    Spoiled,
}

pub struct Tap(State);

impl Tap {
    pub const fn new() -> Self {
        Tap(State::Idle)
    }

    /// One beat: `chord` is the pair (0: no shortcut), `mods` the modifiers held now, `other` says whether any
    /// other key or a mouse button is down (asked only while a tap is under way, as it costs more to find out).
    /// True once, on the beat the last key of a clean tap comes up.
    pub fn step(&mut self, chord: u8, mods: u8, other: impl FnOnce() -> bool, now_ms: u64) -> bool {
        if chord == 0 {
            self.0 = State::Idle;
            return false;
        }
        if mods == 0 {
            let fired = matches!(self.0, State::Pressing { since, full: true } if now_ms.saturating_sub(since) <= TAP_MS);
            self.0 = State::Idle;
            return fired;
        }
        let (since, full) = match self.0 {
            State::Spoiled => return false,
            State::Idle => (now_ms, false),
            State::Pressing { since, full } => (since, full),
        };
        self.0 = if mods & !chord != 0 || now_ms.saturating_sub(since) > TAP_MS || other() {
            State::Spoiled
        } else {
            State::Pressing { since, full: full || mods == chord }
        };
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PAIR: u8 = OPTION | COMMAND;
    const NO: fn() -> bool = || false;
    const YES: fn() -> bool = || true;

    /// Plays beats of (modifiers held, something else down) 8 ms apart and counts how often the tap fired.
    fn play(chord: u8, beats: &[(u8, bool)]) -> usize {
        let mut tap = Tap::new();
        beats.iter().enumerate().filter(|(i, (mods, other))| tap.step(chord, *mods, if *other { YES } else { NO }, *i as u64 * 8)).count()
    }

    #[test]
    fn a_clean_tap_fires_once_when_the_keys_come_up() {
        let tap = [(0, false), (OPTION, false), (PAIR, false), (PAIR, false), (COMMAND, false), (0, false), (0, false)];
        assert_eq!(play(PAIR, &tap), 1);
        assert_eq!(play(PAIR, &[(PAIR, false), (0, false)]), 1, "both keys seen down on the same beat");
        // Twice in a row: once each.
        assert_eq!(play(PAIR, &[tap.as_slice(), tap.as_slice()].concat()), 2);
        let mut t = Tap::new();
        assert!(!t.step(PAIR, PAIR, NO, 0), "nothing while the keys are still down");
        assert!(t.step(PAIR, 0, NO, 100));
        assert!(!t.step(PAIR, 0, NO, 108), "and only once");
    }

    #[test]
    fn half_the_pair_is_not_a_tap() {
        assert_eq!(play(PAIR, &[(OPTION, false), (0, false)]), 0);
        assert_eq!(play(PAIR, &[(OPTION, false), (0, false), (COMMAND, false), (0, false)]), 0, "one after the other");
    }

    #[test]
    fn a_key_or_a_mouse_button_with_the_pair_is_someone_elses_shortcut() {
        assert_eq!(play(PAIR, &[(OPTION, false), (PAIR, false), (PAIR, true), (PAIR, false), (0, false)]), 0, "Option+Command+Esc, or a drag");
        assert_eq!(play(PAIR, &[(OPTION, true), (PAIR, false), (0, false)]), 0, "a key already held when the pair goes down");
        // After it's all let go, a clean tap works again.
        assert_eq!(play(PAIR, &[(PAIR, true), (0, false), (PAIR, false), (0, false)]), 1);
    }

    #[test]
    fn another_modifier_spoils_it() {
        assert_eq!(play(PAIR, &[(PAIR, false), (PAIR | SHIFT, false), (PAIR, false), (0, false)]), 0);
        assert_eq!(play(PAIR, &[(CONTROL, false), (CONTROL | OPTION, false), (0, false)]), 0, "the talk keys");
        assert_eq!(play(PAIR, &[(CONTROL, false), (PAIR, false), (0, false)]), 0, "started with another modifier");
        assert_eq!(play(PAIR, &[(PAIR | OTHER_MOD, false), (0, false)]), 0, "Fn or AltGr");
    }

    #[test]
    fn a_long_hold_is_not_a_tap() {
        let mut t = Tap::new();
        assert!(!t.step(PAIR, PAIR, NO, 0));
        assert!(!t.step(PAIR, PAIR, NO, 400));
        assert!(!t.step(PAIR, 0, NO, 700), "let go too late");
        let mut t = Tap::new();
        assert!(!t.step(PAIR, OPTION, NO, 0));
        assert!(!t.step(PAIR, PAIR, NO, 500));
        assert!(!t.step(PAIR, PAIR, NO, 650));
        assert!(!t.step(PAIR, 0, NO, 660), "timed from the first key down");
        assert!(!t.step(PAIR, PAIR, NO, 1000));
        assert!(t.step(PAIR, 0, NO, 1100), "the next tap is fresh");
    }

    #[test]
    fn other_keys_are_only_looked_at_during_a_tap() {
        let mut t = Tap::new();
        let boom = || -> bool { panic!("asked about other keys outside a tap") };
        assert!(!t.step(PAIR, 0, boom, 0));
        assert!(!t.step(PAIR, PAIR | SHIFT, boom, 8), "another modifier already rules it out");
        assert!(!t.step(PAIR, PAIR, boom, 16), "spoiled: no need to look");
        assert!(!t.step(PAIR, 0, boom, 24));
    }

    #[test]
    fn no_pair_set_never_fires() {
        assert_eq!(play(0, &[(PAIR, false), (0, false), (OPTION | COMMAND, false), (0, false)]), 0);
        // Switched off mid-tap, then on again: the half-seen tap is dropped.
        let mut t = Tap::new();
        assert!(!t.step(PAIR, PAIR, NO, 0));
        assert!(!t.step(0, PAIR, NO, 8));
        assert!(!t.step(PAIR, 0, NO, 16));
    }

    #[test]
    fn pairs_are_two_different_known_modifiers() {
        let m = |a: &[&str]| mask(&a.iter().map(|s| s.to_string()).collect::<Vec<_>>());
        assert_eq!(m(&["option", "command"]), Some(PAIR));
        assert_eq!(m(&["control", "shift"]), Some(CONTROL | SHIFT));
        assert_eq!(m(&["option", "option"]), None);
        assert_eq!(m(&["option"]), None);
        assert_eq!(m(&["control", "option", "shift"]), None);
        assert_eq!(m(&["control", "hyper"]), None);
    }
}
