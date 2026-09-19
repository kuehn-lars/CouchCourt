---
title: Verifying LAN HTTPS with a public certificate
updated: 2026-09-19
tags: [experiment, networking, https, ios]
status: current
code:
  - `scripts/setup-certs.mjs`
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

**3. Does a real TLS handshake validate?** Yes *on macOS* — which, as the
correction above records, turned out not to be the same question. A Node `https`
server using the fetched key and chain, fetched with strict verification against
the system trust store (no `-k`), returned the expected body:

```
curl --resolve 192-168-1-42.my.local-ip.co:8443:127.0.0.1 \
     https://192-168-1-42.my.local-ip.co:8443/
swingcourt-tls-ok
```

**4. Does it work on the actual network?** **No** — and this was the useful
part. The dev machine's FritzBox drops the answer via DNS rebind protection.
Cause, fix and detection are written up in [[lan-https-dns-rebind]].

## Correction, later the same day

**Two conclusions in the first version of this note were wrong.** Both are
corrected below; the full write-up is [[lan-https-cert-chain]].

- ~~"The working combination is `server.pem` + `chain.pem` concatenated."~~
  **Wrong.** `chain.pem` is stale relative to the leaf — Sectigo intermediates
  for a GlobalSign leaf. That chain does not validate and iOS rejects it. The
  chain must be built from the leaf's own AIA extension instead.
- ~~"`openssl verify` failed because it does not read the macOS keychain."~~
  **Wrong, and the more costly error.** openssl was correct: the chain really
  was broken. A contradicting signal was explained away because a convenient
  explanation was available.

## Gotchas worth keeping

- The endpoints 301-redirect. Follow them or you get 185 bytes of HTML that
  looks like a PEM-shaped failure.
- `server.pem` is **leaf-only**, and iOS rejects an incomplete chain — but do
  not fix that with `chain.pem`. See [[lan-https-cert-chain]].
- `server.chain.pem` sounds like the fullchain file and is not — it returned
  zero certificates.
- **`curl` on macOS is not a valid test of a chain.** It performs AIA fetching
  and silently repairs a broken chain that iOS will reject. Use
  `openssl s_client` and require `Verify return code: 0 (ok)`.

**5. Does the corrected chain validate at the protocol level?** Yes. After
rebuilding from AIA, against the dev server on the LAN address:

```
 0 s:CN=*.my.local-ip.co
 1 s:C=BE, O=GlobalSign nv-sa, CN=GlobalSign GCC R6 AlphaSSL CA 2025
Verify return code: 0 (ok)
```

Both pages return 200 over strict TLS on the real hostname.

**6. Does it work on a real iPhone?** **Yes** — confirmed on an **iPhone 14 Pro
running iOS 26.6.1**, 2026-09-19, after the chain was rebuilt from AIA and the
router's DNS rebind exception was added. The controller page loads over HTTPS on the LAN hostname
with no certificate warning and no per-device setup, which was the entire
premise of [[0004-lan-https-via-local-ip-co]].

Both blockers had to be fixed for this to work; either one alone still fails:

1. Router DNS rebind exception — [[lan-https-dns-rebind]]
2. Certificate chain rebuilt from AIA — [[lan-https-cert-chain]]

## Reference device

Everything iOS-side in this vault was verified on:

| | |
| --- | --- |
| Device | iPhone 14 Pro |
| iOS | 26.6.1 |
| Browser | Safari |

Record this alongside any motion traces captured — see
`tests/fixtures/motion/` — because sample rate and gravity handling differ
between devices and releases, and a fixture without provenance cannot be
compared against a later one.

## Still open

**`DeviceMotionEvent.requestPermission()` is untested.** Page load and sensor
access are two separate iOS gates, and only the first has been cleared — see
[[ios-motion-permission]]. Nothing has called the second one yet, because no
controller code exists.
