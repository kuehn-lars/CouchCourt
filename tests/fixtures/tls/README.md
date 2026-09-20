# Throwaway TLS fixture

A self-signed `CN=localhost` keypair, committed on purpose. It secures
nothing: it exists so `tests/integration/tls-relay.test.ts` can build the
**same kind of server Vite builds** — `http2.createSecureServer({ allowHTTP1:
true })`, which is what `resolveHttpServer` returns for any `https` option,
in dev and in preview alike.

Never use it for anything. The real LAN certificates come from
`npm run certs` into `./certs`, which is gitignored — see
`llm-knowledge/decisions/0004-lan-https-via-local-ip-co.md`.
