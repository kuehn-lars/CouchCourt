---
title: local-ip.co's published chain does not match its leaf
updated: 2026-09-24
tags: [platform, https, ios, certificates]
status: current
code:
  - `scripts/setup-certs.ts`
  - `scripts/cert-chain.ts`
---

# local-ip.co's published chain does not match its leaf

Found 2026-09-19, after [[lan-https-dns-rebind]] was fixed and the page *still*
would not load on a phone. Second distinct cause, same symptom.

## Symptom

The Mac is happy — `curl` over the real hostname returns 200 with strict
verification. The iPhone refuses to load the page, or warns that the server's
identity cannot be verified.

That asymmetry is the whole tell. It looks like a phone problem and it is not.

## Cause

`https://local-ip.co/cert/chain.pem` is **stale relative to the leaf**. On
2026-09-19 the two came from different CAs entirely:

```
leaf     CN=*.my.local-ip.co
         issued by  GlobalSign GCC R6 AlphaSSL CA 2025

chain.pem starts with
         Sectigo Public Server Authentication CA DV R36
```

Concatenating them yields a chain that cannot validate — three Sectigo
certificates that have nothing to do with the GlobalSign leaf:

```
Verify return code: 21 (unable to verify the first certificate)
```

## Why macOS hid it and iOS did not

macOS Security framework performs **AIA fetching**: when a chain is incomplete
or wrong, it reads the leaf's Authority Information Access extension and
downloads the correct intermediate itself. `curl` therefore succeeded against a
chain that was genuinely broken.

iOS Safari is stricter and will not paper over it. **A green result on the Mac
says nothing about the phone.** Verify chains with `openssl s_client`, which
does not rescue you, rather than with a client that does.

## Fix

Do not use `chain.pem`. Build the chain from the leaf's own AIA extension:

```bash
openssl x509 -in server.pem -noout -ext authorityInfoAccess
#   CA Issuers - URI:http://secure.globalsign.com/cacert/gsgccr6alphasslca2025.crt
```

Fetch that (DER — convert to PEM), concatenate onto the leaf, and verify before
writing. `npm run certs` does this, and refuses to write a chain that does not
verify. Reading AIA follows whatever issuer is current, so it survives the next
rotation instead of hard-coding this one.

Since 2026-09-24 the script does this without `openssl`, on `node:crypto`
(`scripts/cert-chain.ts`), so it runs on Windows. The `openssl` commands here
are still the way to check by hand. Node's `X509Certificate` does no AIA
fetching either: like iOS, and unlike macOS, it rejects a leaf-only chain
rather than repairing it, and a unit test pins that.

Correct result:

```
 0 s:CN=*.my.local-ip.co
 1 s:C=BE, O=GlobalSign nv-sa, CN=GlobalSign GCC R6 AlphaSSL CA 2025
Verify return code: 0 (ok)
```

## The transferable lesson

`openssl verify` failed on this chain from the very first run, and that failure
was **explained away** as openssl not reading the macOS keychain. It was not —
openssl was right, and the chain was broken the whole time. A contradicting
signal was dismissed because a more convenient explanation was available, which
cost a full debugging cycle.

When two tools disagree about a certificate, the stricter one is usually
describing reality.

## Checking it quickly

```bash
echo | openssl s_client -connect <lan-ip>:5173 \
  -servername <ip-with-dashes>.my.local-ip.co 2>/dev/null \
  | grep -E "^ *[0-9]+ s:|Verify return code"
```

Anything other than `Verify return code: 0 (ok)` will fail on iOS, whatever the
Mac says.

**Code map:** [[modules/tooling]]
