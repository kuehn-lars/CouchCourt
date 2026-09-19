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

**3. Does a real TLS handshake validate?** Yes *on macOS* — which, as the
correction above records, turned out not to be the same question. A Node `https`
server using the fetched key and chain, fetched with strict verification against
the system trust store (no `-k`), returned the expected body:

```
curl --resolve 192-168-178-26.my.local-ip.co:8443:127.0.0.1 \
     https://192-168-178-26.my.local-ip.co:8443/
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

## Not yet verified

**The actual iPhone.** Everything above was tested on macOS. That distinction
already produced one wrong conclusion in this note, so treat it as load-bearing:
`Verify return code: 0 (ok)` is a much stronger signal than a successful curl,
but it is still not a phone. The first session with a phone to hand should
confirm the page loads and `DeviceMotionEvent.requestPermission()` resolves —
see [[ios-motion-permission]] — and update this note with the result.
