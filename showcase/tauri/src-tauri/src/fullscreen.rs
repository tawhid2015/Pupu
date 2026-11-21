// macOS: games in their own fullscreen (GLFW, e.g. Minecraft, and SDL put a screen-sized window above the menu bar)
// hide the cursor and pin it in place. While one is in front, the overlays let every click through and the Sidekick
// stops following the cursor (host.js, agent.js), so it doesn't park by the crosshair or take the game's clicks.
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::{thread, time::Duration};

use objc2::rc::autoreleasepool;
use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use tauri::{AppHandle, Manager};

use crate::snapshot::ns_string;

pub(crate) static GAME: AtomicBool = AtomicBool::new(false);

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGWindowListCopyWindowInfo(option: u32, relative_to_window: u32) -> *const c_void;
    fn CGRectMakeWithDictionaryRepresentation(dict: *const c_void, rect: *mut Rect) -> bool;
    fn CGGetActiveDisplayList(max: u32, displays: *mut u32, count: *mut u32) -> i32;
    fn CGDisplayBounds(display: u32) -> Rect;
}
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(cf: *const c_void);
}

const ON_SCREEN_ONLY: u32 = 1 << 0;
const EXCLUDE_DESKTOP: u32 = 1 << 4;

pub(crate) fn watch(app: AppHandle) {
    thread::spawn(move || {
        let mut n: u32 = 0;
        loop {
            thread::sleep(Duration::from_millis(500));
            if crate::sidecar::QUITTING.load(Ordering::SeqCst) {
                return;
            }
            n = n.wrapping_add(1);
            let on = game_in_front();
            let was = GAME.swap(on, Ordering::Relaxed);
            if on != was {
                eprintln!("[fullscreen] game {}", if on { "in front" } else { "gone" });
            }
            // Told again every 2 s while it lasts: overlays rebuilt meanwhile start out not knowing.
            if on != was || (on && n.is_multiple_of(4)) {
                if on {
                    crate::OVERLAY_HOT.store(false, Ordering::Relaxed);
                }
                for (label, w) in app.webview_windows() {
                    if crate::is_overlay(&label) {
                        if on {
                            let _ = w.set_ignore_cursor_events(true);
                        }
                        let _ = w.eval(format!("window.__roamieGame&&__roamieGame({on})"));
                    }
                }
            }
        }
    });
}

/// The app in front has a window above the normal level covering a whole screen.
fn game_in_front() -> bool {
    autoreleasepool(|_| unsafe {
        let ws: *mut AnyObject = msg_send![class!(NSWorkspace), sharedWorkspace];
        let front: *mut AnyObject = msg_send![ws, frontmostApplication];
        if front.is_null() {
            return false;
        }
        let pid: i32 = msg_send![front, processIdentifier];
        if pid == std::process::id() as i32 {
            return false;
        }
        let displays = displays();
        let list = CGWindowListCopyWindowInfo(ON_SCREEN_ONLY | EXCLUDE_DESKTOP, 0);
        if list.is_null() {
            return false;
        }
        let windows = list as *mut AnyObject; // CFArray of CFDictionary, toll-free bridged to NSArray/NSDictionary
        let (k_pid, k_layer, k_bounds) = (ns_string(c"kCGWindowOwnerPID"), ns_string(c"kCGWindowLayer"), ns_string(c"kCGWindowBounds"));
        let count: usize = msg_send![windows, count];
        let mut found = false;
        for i in 0..count {
            let w: *mut AnyObject = msg_send![windows, objectAtIndex: i];
            let owner: *mut AnyObject = msg_send![w, objectForKey: k_pid];
            let layer: *mut AnyObject = msg_send![w, objectForKey: k_layer];
            let bounds: *mut AnyObject = msg_send![w, objectForKey: k_bounds];
            if owner.is_null() || layer.is_null() || bounds.is_null() {
                continue;
            }
            let owner_pid: i32 = msg_send![owner, intValue];
            if owner_pid != pid {
                continue;
            }
            let level: i32 = msg_send![layer, intValue];
            let mut r = Rect::default();
            if CGRectMakeWithDictionaryRepresentation(bounds as *const c_void, &mut r) && is_game_window(level, r, &displays) {
                found = true;
                break;
            }
        }
        CFRelease(list);
        found
    })
}

fn displays() -> Vec<Rect> {
    let mut ids = [0u32; 16];
    let mut n = 0u32;
    if unsafe { CGGetActiveDisplayList(ids.len() as u32, ids.as_mut_ptr(), &mut n) } != 0 {
        return Vec::new();
    }
    ids[..n as usize].iter().map(|&d| unsafe { CGDisplayBounds(d) }).collect()
}

/// Layer 0 is an ordinary window, which includes apps fullscreen in their own Space (Safari, Xcode): there the
/// cursor is the user's and following it is wanted.
fn is_game_window(layer: i32, r: Rect, displays: &[Rect]) -> bool {
    let near = |a: f64, b: f64| (a - b).abs() < 1.0;
    layer > 0 && displays.iter().any(|d| near(r.x, d.x) && near(r.y, d.y) && near(r.w, d.w) && near(r.h, d.h))
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAIN: Rect = Rect { x: 0.0, y: 0.0, w: 1512.0, h: 982.0 };
    const SIDE: Rect = Rect { x: 1512.0, y: -200.0, w: 1920.0, h: 1080.0 };

    #[test]
    fn a_screen_sized_window_above_the_menu_bar_is_a_game() {
        assert!(is_game_window(25, MAIN, &[MAIN, SIDE]));
        assert!(is_game_window(25, SIDE, &[MAIN, SIDE]));
    }

    #[test]
    fn ordinary_and_partial_windows_are_not() {
        // Fullscreen in its own Space (layer 0), a floating window, a half-screen one.
        assert!(!is_game_window(0, MAIN, &[MAIN, SIDE]));
        assert!(!is_game_window(3, Rect { w: 800.0, ..MAIN }, &[MAIN, SIDE]));
        assert!(!is_game_window(25, Rect { x: 1512.0, ..MAIN }, &[MAIN, SIDE]));
        assert!(!is_game_window(25, MAIN, &[]));
    }
}
