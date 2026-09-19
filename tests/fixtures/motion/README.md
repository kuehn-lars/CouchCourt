# Recorded motion traces

Captured `devicemotion` samples from a real iPhone, committed as JSON and
replayed in tests so swing detection can be tuned without a phone in hand.

This is the project's main testing leverage. Recording swings is slow and
awkward; replaying them is instant. Record once, iterate forever.

## Format

```jsonc
{
  "label": "forehand",        // or backhand, serve, idle, walking, pocket, gesture
  "device": "iPhone 14 Pro",
  "ios": "26.6.1",
  "hz": 60,                   // nominal sample rate reported by the device
  "samples": [
    {
      "t": 0,                 // ms since capture start
      "acc": [0, 0, 0],       // accelerationIncludingGravity, m/s^2
      "rot": [0, 0, 0]        // rotationRate alpha/beta/gamma, deg/s
    }
  ]
}
```

## Record negatives too

A detector that never misses a forehand but fires when someone sets the phone
down is worse than useless at a party. Capture the boring cases deliberately:
phone resting on a table, in a pocket, someone gesturing while talking, walking
between points.

Name them so the intent is obvious: `forehand-fast-01.json`,
`idle-table-01.json`, `gesture-talking-01.json`.

## Reference device

The project's known-good device is an **iPhone 14 Pro on iOS 26.6.1** — the one
the HTTPS setup was verified on. Traces from it are the baseline; traces from
anything else should say so, since a detector tuned on one device's sample rate
may not hold on another.

## Capturing

No recorder exists yet. The controller needs a debug mode that dumps the sample
buffer — see `CLAUDE.md`. When it exists, note the device and iOS version in
every file, because sample rate and gravity handling differ between them.
