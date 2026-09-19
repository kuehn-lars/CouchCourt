---
title: Verifying LAN HTTPS with a public certificate
updated: 2026-09-19
tags: [experiment, networking, https, ios]
status: current
---

# 2026-09-19 — Verifying LAN HTTPS with a public certificate

Run before committing to [[0004-lan-https-via-local-ip-co]], because that
decision is the one thing that could have made the whole zero-friction premise
unworkable.

## Question

Can a phone reach the Mac over HTTPS at a LAN address, with a certificate
Safari already trusts, and no per-device setup?

## Method and results

**1. Does the hostname resolve?** Yes, via public DNS. Both the dot and dash
forms work:

```
192.168.1.42.my.local-ip.co  -> 192.168.1.42
192-168-1-42.my.local-ip.co  -> 192.168.1.42
```

The dash form is what `npm run certs` emits, because the dotted form adds
labels and a wildcard only covers one.

**2. Is the certificate real?**

```
subject = CN=*.my.local-ip.co
issuer  = C=BE, O=GlobalSign nv-sa, CN=GlobalSign GCC R6 AlphaSSL CA 2025
SAN     = DNS:*.my.local-ip.co, DNS:my.local-ip.co
notAfter= Dec 22 15:16:31 2026 GMT
```

Publicly trusted, and the wildcard covers the single-label host we generate.

**3. Does a real TLS handshake validate?** Yes. A Node `https` server using the
fetched key and chain, fetched with strict verification against the system trust
store (no `-k`), returned the expected body:

```
curl --resolve 192-168-178-26.my.local-ip.co:8443:127.0.0.1 \
     https://192-168-178-26.my.local-ip.co:8443/
swingcourt-tls-ok
```

**4. Does it work on the actual network?** **No** — and this was the useful
part. The dev machine's FritzBox drops the answer via DNS rebind protection.
Cause, fix and detection are written up in [[lan-https-dns-rebind]].

## Gotchas worth keeping

- The endpoints 301-redirect. Follow them or you get 185 bytes of HTML that
  looks like a PEM-shaped failure.
- `server.pem` is **leaf-only**. Serving it alone produced an empty response
  from curl and would fail on iOS, which rejects an incomplete chain. The
  working combination is `server.pem` + `chain.pem` (3 intermediates)
  concatenated — 4 certificates total. `npm run certs` does this.
- `server.chain.pem` sounds like the fullchain file and is not — it returned
  zero certificates.
- `openssl verify` failed on a chain that curl accepted. That is openssl not
  reading the macOS keychain, not a certificate problem. Trust the client that
  matches the real one.

## Not yet verified

**The actual iPhone.** Everything above was tested on macOS with curl. Safari on
iOS is stricter about chains and is the client that matters. The first session
with a phone to hand should confirm the page loads and
`DeviceMotionEvent.requestPermission()` resolves — see
[[ios-motion-permission]] — and update this note with the result.
