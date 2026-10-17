# Compose consistent-backup restore harness

`scripts/operations/restore-compose-consistent-backup.mjs` is a deliberately
fail-closed harness for proving that one `mysql.sql` + `storage.tar` pair can
be restored outside production. It is not a production-recovery command and
does not make a database migration reversible.

## Inputs and identity

The harness accepts only the manifest schema emitted by
`megadesk-compose-consistent-backup.mjs`:

- `megadesk-consistent-backup-pair/v1`;
- canonical artifact names `mysql.sql` and `storage.tar` in the same physical
  run directory as `manifest.json`;
- matching positive sizes and SHA-256 values;
- a manifest proving active write-freeze with zero active/in-flight writers;
- a media TAR containing the durable `.write-freeze` state.

It rejects links, mixed run directories, non-regular artifacts, invalid UTF-8,
BOMs, duplicate JSON keys, traversal or duplicate TAR members. GNU tar is
mandatory. Extraction and comparison use numeric ownership, ACLs and xattrs.
After the source pair passes these checks, the harness copies all three files
with exclusive creation into its marker-owned sandbox and verifies that private
copy again. Import never consumes the operator-supplied paths directly, so a
replacement between the initial digest and restore is rejected.

## Future approved execution

Do not run this command until an operator has approved an explicitly named
disposable environment and a candidate runtime assembled with the reviewed
synthetic metadata/media probe:

```bash
node scripts/operations/restore-compose-consistent-backup.mjs --execute \
  --environment-id restore-v5-proof \
  --sandbox-root /var/tmp/megadesk-restore/restore-v5-proof \
  --database-name megadesk_test_restore_v5_proof \
  --mysql-image mysql:8.0.46 \
  --mysql-port 33312 --app-port 43132 \
  --runtime-dir /var/tmp/approved-runtime/v5 \
  --manifest /approved/backup-run/manifest.json \
  --mysql-dump /approved/backup-run/mysql.sql \
  --storage-tar /approved/backup-run/storage.tar
```

All Docker names are derived from `environment-id`, are labelled with
`com.megadesk.restore-harness`, and are refused if they already exist. The
network is internal, the application gets generated in-memory synthetic
passwords/JWT only, and no inherited production environment is passed. Cleanup
first verifies the labels and sandbox marker; it never accepts arbitrary names
or directories for deletion.

Before any restore resource is created, the harness requires
`dist/operations/restore-synthetic-probe.js` in the candidate runtime. It then
runs that module inside the isolated application container after health checks.
The probe creates two uniquely named `restore-probe-*` tenants and a synthetic
sale-document object through `SaleDocumentService`; it verifies an exact hash
on the canonical read path, viewer-write denial, cross-tenant denial, and a
missing physical-object result. Its cleanup is limited to those generated
tenant identifiers and their media directories. The probe rejects main or
divergent database URLs, non-`mysql-test` targets, external-service variables,
and any media root other than the harness mount.

## Approval criteria

The restoration proof is acceptable only when the harness reports
`RESTORE_PAIR_VERIFIED`, the synthetic probe passes, all labelled resources and
the exact sandbox are removed, and an inventory proves protected production
resource IDs, health and restart counts did not change. A failed run with
unconfirmed cleanup is an incident to investigate, not a reason to retry with
broader deletion.
