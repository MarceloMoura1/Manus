# Private media backup baseline

This is an operational runbook, not an automated backup implementation. It is
required before synthetic data is written to a persistent environment and again
after the test window. Do not run it from an application container and do not
put credentials, absolute archive destinations, or customer file names in the
manifest.

## Consistency boundary

1. Record the release SHA, branch, UTC start time, and the approved change
   window identifier.
2. Quiesce application writes using the approved operational procedure. A
   database snapshot and a storage snapshot taken during different write
   windows are not a restore pair.
3. Create an approved MySQL-consistent snapshot of the MegaDesk main database.
   Record its immutable backup identifier and checksum; do not record the
   connection string.
4. Create an approved filesystem snapshot of the configured private media root
   from the same quiesced window. Record its immutable snapshot identifier,
   byte count, and checksum; do not publish the root path or object names.
5. Resume writes only after both snapshot identifiers are recorded.

## Pair manifest

Store one access-controlled manifest alongside the two artifacts. It must
contain only:

- release SHA and schema journal/version;
- UTC consistency-window start and end;
- database snapshot identifier and checksum;
- private-media snapshot identifier, byte count, and checksum;
- operator identity and verification result.

The pair is invalid if either artifact is absent, if their consistency windows
do not overlap, or if either checksum fails. A database-only dump is not a
backup of private attachments, supplier files, product media, conversation
media, or user backgrounds.

## Restore verification

Restore only into a named disposable environment approved for the operation.
Restore the MySQL snapshot and the matching media snapshot together, then
verify metadata-to-object resolution with synthetic references only. Record the
result in the manifest. Never test a restore against MAIN, customer data, or
production storage.

## Synthetic-test gate

Before a persistent synthetic-test window, an operator must create and verify
the baseline pair above. After the window, create a second pair before any
cleanup decision. This runbook does not define legal or commercial retention;
it preserves the technical ability to recover the complete paired state.
