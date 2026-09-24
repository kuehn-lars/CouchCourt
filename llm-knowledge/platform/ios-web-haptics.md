---
title: iOS Safari cannot vibrate from a web page
updated: 2026-09-25
tags: [platform, ios, safari, haptics]
status: current
code:
  - `src/controller/main.ts`
---

# iOS Safari cannot vibrate from a web page

The phone has no haptic feedback, deliberately. Removed 2026-09-25. Do not add
it back without a real iPhone showing it working.

- **`navigator.vibrate` does not exist in iOS Safari.** It is a Chrome/Android
  API. Calling it with `?.` fails silently.
- **The `<label><input type="checkbox" switch>` trick is dead.** From iOS 17.4,
  calling `label.click()` from code made Safari play the switch's system tick.
  iOS 26.5 closed it: WebKit marks the click the label forwards as untrusted
  when the click on the label was untrusted, and gives no haptic for that.
  (Source: reports from the ios-haptics and @haptics libraries, not an Apple
  note.)
- **The surviving workaround needs a real finger on a real switch.** A swing is
  `devicemotion`, not a tap, and our `feedback` arrives over a WebSocket. So even
  before 26.5 our buzz ran with no user gesture, and it was never seen working
  on a phone.

On iPhone the screen is the only feedback channel: the colour-wash flash and
the racket's hit/point/miss animation.
