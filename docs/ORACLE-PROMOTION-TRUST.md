# Oracle promotion trust model

Oracle is the sole production target. Windows is development-only and is never a
promotion target or public-origin fallback.

## Trust roots

The promotion verifier reads these versioned, fixed paths:

- `scripts/reconciliation/trust/oracle-promotion-authority.v1.pem`
- `scripts/reconciliation/trust/oracle-write-freeze-authority.v1.pem`

They are verification-only Ed25519 public keys. No private key is stored in this
repository. Their SHA-256 fingerprints are compiled into
`oracle-main-promotion.mjs`; a replacement, symlink, or writable POSIX trust-root
file fails closed. Environment variables cannot replace either path or key.

Replacing a trust root is a separate reviewed, versioned change: add a new
versioned public-key file, update its pinned fingerprint and verifier version,
run the adversarial tests, and obtain independent operational approval. Rotation
does not happen through an invocation argument.

## Operational inputs

The invoking process may provide only:

- `MEGADESK_PROMOTION_AUTHORIZATION_FILE`: a promotion authorization signed by
  the promotion authority;
- `MEGADESK_PROMOTION_FREEZE_EVIDENCE_FILE`: an independently signed freeze
  attestation; and
- the operation ID and human proof required by that signed authorization.

The freeze authority receives a durable freeze request outside the promotion
process, then emits signed evidence for that request. Promotion never consumes a
request file; authorization and evidence carry the same durable request ID.

An authorization binds a single operation, candidate database/storage identities,
the exact Git commit both as the authorization release and as the candidate
artifact release identity, and the SHA-256 of the required freeze-evidence artifact.
Freeze evidence independently binds its freeze ID, operation ID, Git commit,
Oracle hostname/database, active state, drained writers, and expiry.

The promotion workflow never creates freeze evidence. Until a trusted operational
freeze producer exists, production promotion remains fail-closed with
`FREEZE_EVIDENCE_REQUIRED` or `FREEZE_EVIDENCE_SIGNATURE_INVALID`.

## Release identity

Before the first destructive write, the workflow obtains the candidate identity
from a clean Git checkout (`HEAD` plus no tracked modifications). That immutable
commit must equal the commit signed in the authorization and the commit attested
by freeze evidence, including the candidate-artifact release field. A branch
name, tag, or environment-supplied SHA is not an accepted substitute.

## Rehearsal status

`oracle-main-promotion-rehearsal.mjs` is deliberately
`BLOCKED_ENVIRONMENT`: its former self-generated test key is no longer trusted.
It exits before Docker inspection or resource creation until a separately
reviewed, independently provisioned source of root-signed authorization and
freeze-evidence fixtures exists. It is not a production promotion path and its
blocked state is not a passing physical rehearsal.
