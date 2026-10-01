# MegaDesk write freeze

This module is a server-side, fail-closed write barrier for a separately authorized Windows-to-Oracle cutover. Adding it does not activate a freeze. Activation requires a loopback request and the separately provisioned `MEGADESK_WRITE_FREEZE_CONTROL_TOKEN`.

## Covered writers

- Every tRPC mutation, including public, isolated, tenant, admin and MegaAdmin procedures.
- Unsafe HTTP methods (`POST`, `PUT`, `PATCH`, `DELETE`) and the write-capable OAuth callback (`GET /api/oauth/callback`).
- Evolution and Meta webhooks, which switch to durable quarantine while frozen.
- Ticket-attachment reconciliation and Evolution retry/scheduling workers.
- The covered entry points include messages, uploads/media, CRM, suppliers, stock, purchases, finance, tickets and settings because those domains write through tRPC or the guarded HTTP ingress.

Health checks, ordinary `GET`/`HEAD`, CORS `OPTIONS`, diagnostic client-error logging and read-only Socket.IO transport remain available. Operational session resolution on read paths uses the no-touch resolver so it does not update `last_used_at`.

## Boundary and durable state

Activation first atomically persists `draining`. From then on no writer receives a new lease. Writers admitted before that transition retain their lease and activation waits until `ACTIVE_WRITERS=0`; only then is `active` persisted. Thus a final snapshot must be taken only after status reports both `activeWriters=0` and `inFlightWrites=0`.

State is checksummed and atomically replaced after file and directory synchronization. Independent Node processes coordinate through checksummed process locks and one durable file per writer lease. Admission, lease release, activation and dead-process reclamation share the same interprocess state lock; `active` is therefore impossible while a live writer lease remains. A dead writer lease is reclaimed only during explicit activation after its PID is proven dead. PID reuse or ambiguous lock ownership stays fail-closed.

Restart in `draining` or `active` stays fail-closed. Invalid state becomes `corrupt` and also denies writes. Freeze state and the webhook quarantine live below `MEGADESK_WRITE_FREEZE_ROOT`; if absent, the Windows runtime derives a private location from `MEGADESK_MEDIA_ROOT` or `LOCALAPPDATA`. The root, lock, lease and spool directory chain rejects symlinks/reparse points and paths outside that root.

## Webhook quarantine

During freeze, each webhook is authenticated and bound to authoritative tenant/integration records before it can be spooled. The record contains a monotonically ordered sequence, provider identity, tenant/integration bindings, payload hash, record checksum and deterministic idempotency key. It is fsynced before HTTP 202. Invalid, unknown, oversized, corrupt or capacity-exhausted events receive non-success so the provider must retry.

Defaults are 1 MiB per event, 10,000 pending events and 1 GiB pending bytes. Duplicate and concurrent deliveries produce one logical file. The quarantine is excluded from the business-storage manifest and must be measured separately through `webhooksSpooled` and `webhookSpoolBytes`.

Replay is never automatic. A future authorized gate must unfreeze only at the selected destination, call `replayWebhookSpool` explicitly, and process the supplied idempotency key transactionally. Files move to the replayed directory only after successful processing; a crash before that move safely retries the same identity. Replay is itself single-owner across processes.

## Future operational gate

1. Provision a private absolute freeze root and a strong control token on Windows.
2. Record database fingerprint, business-storage manifest and spool metrics.
3. Activate locally and verify `mode=active`, `activeWriters=0`, `inFlightWrites=0`.
4. Recompute database and business-storage stability before capturing the final delta.
5. If any later gate fails before the point of no return, call the authenticated local unfreeze endpoint. Quarantine files remain intact.
6. Replay requires a separate explicit authorization after promotion.

No database schema change or migration is required by this mechanism.
