import AppKit

// Which displays a panel was built for, and whether it has to be built again. A borderless panel made while one set of
// displays was attached has been seen to stop being drawn once the set changes (a monitor plugged in, the laptop lid
// closed): it still fades to alpha 1 beside the cursor, but the window server reports it off screen, while a panel made
// after the change draws normally. The listening pill (wave.swift) and the drawing layer (ink.swift) both ask
// screensChanged.

/// One display: its frame in global points and its CGDirectDisplayID (0 if the screen doesn't report one).
struct ScreenKey: Equatable {
    var x: Double, y: Double, w: Double, h: Double
    var id: UInt32

    /// A fixed order, so the order NSScreen lists the displays in never counts as a change.
    fileprivate var order: [Double] { [Double(id), x, y, w, h] }
}

/// The displays attached now: every frame together with its display id, so swapping one display for another of the
/// same size is a change too.
func currentScreenKeys(_ screens: [NSScreen] = NSScreen.screens) -> [ScreenKey] {
    screens.map { s in
        let id = (s.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0
        return ScreenKey(x: Double(s.frame.minX), y: Double(s.frame.minY), w: Double(s.frame.width), h: Double(s.frame.height), id: id)
    }
}

/// True when a panel built for `built` has to be built again for `now`. Never when no display is attached (a display
/// that is asleep reports none): the old panel stays until there is a screen again.
func screensChanged(built: [ScreenKey], now: [ScreenKey]) -> Bool {
    if now.isEmpty { return false }
    let key = { (a: ScreenKey, b: ScreenKey) in a.order.lexicographicallyPrecedes(b.order) }
    return built.sorted(by: key) != now.sorted(by: key)
}
