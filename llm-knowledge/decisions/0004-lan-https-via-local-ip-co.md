---
title: Publicly trusted certificates for LAN addresses
updated: 2026-09-19
tags: [decision, networking, ios, https]
status: current
code:
  - `scripts/setup-certs.mjs`
  - `vite.config.ts`
---

# 0004 — Publicly trusted certificates for LAN addresses

## Context

iOS refuses `DeviceMotion` outside a secure context — see
[[ios-motion-permission]]. The phone must therefore reach the Mac over HTTPS, at
a LAN address, with a certificate Safari trusts. That requirement collides
head-on with the "zero friction setup" principle in `PRODUCT.md`.

## Decision

Serve on `<lan-ip-with-dashes>.my.local-ip.co`, using the publicly trusted
wildcard certificate that local-ip.co publishes for `*.my.local-ip.co`.
`npm run certs` fetches it into `./certs` (gitignored).

## Why

The hostname resolves via public DNS to whatever private IP is encoded in it, so
`192-168-1-42.my.local-ip.co` resolves to `192.168.1.42`. The certificate is
issued by GlobalSign and already in every device's trust store. A guest scans
the QR code and it just works: no CA install, no tap-through warning, nothing
typed.

Verified end to end on 2026-09-19 — see [[2026-09-19-lan-tls-verification]].

## Alternatives rejected

- **mkcert with a per-device CA install.** Fully offline and self-contained, but
  every guest installs a root CA — on iOS that is Settings, Profile Downloaded,
  install, then *Certificate Trust Settings* to enable it. That is a five-step
  wall in front of a party game, and asking guests to trust your root CA is a
  genuinely bad thing to teach people to do.
- **A tunnel (ngrok, cloudflared).** Works anywhere with no setup, but routes
  living-room gameplay through the public internet, adds latency to a game about
  timing, and breaks the local-first principle outright.
- **Plain HTTP.** Not an option. iOS simply does not expose the sensors.

## Known costs — read these before relying on it

1. **The private key is public by design.** Anyone can download it. This buys
   browser *trust*, not *secrecy* — someone on your LAN could MITM the session.
   Acceptable for a tennis game with no accounts and no secrets on the wire.
   It would not be acceptable for anything else, so do not reuse this pattern.
2. **Short-lived.** The cert fetched on 2026-09-19 expires **2026-12-22**.
   `npm run certs` re-fetches when fewer than 7 days remain.
3. **First resolution needs internet**, which is in mild tension with
   local-first. Gameplay itself stays local; only the initial DNS lookup does
   not. DNS caching covers a repeat session on the same network.
4. **Some routers block it.** This bit us immediately on the dev machine — see
   [[lan-https-dns-rebind]].
5. **Their published chain cannot be trusted to match the leaf.** It did not on
   2026-09-19, and the resulting chain fails on iOS while appearing fine on
   macOS. `npm run certs` builds the chain from the leaf's AIA extension and
   verifies it — see [[lan-https-cert-chain]].
6. **Third-party dependency.** If local-ip.co disappears, the fallback is mkcert
   with the friction described above. Nothing else in the design depends on it.
