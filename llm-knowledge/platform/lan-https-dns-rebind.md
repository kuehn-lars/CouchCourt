---
title: Home routers block LAN hostnames (DNS rebind protection)
updated: 2026-09-19
tags: [platform, networking, dns, https]
status: current
code:
  - `scripts/setup-certs.ts`
---

# Home routers block LAN hostnames (DNS rebind protection)

Found on the dev machine on the first attempt, 2026-09-19. This will look like
a broken QR code and it is not.

## Symptom

`192-168-1-42.my.local-ip.co` resolves correctly from a public resolver but
returns nothing on the local network:

```
$ nslookup 192-168-1-42.my.local-ip.co 1.1.1.1
Address: 192.168.1.42           # correct

$ nslookup 192-168-1-42.my.local-ip.co    # router at 192.168.1.1
*** Can't find 192-168-1-42.my.local-ip.co: No answer
```

On the phone this surfaces as "Safari cannot open the page because the server
cannot be found" — indistinguishable from the server not running.

## Cause

Most consumer routers implement **DNS rebind protection**: they drop any answer
from a public DNS server that points into a private address range. That is
precisely what local-ip.co does, so the defence fires on legitimate use.

This is a security feature working as designed, not a bug. It exists to stop a
malicious public website from resolving a name to `192.168.1.1` and attacking
devices on your LAN from inside your browser's origin.

## Fix

Add `my.local-ip.co` to the router's rebind-protection exception list.

**FritzBox** (the box this was found on): Home Network > Network > Network
Settings > DNS Rebind Protection > *Hostname exceptions*.

Other vendors call it "DNS rebind protection", "DNS rebinding attack
prevention", or bury it under dnsmasq's `rebind-domain-ok`.

It is a **one-time change on the router** and it fixes every device on that
network at once, so guests still configure nothing. That is what keeps
[[0004-lan-https-via-local-ip-co]] viable despite this.

## Detection

`npm run certs` resolves the hostname and exits non-zero with these
instructions when it does not match the LAN IP. That check exists purely so this
costs someone five minutes once instead of an evening.

## If the router cannot be changed

Guest networks and other people's routers will not always be fixable. Untested
fallbacks, in rough order of preference:

1. Set the phone's DNS to `1.1.1.1` manually — per-device, so it reintroduces
   guest friction, but it works.
2. Run a tiny DNS responder on the host and hand it out over DHCP — not
   realistic at a party.
3. Fall back to mkcert and accept the CA install.

Nobody has needed these yet. Do not build them until someone does.

**Code map:** [[modules/tooling]]
