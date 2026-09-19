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
  "hz": 60,                   // MEASURED rate over the capture, not the
                              // nominal one the device reports
  "samples": [
    {
      "t": 0,                 // ms since the FIRST sample (not since the tap)
      "acc": [0, 0, 0],       // accelerationIncludingGravity, m/s^2
      "rot": [0, 0, 0]        // rotationRate alpha/beta/gamma, deg/s
    }
  ]
}
```

## Measure the rate, do not assume it

`hz` is what the capture actually delivered —
`round(1000 * (n - 1) / (t_last - t_first))` — not `1000 / event.interval` and
certainly not a hardcoded 60. The real iOS sample rate is still an open question
in the vault, and a detector gets tuned against whatever these files say. An
unverified constant written into twenty-five fixtures is worse than a wrong note,
because nobody re-reads it before trusting it.

## Grip convention

**iOS `devicemotion` axes are fixed to the device and do not rotate with the
screen.** A trace captured with the phone upright in a portrait grip is not
comparable to one captured with it held like a racket handle — the same swing
lands on different axes. There is no field for this, so the convention is prose
and it is binding:

> Hold the phone in a closed fist like a racket grip. The **top edge points away
> from the wrist**, up the imaginary racket shaft, and the **screen faces the same
> way the palm faces**.

Every trace in this directory uses that grip. If a session finds a grip that
plays better, change this paragraph and **re-record everything** — never mix two
grips inside the fixture set, because the detector cannot tell them apart and
you will spend an evening deciding the sensor is broken.

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

`npm run certs && npm run dev`, then open `/controller/record.html` on the
phone. Tap through the permission gate, pick a label, pick Short (6 s) or Long
(30 s), and the capture starts after a five-second countdown so your hand is in
the grip before sampling begins. Save POSTs to the dev server, which validates
the trace and writes it here under the next free number.

The device and iOS fields are yours to keep honest — the browser does not expose
the model, and sample rate and gravity handling differ between devices and
releases. A fixture without provenance cannot be compared against a later one.

Turn **Low Power Mode off** first. It cannot be detected from JavaScript and
plausibly changes the sample rate.

What these captures actually measured — the real rate, the stall behaviour, and
why a peak-angular-velocity threshold is not enough on its own — is in
`llm-knowledge/experiments/2026-09-19-ios-devicemotion-sampling.md`.
