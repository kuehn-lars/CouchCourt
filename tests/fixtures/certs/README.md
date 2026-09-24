# Test certificate chain

A throwaway chain for `scripts/cert-chain.test.ts`: `root.pem` signs
`intermediate.pem`, which signs two leaves. All of them are valid until 2126,
and both leaves carry an AIA "CA Issuers" URI.

| File | What it is |
| --- | --- |
| `root.pem` | Self-signed CA. The tests pass it as the only trusted root |
| `short-lived-root.pem` | The same key and name as `root.pem`, valid for one day in September 2026. Everything below it verifies against it, so only the root's own expiry is wrong |
| `intermediate.pem` / `.der` | The issuing CA; the DER copy stands in for what an AIA URL serves |
| `impostor-intermediate.pem` | Also `CN=Test Intermediate`, also signed by the root, but a different key and no subject key identifier. It passes the name and key-ID checks, so only a signature check can tell that it did not sign the leaf |
| `leaf.pem` | SAN `*.my.local-ip.co`, the shape local-ip.co issues |
| `wrong-name-leaf.pem` | SAN `*.local-ip.co`, a valid chain for the wrong name |

The private keys were discarded. Nothing here is trusted anywhere else. The
key-matching tests use the keypair in `tests/fixtures/tls/` instead.

Regenerated with OpenSSL 3 (only these fixtures need it; the script itself
does not). OpenSSL 3 adds key identifiers by default, which is why the
impostor has to opt out of one:

```bash
cat > ext.cnf <<'CNF'
[ca]
basicConstraints=critical,CA:TRUE
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
[impostor]
basicConstraints=critical,CA:TRUE
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=none
[leaf]
basicConstraints=CA:FALSE
subjectAltName=DNS:*.my.local-ip.co
authorityInfoAccess=caIssuers;URI:http://ca.example.test/intermediate.crt
[other]
basicConstraints=CA:FALSE
subjectAltName=DNS:*.local-ip.co
authorityInfoAccess=caIssuers;URI:http://ca.example.test/intermediate.crt
CNF
ROOT_EXT=(-addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign")
openssl req -x509 -newkey rsa:2048 -nodes -keyout root.key -out root.pem \
  -subj "/CN=Test Root" -days 36500 "${ROOT_EXT[@]}"
openssl req -x509 -key root.key -out short-lived-root.pem \
  -subj "/CN=Test Root" -days 1 "${ROOT_EXT[@]}"
openssl req -newkey rsa:2048 -nodes -keyout int.key -out int.csr -subj "/CN=Test Intermediate"
openssl x509 -req -in int.csr -CA root.pem -CAkey root.key -CAcreateserial \
  -out intermediate.pem -days 36500 -extfile ext.cnf -extensions ca
openssl req -newkey rsa:2048 -nodes -keyout imp.key -out imp.csr -subj "/CN=Test Intermediate"
openssl x509 -req -in imp.csr -CA root.pem -CAkey root.key -CAcreateserial \
  -out impostor-intermediate.pem -days 36500 -extfile ext.cnf -extensions impostor
for n in leaf other; do
  openssl req -newkey rsa:2048 -nodes -keyout $n.key -out $n.csr -subj "/CN=*.my.local-ip.co"
  openssl x509 -req -in $n.csr -CA intermediate.pem -CAkey int.key -CAcreateserial \
    -out $n.pem -days 36500 -extfile ext.cnf -extensions $n
done
mv other.pem wrong-name-leaf.pem
openssl x509 -in intermediate.pem -outform DER -out intermediate.der
```
