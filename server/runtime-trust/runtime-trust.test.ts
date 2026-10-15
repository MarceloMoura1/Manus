import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from "node:crypto";
import { link, lstat, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  RUNTIME_TRUST_ENVELOPE_KIND,
  RUNTIME_TRUST_ENVELOPE_VERSION,
  RUNTIME_TRUST_PROTOCOL_DOMAIN,
  TIME_EVIDENCE_ENVELOPE_KIND,
  TIME_EVIDENCE_ENVELOPE_VERSION,
  TIME_EVIDENCE_PROTOCOL_DOMAIN,
  signedEnvelopeBytes,
  canonicalTrustPolicyValue,
  timeAuthorityPolicySha256,
  trustPolicySha256,
  validateTrustPayload,
  verifyHistoricalReceiptJournalBytes,
  type TrustPolicy,
  type TimeAuthorityPolicy,
  verifyHistoricalReceiptEnvelopeBytes,
  verifySignedEnvelopeBytes,
} from "./attestation";
import {
  claimAuthorization,
  claimAuthorizationForSyntheticFailureTest,
  createAuthorizationClaim,
  inspectAuthorizationClaim,
  recoverAuthorizationClaim,
  validateAuthorizationClaimInput,
  type AuthorizationClaimInput,
  type SyntheticClaimFailurePoint,
} from "./claims";
import {
  SYNTHETIC_JOURNAL_KIND,
  SYNTHETIC_JOURNAL_VERSION,
  type SyntheticJournal,
  type SyntheticJournalContext,
  type SyntheticJournalEvent,
} from "./synthetic-journal";
import {
  canonicalizeJcs,
  canonicalSha256,
  canonicalUtf8,
  parseStrictJsonBytes,
  RuntimeTrustError,
  type StrictJsonRecord,
  type StrictJsonValue,
} from "./strict-json";

const roots: string[] = [];
const now = new Date("2030-01-01T00:05:00.000Z");
const before = "2029-01-01T00:00:00.000Z";
const after = "2031-01-01T00:00:00.000Z";
const issuedAt = "2030-01-01T00:00:00.000Z";
const expiresAt = "2030-01-01T00:10:00.000Z";
const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const hex = (fill: string) => fill.repeat(64).slice(0, 64);
const git = (fill: string) => fill.repeat(40).slice(0, 40);
const runtimeTrustDirectory = path.dirname(fileURLToPath(import.meta.url));
const worktreeRoot = path.resolve(runtimeTrustDirectory, "..", "..");

async function syntheticRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "megadesk-runtime-trust-"));
  roots.push(root);
  return root;
}

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(RuntimeTrustError);
    expect((error as RuntimeTrustError).code).toBe(code);
    return;
  }
  throw new Error(`Expected RuntimeTrustError ${code}`);
}

async function expectCodeAsync(action: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(RuntimeTrustError);
    expect((error as RuntimeTrustError).code).toBe(code);
    return;
  }
  throw new Error(`Expected RuntimeTrustError ${code}`);
}

function identityPayload(): StrictJsonRecord {
  return {
    kind: "megadesk-backup-orchestrator-identity",
    version: 1,
    attestationId: randomUUID(),
    issuedAt,
    expiresAt,
    scope: "backup-orchestrator-identity",
    trustSetVersion: 1,
    orchestrator: {
      logicalName: "backup-orchestrator.mjs",
      sha256: hex("a"),
      sizeBytes: 1234,
      gitBlob: git("a"),
      gitTree: git("b"),
      gitCommit: git("c"),
    },
    artifact: { manifestSha256: hex("d"), packageSha256: hex("e") },
  };
}

function authorizationPayload(): StrictJsonRecord {
  return {
    kind: "megadesk-runtime-promotion-authorization",
    version: 1,
    authorizationId: randomUUID(),
    operationId: randomUUID(),
    issuedAt,
    expiresAt,
    scope: "runtime-promotion",
    nonce: hex("1"),
    attestationSha256: hex("2"),
    candidate: {
      artifactSha256: hex("3"),
      manifestSha256: hex("4"),
      gitCommit: git("5"),
      gitTree: git("6"),
    },
  };
}

/** Test-fixture construction only. It deliberately performs no verification and
 * is never exported as an authenticity API. */
function syntheticJournalEventBody(event: Omit<SyntheticJournalEvent, "checksum">): StrictJsonRecord {
  return {
    eventType: event.eventType,
    evidence: event.evidence,
    occurredAt: event.occurredAt,
    previousChecksum: event.previousChecksum,
    sequence: event.sequence,
  };
}

function syntheticJournalFixtureBody(journal: Omit<SyntheticJournal, "checksum">): StrictJsonRecord {
  return {
    authorizationId: journal.authorizationId,
    events: journal.events.map(event => ({ checksum: event.checksum, ...syntheticJournalEventBody(event) })),
    kind: journal.kind,
    operationId: journal.operationId,
    receiptId: journal.receiptId,
    version: journal.version,
  };
}

function createSyntheticJournalFixture(context: SyntheticJournalContext): SyntheticJournal {
  const withoutChecksum: Omit<SyntheticJournal, "checksum"> = {
    ...context,
    kind: SYNTHETIC_JOURNAL_KIND,
    version: SYNTHETIC_JOURNAL_VERSION,
    events: [],
  };
  return { ...withoutChecksum, checksum: canonicalSha256(syntheticJournalFixtureBody(withoutChecksum)) };
}

function appendSyntheticJournalFixture(journal: SyntheticJournal, event: Omit<SyntheticJournalEvent, "sequence" | "previousChecksum" | "checksum">): SyntheticJournal {
  const next: SyntheticJournalEvent = {
    ...event,
    sequence: journal.events.length + 1,
    previousChecksum: journal.events.at(-1)?.checksum ?? null,
    checksum: "",
  };
  next.checksum = canonicalSha256(syntheticJournalEventBody(next));
  const withoutChecksum: Omit<SyntheticJournal, "checksum"> = { ...journal, events: [...journal.events, next] };
  return { ...withoutChecksum, checksum: canonicalSha256(syntheticJournalFixtureBody(withoutChecksum)) };
}

function journalBytes(journal: SyntheticJournal): Buffer {
  return Buffer.from(JSON.stringify(journal));
}

function receiptPayload(
  policy: TrustPolicy,
  receiptIssuedAt = issuedAt,
  identity: SyntheticJournalContext = { receiptId: randomUUID(), operationId: randomUUID(), authorizationId: randomUUID() },
): { payload: StrictJsonRecord; journal: SyntheticJournal } {
  const { receiptId, operationId, authorizationId } = identity;
  let journal = createSyntheticJournalFixture({ receiptId, operationId, authorizationId });
  journal = appendSyntheticJournalFixture(journal, { eventType: "PRECHECKED", occurredAt: receiptIssuedAt, evidence: { result: "pass" } });
  journal = appendSyntheticJournalFixture(journal, { eventType: "PROMOTED", occurredAt: expiresAt, evidence: { result: "pass" } });
  return {
    journal,
    payload: {
      authorizationId,
      backup: { runId: "synthetic-backup", manifestSha256: hex("b"), databaseSha256: hex("c"), mediaSha256: hex("d") },
      candidate: { composeSha256: hex("9"), releaseSha: git("9"), runtimeSha256: hex("a") },
      executorId: "synthetic-executor",
      issuedAt: receiptIssuedAt,
      journal: {
        authorizationId,
        kind: "megadesk-runtime-trust-synthetic-journal",
        operationId,
        receiptId,
        sha256: canonicalSha256(journal),
        version: 1,
      },
      kind: "megadesk-app-runtime-promotion-receipt",
      operationId,
      previous: { composeSha256: hex("7"), releaseSha: git("7"), runtimeSha256: hex("8") },
      receiptId,
      scope: "runtime-promotion-receipt",
      trustPolicy: {
        trustSetId: policy.trustSetId,
        version: policy.version,
        sha256: trustPolicySha256(policy),
        revocationSetSha256: policy.revocationSetSha256,
      },
      version: 1,
    },
  };
}

function signerPolicy(purpose: "backup-orchestrator-identity" | "runtime-promotion-authorization" | "runtime-promotion-receipt") {
  const pair = generateKeyPairSync("ed25519");
  const publicKeyPem = pair.publicKey.export({ format: "pem", type: "spki" }).toString();
  const policy: TrustPolicy = {
    kind: "megadesk-runtime-trust-policy",
    version: 1,
    trustSetId: "synthetic-trust-set",
    revocationStatus: "available",
    revocationSetSha256: hex("f"),
    historicalReceiptRevocation: "reject-all-revoked",
    maxAttestationTtlMs: 60 * 60 * 1000,
    keys: [{
      keyId: "synthetic-key-1",
      purpose,
      publicKeyPem,
      publicKeySha256: sha256(publicKeyPem),
      notBefore: before,
      notAfter: after,
      status: "active",
    }],
  };
  return { pair, policy };
}

function signedEnvelope(payload: StrictJsonRecord, purpose: "backup-orchestrator-identity" | "runtime-promotion-authorization" | "runtime-promotion-receipt", signer = signerPolicy(purpose)) {
  const { pair, policy } = signer;
  const protectedHeader: StrictJsonRecord = {
    domain: RUNTIME_TRUST_PROTOCOL_DOMAIN,
    envelopeKind: RUNTIME_TRUST_ENVELOPE_KIND,
    keyId: "synthetic-key-1",
    payloadSha256: canonicalSha256(payload),
    payloadType: purpose,
    protocolVersion: RUNTIME_TRUST_ENVELOPE_VERSION,
  };
  const signature = sign(null, signedEnvelopeBytes(protectedHeader, payload), pair.privateKey).toString("base64");
  const envelope = {
    kind: RUNTIME_TRUST_ENVELOPE_KIND,
    payload,
    protected: protectedHeader,
    signature: { algorithm: "Ed25519", encoding: "base64", keyId: "synthetic-key-1", value: signature },
    version: RUNTIME_TRUST_ENVELOPE_VERSION,
  };
  return { envelope, policy, pair };
}

function timeAuthorityPolicy() {
  const pair = generateKeyPairSync("ed25519");
  const publicKeyPem = pair.publicKey.export({ format: "pem", type: "spki" }).toString();
  const policy: TimeAuthorityPolicy = {
    kind: "megadesk-runtime-trust-time-authority-policy",
    version: 1,
    authoritySetId: "synthetic-time-authority-set",
    revocationStatus: "available",
    revocationSetSha256: hex("e"),
    maxEvidenceTtlMs: 5 * 365 * 24 * 60 * 60 * 1000,
    keys: [{
      keyId: "synthetic-time-key-1",
      publicKeyPem,
      publicKeySha256: sha256(publicKeyPem),
      notBefore: before,
      notAfter: "2035-01-01T00:00:00.000Z",
      status: "active",
    }],
  };
  return { pair, policy };
}

function signedTimeEvidence(
  receiptBytes: Uint8Array,
  receiptPolicy: TrustPolicy,
  authority = timeAuthorityPolicy(),
  timestamps: { signedAt?: string; issuedAt?: string; expiresAt?: string; evidenceId?: string } = {},
) {
  const authorityPolicySha256 = timeAuthorityPolicySha256(authority.policy);
  const evidenceIssuedAt = timestamps.issuedAt ?? issuedAt;
  const payload: StrictJsonRecord = {
    authorityPolicySha256,
    authoritySetId: authority.policy.authoritySetId,
    evidenceId: timestamps.evidenceId ?? randomUUID(),
    expiresAt: timestamps.expiresAt ?? "2034-01-01T00:00:00.000Z",
    issuedAt: evidenceIssuedAt,
    kind: "megadesk-runtime-trust-receipt-signature-time",
    receiptEnvelopeSha256: sha256(Buffer.from(receiptBytes)),
    receiptPolicySha256: trustPolicySha256(receiptPolicy),
    receiptRevocationSetSha256: receiptPolicy.revocationSetSha256,
    scope: "runtime-promotion-receipt-signature-time",
    signedAt: timestamps.signedAt ?? evidenceIssuedAt,
    version: 1,
  };
  const protectedHeader: StrictJsonRecord = {
    authorityPolicySha256,
    authoritySetId: authority.policy.authoritySetId,
    domain: TIME_EVIDENCE_PROTOCOL_DOMAIN,
    envelopeKind: TIME_EVIDENCE_ENVELOPE_KIND,
    keyId: "synthetic-time-key-1",
    payloadSha256: canonicalSha256(payload),
    payloadType: "runtime-promotion-receipt-signature-time",
    protocolVersion: TIME_EVIDENCE_ENVELOPE_VERSION,
  };
  const signature = sign(null, canonicalUtf8({ payload, protected: protectedHeader }), authority.pair.privateKey).toString("base64");
  return {
    authorityPolicy: authority.policy,
    evidence: { kind: TIME_EVIDENCE_ENVELOPE_KIND, version: TIME_EVIDENCE_ENVELOPE_VERSION, payload, protected: protectedHeader, signature: { algorithm: "Ed25519", encoding: "base64", keyId: "synthetic-time-key-1", value: signature } },
  };
}

function claimInput(): AuthorizationClaimInput {
  return {
    authorizationId: randomUUID(),
    operationId: randomUUID(),
    nonce: randomBytes(32).toString("hex"),
    payloadSha256: randomBytes(32).toString("hex"),
    claimedAt: issuedAt,
  };
}

function runClaimWorker(root: string, input: AuthorizationClaimInput): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const worker = path.join(runtimeTrustDirectory, "claim-worker.ts");
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", worker, root, JSON.stringify(input)], {
      cwd: worktreeRoot,
      env: { ...process.env, NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += String(chunk); });
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("close", code => resolvePromise({ code, stdout, stderr }));
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("strict JSON and JCS primitives", () => {
  it("rejects ambiguous input, malformed UTF-8, truncation, invalid escapes and exact configured limits", () => {
    expect(parseStrictJsonBytes(Buffer.from("{}"), { maxBytes: 2 })).toEqual({});
    expectCode(() => parseStrictJsonBytes(Buffer.from("{}"), { maxBytes: 1 }), "STRICT_JSON_BYTE_LIMIT");
    expect(parseStrictJsonBytes(Buffer.from('{"a":"é"}'), { maxStringLength: 1 })).toEqual({ a: "é" });
    expectCode(() => parseStrictJsonBytes(Buffer.from('{"a":"éé"}'), { maxStringLength: 1 }), "STRICT_JSON_STRING_LIMIT");
    expect(parseStrictJsonBytes(Buffer.from("[[0]]"), { maxDepth: 2 })).toEqual([[0]]);
    expectCode(() => parseStrictJsonBytes(Buffer.from("[[0]]"), { maxDepth: 1 }), "STRICT_JSON_DEPTH_LIMIT");
    expect(parseStrictJsonBytes(Buffer.from('{"a":1,"b":2}'), { maxKeys: 2 })).toEqual({ a: 1, b: 2 });
    expectCode(() => parseStrictJsonBytes(Buffer.from('{"a":1,"b":2}'), { maxKeys: 1 }), "STRICT_JSON_KEY_LIMIT");
    expectCode(() => parseStrictJsonBytes(Buffer.from('{"a":1,"a":2}')), "STRICT_JSON_DUPLICATE_KEY");
    expectCode(() => parseStrictJsonBytes(Buffer.from('{"a":1,"\\u0061":2}')), "STRICT_JSON_DUPLICATE_KEY");
    expectCode(() => parseStrictJsonBytes(Buffer.from('{"a":{"b":1,"b":2}}')), "STRICT_JSON_DUPLICATE_KEY");
    expectCode(() => parseStrictJsonBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("{}")])) , "STRICT_JSON_BOM");
    expectCode(() => parseStrictJsonBytes(Buffer.from([0xc3, 0x28])), "STRICT_JSON_UTF8");
    expectCode(() => parseStrictJsonBytes(Buffer.from('{"a":"unterminated')), "STRICT_JSON_TRUNCATED");
    expectCode(() => parseStrictJsonBytes(Buffer.from('{"a":"1234"}'), { maxStringLength: 3 }), "STRICT_JSON_STRING_LIMIT");
    expectCode(() => parseStrictJsonBytes(Buffer.from('{"a":"\\x"}')), "STRICT_JSON_SYNTAX");
    expectCode(() => parseStrictJsonBytes(Buffer.from('{"a":"\u0001"}')), "STRICT_JSON_SYNTAX");
    expectCode(() => parseStrictJsonBytes(Buffer.from('{"a":"\\udc00"}')), "STRICT_JSON_UNICODE");
    expect(parseStrictJsonBytes(Buffer.from("[]"))).toEqual([]);
    expect(parseStrictJsonBytes(Buffer.from("{}"))).toEqual({});
    expectCode(() => parseStrictJsonBytes(Buffer.from("1e309")), "STRICT_JSON_NUMBER");
  });

  it("matches the RFC 8785 property-order and UTF-8 canonicalization examples", () => {
    const rfcPropertyOrder: StrictJsonRecord = {
      "€": "Euro Sign",
      "\r": "Carriage Return",
      "דּ": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "😀": "Emoji: Grinning Face",
    };
    const expected = '{"\\r":"Carriage Return","1":"One","€":"Euro Sign","😀":"Emoji: Grinning Face","דּ":"Hebrew Letter Dalet With Dagesh"}';
    expect(canonicalizeJcs(rfcPropertyOrder)).toBe(expected);
    expect(canonicalUtf8(rfcPropertyOrder).equals(Buffer.from(expected, "utf8"))).toBe(true);
    expect(canonicalizeJcs({ numbers: [-0, 333333333.33333329, 1e30, 4.5, 0.002, 1e-27] })).toBe('{"numbers":[0,333333333.3333333,1e+30,4.5,0.002,1e-27]}');
    expectCode(() => canonicalizeJcs({ invalid: String.fromCharCode(0xd800) }), "STRICT_JSON_UNICODE");
    expectCode(() => canonicalizeJcs({ invalid: String.fromCharCode(0xdc00) }), "STRICT_JSON_UNICODE");
    expectCode(() => canonicalizeJcs({ invalid: Number.NaN }), "CANONICAL_JSON_NUMBER");
    expectCode(() => canonicalizeJcs({ invalid: Number.POSITIVE_INFINITY }), "CANONICAL_JSON_NUMBER");
    expectCode(() => canonicalizeJcs({ invalid: undefined } as unknown as StrictJsonRecord), "CANONICAL_JSON_TYPE");
  });
});

describe("closed signed trust envelopes", () => {
  it("requires one lower-case UUID representation across attestation, receipt, journal, evidence, and claim boundaries", () => {
    const authorizationId = "a23e4567-e89b-42d3-a456-426614174000";
    const operationId = "b23e4567-e89b-42d3-a456-426614174001";
    const receiptId = "d23e4567-e89b-42d3-a456-426614174002";
    const upperAuthorizationId = authorizationId.toUpperCase();
    const mixedOperationId = `${operationId.slice(0, 1).toUpperCase()}${operationId.slice(1)}`;

    const identity = { ...identityPayload(), attestationId: "a23e4567-e89b-42d3-a456-426614174003" };
    expect(validateTrustPayload(identity)).toBe("backup-orchestrator-identity");
    expectCode(() => validateTrustPayload({ ...identity, attestationId: String(identity.attestationId).toUpperCase() }), "TRUST_SCHEMA_INVALID");
    expectCode(() => validateTrustPayload({ ...identity, attestationId: "not-a-uuid" }), "TRUST_SCHEMA_INVALID");

    const authorization = {
      ...authorizationPayload(),
      authorizationId,
      operationId,
    };
    expect(validateTrustPayload(authorization)).toBe("runtime-promotion-authorization");
    expectCode(() => validateTrustPayload({ ...authorization, authorizationId: upperAuthorizationId }), "TRUST_SCHEMA_INVALID");
    expectCode(() => validateTrustPayload({ ...authorization, operationId: mixedOperationId }), "TRUST_SCHEMA_INVALID");
    expectCode(() => validateTrustPayload({ ...authorization, operationId: "not-a-uuid" }), "TRUST_SCHEMA_INVALID");

    const receiptSigner = signerPolicy("runtime-promotion-receipt");
    const receipt = receiptPayload(receiptSigner.policy, issuedAt, { receiptId, operationId, authorizationId });
    expect(validateTrustPayload(receipt.payload)).toBe("runtime-promotion-receipt");
    const journalUpperCase = structuredClone(receipt.payload);
    (journalUpperCase.journal as StrictJsonRecord).receiptId = String(receipt.payload.receiptId).toUpperCase();
    expectCode(() => validateTrustPayload(journalUpperCase), "TRUST_SCHEMA_INVALID");
    const journalMixedCase = structuredClone(receipt.payload);
    (journalMixedCase.journal as StrictJsonRecord).operationId = `${String(receipt.payload.operationId).slice(0, 1).toUpperCase()}${String(receipt.payload.operationId).slice(1)}`;
    expectCode(() => validateTrustPayload(journalMixedCase), "TRUST_SCHEMA_INVALID");

    const { envelope } = signedEnvelope(receipt.payload, "runtime-promotion-receipt", receiptSigner);
    const bytes = Buffer.from(JSON.stringify(envelope));
    const proof = signedTimeEvidence(bytes, receiptSigner.policy, undefined, { evidenceId: "e23e4567-e89b-42d3-a456-426614174004" });
    const options = { now, timeEvidenceBytes: Buffer.from(JSON.stringify(proof.evidence)), timeAuthorityPolicy: proof.authorityPolicy, currentRevocationPolicy: receiptSigner.policy };
    expect(verifyHistoricalReceiptJournalBytes(bytes, journalBytes(receipt.journal), receiptSigner.policy, options).journal.receiptId).toBe(receipt.payload.receiptId);
    const invalidEvidenceId = structuredClone(proof.evidence);
    invalidEvidenceId.payload.evidenceId = String(proof.evidence.payload.evidenceId).toUpperCase();
    expectCode(() => verifyHistoricalReceiptJournalBytes(bytes, journalBytes(receipt.journal), receiptSigner.policy, { ...options, timeEvidenceBytes: Buffer.from(JSON.stringify(invalidEvidenceId)) }), "TRUST_SCHEMA_INVALID");

    const canonicalClaim = { ...claimInput(), authorizationId, operationId };
    expect(createAuthorizationClaim(canonicalClaim).authorizationId).toBe(authorizationId);
    expectCode(() => validateAuthorizationClaimInput({ ...canonicalClaim, authorizationId: upperAuthorizationId }), "CLAIM_SCHEMA_INVALID");
    expectCode(() => validateAuthorizationClaimInput({ ...canonicalClaim, operationId: mixedOperationId }), "CLAIM_SCHEMA_INVALID");
    expectCode(() => validateAuthorizationClaimInput({ ...canonicalClaim, authorizationId: "not-a-uuid" }), "CLAIM_SCHEMA_INVALID");
  });

  it("validates current identity and authorization schemas with synthetic ephemeral keys", () => {
    for (const [payload, purpose, scope] of [
      [identityPayload(), "backup-orchestrator-identity", "backup-orchestrator-identity"],
      [authorizationPayload(), "runtime-promotion-authorization", "runtime-promotion"],
    ] as const) {
      const { envelope, policy } = signedEnvelope(payload, purpose);
      const verified = verifySignedEnvelopeBytes(Buffer.from(JSON.stringify(envelope)), policy, { now, expectedPurpose: purpose, expectedScope: scope });
      expect(verified.purpose).toBe(purpose);
      expect(verified.payload).toEqual(payload);
    }
  });

  it("binds fixed domain, version, envelope kind, purpose and payload bytes", () => {
    const { envelope, policy } = signedEnvelope(authorizationPayload(), "runtime-promotion-authorization");
    const bytes = () => Buffer.from(JSON.stringify(envelope));
    expectCode(() => verifySignedEnvelopeBytes(bytes(), policy, { now, expectedPurpose: "backup-orchestrator-identity" }), "TRUST_PURPOSE_MISMATCH");
    expectCode(() => verifySignedEnvelopeBytes(bytes(), policy, { now, expectedPurpose: "runtime-promotion-authorization", expectedScope: "wrong-scope" }), "TRUST_SCOPE_MISMATCH");
    const domainConfusion = structuredClone(envelope);
    domainConfusion.protected.domain = "other-protocol/v1";
    expectCode(() => verifySignedEnvelopeBytes(Buffer.from(JSON.stringify(domainConfusion)), policy, { now }), "TRUST_DOMAIN_MISMATCH");
    const purposeConfusion = structuredClone(envelope);
    purposeConfusion.protected.payloadType = "backup-orchestrator-identity";
    expectCode(() => verifySignedEnvelopeBytes(Buffer.from(JSON.stringify(purposeConfusion)), policy, { now }), "TRUST_PURPOSE_MISMATCH");
    const versionConfusion = structuredClone(envelope);
    versionConfusion.version = 1;
    expectCode(() => verifySignedEnvelopeBytes(Buffer.from(JSON.stringify(versionConfusion)), policy, { now }), "TRUST_SCHEMA_INVALID");
    const changedPayload = structuredClone(envelope);
    changedPayload.payload.nonce = hex("f");
    expectCode(() => verifySignedEnvelopeBytes(Buffer.from(JSON.stringify(changedPayload)), policy, { now }), "TRUST_PAYLOAD_DIGEST_MISMATCH");
    const badSignature = structuredClone(envelope);
    badSignature.signature.value = Buffer.alloc(64, 7).toString("base64");
    expectCode(() => verifySignedEnvelopeBytes(Buffer.from(JSON.stringify(badSignature)), policy, { now }), "TRUST_SIGNATURE_INVALID");
  });

  it("keeps current authorization fail-closed for policy, expiry and revocation", () => {
    const { envelope, policy } = signedEnvelope(authorizationPayload(), "runtime-promotion-authorization");
    const bytes = () => Buffer.from(JSON.stringify(envelope));
    expectCode(() => verifySignedEnvelopeBytes(bytes(), { ...policy, revocationStatus: "unavailable" }, { now }), "TRUST_REVOCATION_UNAVAILABLE");
    expectCode(() => verifySignedEnvelopeBytes(bytes(), { ...policy, keys: [{ ...policy.keys[0], status: "revoked", revocation: { occurredAt: issuedAt, reason: "compromise" } }] }, { now }), "TRUST_KEY_REVOKED");
    expectCode(() => verifySignedEnvelopeBytes(bytes(), { ...policy, keys: [{ ...policy.keys[0], keyId: "other" }] }, { now }), "TRUST_KEY_UNKNOWN");
    expectCode(() => verifySignedEnvelopeBytes(bytes(), { ...policy, keys: [{ ...policy.keys[0], notAfter: "2029-12-31T23:59:59.999Z" }] }, { now }), "TRUST_KEY_EXPIRED");
    expectCode(() => verifySignedEnvelopeBytes(bytes(), { ...policy, keys: [{ ...policy.keys[0], publicKeySha256: hex("0") }] }, { now }), "TRUST_POLICY_INVALID");
    expectCode(() => verifySignedEnvelopeBytes(bytes(), policy, { now: new Date("2030-02-01T00:00:00.000Z") }), "TRUST_ATTESTATION_EXPIRED");
  });

  it("requires a separately signed, exact-receipt time proof for historical receipts", () => {
    const signer = signerPolicy("runtime-promotion-receipt");
    const receipt = receiptPayload(signer.policy);
    const { envelope } = signedEnvelope(receipt.payload, "runtime-promotion-receipt", signer);
    const bytes = Buffer.from(JSON.stringify(envelope));
    const proof = signedTimeEvidence(bytes, signer.policy);
    const evidenceBytes = Buffer.from(JSON.stringify(proof.evidence));
    const options = { now, expectedScope: "runtime-promotion-receipt", timeEvidenceBytes: evidenceBytes, timeAuthorityPolicy: proof.authorityPolicy, currentRevocationPolicy: signer.policy };
    expectCode(() => verifySignedEnvelopeBytes(bytes, signer.policy, { now }), "TRUST_HISTORICAL_RECEIPT_API_REQUIRED");
    expect(verifyHistoricalReceiptEnvelopeBytes(bytes, signer.policy, options).purpose).toBe("runtime-promotion-receipt");
    expectCode(() => verifyHistoricalReceiptEnvelopeBytes(bytes, signer.policy, { now }), "TRUST_TIME_AUTHORITY_UNAVAILABLE");

    // The receipt signer cannot become a time authority by relabelling the
    // same SPKI material or changing only PEM line endings.
    const receiptPemWithCrLf = signer.policy.keys[0].publicKeyPem.replace(/\n/g, "\r\n");
    const selfAuthorityPolicy: TimeAuthorityPolicy = {
      ...proof.authorityPolicy,
      keys: [{
        ...proof.authorityPolicy.keys[0],
        keyId: "different-time-key-id",
        publicKeyPem: receiptPemWithCrLf,
        publicKeySha256: sha256(receiptPemWithCrLf),
      }],
    };
    const selfAuthorityProof = signedTimeEvidence(bytes, signer.policy, { pair: signer.pair, policy: selfAuthorityPolicy });
    expectCode(
      () => verifyHistoricalReceiptEnvelopeBytes(bytes, signer.policy, { ...options, timeEvidenceBytes: Buffer.from(JSON.stringify(selfAuthorityProof.evidence)), timeAuthorityPolicy: selfAuthorityPolicy }),
      "TRUST_TIME_AUTHORITY_NOT_DISTINCT",
    );

    // A time authority cannot certify a signature time before its own key was
    // valid, even when its evidence is signed later by a separate valid key.
    const historicalIssuedAt = "2029-06-01T00:00:00.000Z";
    const historicalReceipt = receiptPayload(signer.policy, historicalIssuedAt);
    const historicalEnvelope = signedEnvelope(historicalReceipt.payload, "runtime-promotion-receipt", signer);
    const historicalBytes = Buffer.from(JSON.stringify(historicalEnvelope.envelope));
    const laterAuthority = timeAuthorityPolicy();
    const laterAuthorityPolicy: TimeAuthorityPolicy = {
      ...laterAuthority.policy,
      keys: [{ ...laterAuthority.policy.keys[0], notBefore: issuedAt }],
    };
    const preAuthorityProof = signedTimeEvidence(
      historicalBytes,
      signer.policy,
      { pair: laterAuthority.pair, policy: laterAuthorityPolicy },
      { signedAt: historicalIssuedAt },
    );
    expectCode(
      () => verifyHistoricalReceiptEnvelopeBytes(historicalBytes, signer.policy, { now, timeEvidenceBytes: Buffer.from(JSON.stringify(preAuthorityProof.evidence)), timeAuthorityPolicy: laterAuthorityPolicy, currentRevocationPolicy: signer.policy }),
      "TRUST_TIME_AUTHORITY_EXPIRED",
    );

    // Both temporal boundaries are inclusive, matching the existing current
    // key-validity convention.
    const startBoundaryAuthority = timeAuthorityPolicy();
    const startBoundaryPolicy: TimeAuthorityPolicy = {
      ...startBoundaryAuthority.policy,
      keys: [{ ...startBoundaryAuthority.policy.keys[0], notBefore: issuedAt }],
    };
    const startBoundaryProof = signedTimeEvidence(bytes, signer.policy, { pair: startBoundaryAuthority.pair, policy: startBoundaryPolicy });
    expect(verifyHistoricalReceiptEnvelopeBytes(bytes, signer.policy, { ...options, timeEvidenceBytes: Buffer.from(JSON.stringify(startBoundaryProof.evidence)), timeAuthorityPolicy: startBoundaryPolicy }).purpose).toBe("runtime-promotion-receipt");

    const endBoundary = "2030-01-01T00:05:00.000Z";
    const endBoundaryReceipt = receiptPayload(signer.policy, endBoundary);
    const endBoundaryEnvelope = signedEnvelope(endBoundaryReceipt.payload, "runtime-promotion-receipt", signer);
    const endBoundaryBytes = Buffer.from(JSON.stringify(endBoundaryEnvelope.envelope));
    const endBoundaryAuthority = timeAuthorityPolicy();
    const endBoundaryPolicy: TimeAuthorityPolicy = {
      ...endBoundaryAuthority.policy,
      keys: [{ ...endBoundaryAuthority.policy.keys[0], notAfter: endBoundary }],
    };
    const endBoundaryProof = signedTimeEvidence(
      endBoundaryBytes,
      signer.policy,
      { pair: endBoundaryAuthority.pair, policy: endBoundaryPolicy },
      { signedAt: endBoundary, issuedAt: endBoundary, expiresAt: "2030-01-01T00:05:00.001Z" },
    );
    expect(verifyHistoricalReceiptEnvelopeBytes(endBoundaryBytes, signer.policy, { now: new Date(endBoundary), timeEvidenceBytes: Buffer.from(JSON.stringify(endBoundaryProof.evidence)), timeAuthorityPolicy: endBoundaryPolicy, currentRevocationPolicy: signer.policy }).purpose).toBe("runtime-promotion-receipt");

    const forgedDate = structuredClone(proof.evidence);
    forgedDate.payload.signedAt = "2029-01-01T00:00:00.000Z";
    expectCode(() => verifyHistoricalReceiptEnvelopeBytes(bytes, signer.policy, { ...options, timeEvidenceBytes: Buffer.from(JSON.stringify(forgedDate)) }), "TRUST_TIME_EVIDENCE_INVALID");
    const badSignature = structuredClone(proof.evidence);
    badSignature.signature.value = Buffer.alloc(64, 9).toString("base64");
    expectCode(() => verifyHistoricalReceiptEnvelopeBytes(bytes, signer.policy, { ...options, timeEvidenceBytes: Buffer.from(JSON.stringify(badSignature)) }), "TRUST_TIME_EVIDENCE_INVALID");
    const otherSigner = signerPolicy("runtime-promotion-receipt");
    const otherReceipt = receiptPayload(otherSigner.policy);
    const otherEnvelope = signedEnvelope(otherReceipt.payload, "runtime-promotion-receipt", otherSigner);
    expectCode(() => verifyHistoricalReceiptEnvelopeBytes(Buffer.from(JSON.stringify(otherEnvelope.envelope)), otherSigner.policy, { ...options, timeEvidenceBytes: evidenceBytes }), "TRUST_TIME_EVIDENCE_BINDING_MISMATCH");
    expectCode(() => verifyHistoricalReceiptEnvelopeBytes(bytes, { ...signer.policy, revocationSetSha256: hex("0") }, options), "TRUST_POLICY_BINDING_MISMATCH");
    const unknownAuthority = structuredClone(proof.evidence);
    unknownAuthority.protected.keyId = "unknown";
    unknownAuthority.signature.keyId = "unknown";
    expectCode(() => verifyHistoricalReceiptEnvelopeBytes(bytes, signer.policy, { ...options, timeEvidenceBytes: Buffer.from(JSON.stringify(unknownAuthority)) }), "TRUST_TIME_AUTHORITY_UNKNOWN");
    expectCode(() => verifyHistoricalReceiptEnvelopeBytes(bytes, signer.policy, { ...options, timeAuthorityPolicy: { ...proof.authorityPolicy, keys: [{ ...proof.authorityPolicy.keys[0], keyId: "other" }] } }), "TRUST_TIME_AUTHORITY_INVALID");
    const revokedAuthority = timeAuthorityPolicy();
    const revokedPolicy: TimeAuthorityPolicy = { ...revokedAuthority.policy, keys: [{ ...revokedAuthority.policy.keys[0], status: "revoked", revocation: { occurredAt: issuedAt, reason: "compromise" } }] };
    const revokedProof = signedTimeEvidence(bytes, signer.policy, { ...revokedAuthority, policy: revokedPolicy });
    expectCode(() => verifyHistoricalReceiptEnvelopeBytes(bytes, signer.policy, { ...options, timeAuthorityPolicy: revokedPolicy, timeEvidenceBytes: Buffer.from(JSON.stringify(revokedProof.evidence)) }), "TRUST_TIME_AUTHORITY_REVOKED");
    expectCode(() => verifyHistoricalReceiptEnvelopeBytes(bytes, signer.policy, { ...options, now: new Date("2035-01-01T00:00:00.000Z") }), "TRUST_TIME_EVIDENCE_EXPIRED");
  });

  it("rejects a validly signed proof when signedAt and issuedAt both predate the authority key", () => {
    const signer = signerPolicy("runtime-promotion-receipt");
    const signedAtBeforeAuthority = "2029-06-01T00:00:00.000Z";
    const issuedAtBeforeAuthority = "2029-06-01T00:01:00.000Z";
    const evidenceExpiresAt = "2030-01-01T00:10:00.000Z";
    const receipt = receiptPayload(signer.policy, signedAtBeforeAuthority);
    const { envelope } = signedEnvelope(receipt.payload, "runtime-promotion-receipt", signer);
    const bytes = Buffer.from(JSON.stringify(envelope));
    const timestamps = {
      signedAt: signedAtBeforeAuthority,
      issuedAt: issuedAtBeforeAuthority,
      expiresAt: evidenceExpiresAt,
    };

    // Control: the exact timestamps, receipt bytes and Ed25519 key are valid
    // when the authority key's inclusive interval contains them.
    const authority = timeAuthorityPolicy();
    const permittedProof = signedTimeEvidence(bytes, signer.policy, authority, timestamps);
    expect(verifyHistoricalReceiptEnvelopeBytes(bytes, signer.policy, {
      now,
      timeEvidenceBytes: Buffer.from(JSON.stringify(permittedProof.evidence)),
      timeAuthorityPolicy: authority.policy,
      currentRevocationPolicy: signer.policy,
    }).purpose).toBe("runtime-promotion-receipt");

    // Only notBefore changes. Both timestamps remain ordered, canonically
    // encoded, cryptographically signed, policy-bound and receipt-bound.
    const laterNotBeforePolicy: TimeAuthorityPolicy = {
      ...authority.policy,
      keys: [{ ...authority.policy.keys[0], notBefore: issuedAt }],
    };
    const preAuthorityProof = signedTimeEvidence(
      bytes,
      signer.policy,
      { pair: authority.pair, policy: laterNotBeforePolicy },
      timestamps,
    );
    expectCode(
      () => verifyHistoricalReceiptEnvelopeBytes(bytes, signer.policy, {
        now,
        timeEvidenceBytes: Buffer.from(JSON.stringify(preAuthorityProof.evidence)),
        timeAuthorityPolicy: laterNotBeforePolicy,
        currentRevocationPolicy: signer.policy,
      }),
      "TRUST_TIME_AUTHORITY_EXPIRED",
    );
  });

  it("protects keyId and rejects duplicated public keys or changed policy identity", () => {
    const signer = signerPolicy("runtime-promotion-authorization");
    const { envelope } = signedEnvelope(authorizationPayload(), "runtime-promotion-authorization", signer);
    const bytes = Buffer.from(JSON.stringify(envelope));
    const relabeled = structuredClone(envelope);
    relabeled.signature.keyId = "other";
    expectCode(() => verifySignedEnvelopeBytes(Buffer.from(JSON.stringify(relabeled)), signer.policy, { now }), "TRUST_KEY_ID_MISMATCH");
    expectCode(() => verifySignedEnvelopeBytes(bytes, { ...signer.policy, keys: [signer.policy.keys[0], { ...signer.policy.keys[0], keyId: "duplicate" }] }, { now }), "TRUST_POLICY_INVALID");
  });

  it("hashes policy key arrays with deterministic UTF-16 code-unit order", () => {
    const first = signerPolicy("runtime-promotion-authorization");
    const second = signerPolicy("runtime-promotion-authorization");
    const policy: TrustPolicy = {
      ...first.policy,
      keys: [
        { ...first.policy.keys[0], keyId: "\u00e4-key" },
        { ...second.policy.keys[0], keyId: "z-key" },
      ],
    };
    const permutedPolicy: TrustPolicy = { ...policy, keys: [...policy.keys].reverse() };
    const orderedTrustKeys = (canonicalTrustPolicyValue(policy).keys as StrictJsonValue[])
      .map(key => String((key as StrictJsonRecord).keyId));
    expect(orderedTrustKeys).toEqual(["z-key", "\u00e4-key"]);
    expect(trustPolicySha256(permutedPolicy)).toBe(trustPolicySha256(policy));

    const firstAuthority = timeAuthorityPolicy();
    const secondAuthority = timeAuthorityPolicy();
    const authorityPolicy: TimeAuthorityPolicy = {
      ...firstAuthority.policy,
      keys: [
        { ...firstAuthority.policy.keys[0], keyId: "\u00e4-key" },
        { ...secondAuthority.policy.keys[0], keyId: "z-key" },
      ],
    };
    const expectedAuthorityHash = canonicalSha256({
      authoritySetId: authorityPolicy.authoritySetId,
      keys: [
        { keyId: "z-key", notAfter: authorityPolicy.keys[1].notAfter, notBefore: authorityPolicy.keys[1].notBefore, publicKeySha256: authorityPolicy.keys[1].publicKeySha256, revocation: null, status: authorityPolicy.keys[1].status },
        { keyId: "\u00e4-key", notAfter: authorityPolicy.keys[0].notAfter, notBefore: authorityPolicy.keys[0].notBefore, publicKeySha256: authorityPolicy.keys[0].publicKeySha256, revocation: null, status: authorityPolicy.keys[0].status },
      ],
      kind: authorityPolicy.kind,
      maxEvidenceTtlMs: authorityPolicy.maxEvidenceTtlMs,
      revocationSetSha256: authorityPolicy.revocationSetSha256,
      revocationStatus: authorityPolicy.revocationStatus,
      version: authorityPolicy.version,
    });
    expect(timeAuthorityPolicySha256({ ...authorityPolicy, keys: [...authorityPolicy.keys].reverse() })).toBe(timeAuthorityPolicySha256(authorityPolicy));
    expect(timeAuthorityPolicySha256(authorityPolicy)).toBe(expectedAuthorityHash);
  });

  it("uses a current superseding revocation policy without rewriting the authenticated receipt snapshot", () => {
    const signer = signerPolicy("runtime-promotion-receipt");
    const historicalPolicy: TrustPolicy = { ...signer.policy, historicalReceiptRevocation: "allow-superseded-before-revocation" };
    const receipt = receiptPayload(historicalPolicy);
    const { envelope } = signedEnvelope(receipt.payload, "runtime-promotion-receipt", { pair: signer.pair, policy: historicalPolicy });
    const bytes = Buffer.from(JSON.stringify(envelope));
    const proof = signedTimeEvidence(bytes, historicalPolicy);
    const currentRevocationPolicy: TrustPolicy = {
      ...historicalPolicy,
      revocationSetSha256: hex("0"),
      keys: [{
        ...historicalPolicy.keys[0],
        status: "revoked",
        revocation: { occurredAt: "2030-01-01T00:06:00.000Z", reason: "superseded" },
      }],
    };
    const options = {
      now: new Date("2030-01-01T00:07:00.000Z"),
      timeEvidenceBytes: Buffer.from(JSON.stringify(proof.evidence)),
      timeAuthorityPolicy: proof.authorityPolicy,
      currentRevocationPolicy,
    };
    expect(verifyHistoricalReceiptEnvelopeBytes(bytes, historicalPolicy, options).purpose).toBe("runtime-promotion-receipt");
    expectCode(
      () => verifyHistoricalReceiptEnvelopeBytes(bytes, historicalPolicy, { ...options, currentRevocationPolicy: undefined }),
      "TRUST_CURRENT_REVOCATION_UNAVAILABLE",
    );
    expectCode(
      () => verifyHistoricalReceiptEnvelopeBytes(bytes, historicalPolicy, {
        ...options,
        currentRevocationPolicy: { ...currentRevocationPolicy, revocationStatus: "unavailable" },
      }),
      "TRUST_REVOCATION_UNAVAILABLE",
    );
    expectCode(
      () => verifyHistoricalReceiptEnvelopeBytes(bytes, { ...historicalPolicy, maxAttestationTtlMs: historicalPolicy.maxAttestationTtlMs + 1 }, options),
      "TRUST_POLICY_BINDING_MISMATCH",
    );
    const compromisedCurrentPolicy: TrustPolicy = {
      ...currentRevocationPolicy,
      keys: [{ ...currentRevocationPolicy.keys[0], revocation: { occurredAt: "2030-01-01T00:06:00.000Z", reason: "compromise" } }],
    };
    expectCode(
      () => verifyHistoricalReceiptEnvelopeBytes(bytes, historicalPolicy, { ...options, currentRevocationPolicy: compromisedCurrentPolicy }),
      "TRUST_KEY_REVOKED",
    );
    const afterSignatureRevocation: TrustPolicy = {
      ...currentRevocationPolicy,
      keys: [{ ...currentRevocationPolicy.keys[0], revocation: { occurredAt: issuedAt, reason: "superseded" } }],
    };
    expectCode(
      () => verifyHistoricalReceiptEnvelopeBytes(bytes, historicalPolicy, { ...options, currentRevocationPolicy: afterSignatureRevocation }),
      "TRUST_KEY_REVOKED",
    );
    const differentSigner = signerPolicy("runtime-promotion-receipt");
    const discontinuousCurrentPolicy: TrustPolicy = {
      ...currentRevocationPolicy,
      keys: [{ ...differentSigner.policy.keys[0], keyId: historicalPolicy.keys[0].keyId }],
    };
    expectCode(
      () => verifyHistoricalReceiptEnvelopeBytes(bytes, historicalPolicy, { ...options, currentRevocationPolicy: discontinuousCurrentPolicy }),
      "TRUST_CURRENT_REVOCATION_INCOMPATIBLE",
    );
  });
});

describe("single-use authorization claims", () => {
  it("fails closed on unsupported platforms and never grants an unconfirmed claim", async () => {
    const root = await syntheticRoot();
    const input = claimInput();
    if (process.platform === "win32") {
      await expectCodeAsync(() => claimAuthorization(root, input), "CLAIM_PLATFORM_UNSUPPORTED");
      return;
    }
    try {
      const first = await claimAuthorization(root, input);
      expect(first.state).toBe("consumed");
      expect(first.filesystem.directoryFsync).toBe("confirmed");
      expect((await inspectAuthorizationClaim(root, input.authorizationId)).state).toBe("durability-unconfirmed");
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeTrustError);
      expect((error as RuntimeTrustError).code).toBe("CLAIM_DURABILITY_UNCONFIRMED");
      await expectCodeAsync(() => claimAuthorization(root, input), "CLAIM_DURABILITY_UNCONFIRMED");
    }
    await expectCodeAsync(() => recoverAuthorizationClaim(), "RECOVERY_AUTHORIZATION_REQUIRED");
  });

  it("leaves every injected failure state non-authorizing and non-reusable", async () => {
    if (process.platform === "win32") {
      const root = await syntheticRoot();
      await expectCodeAsync(() => claimAuthorizationForSyntheticFailureTest(root, claimInput(), { failureAt: "after-lease-create" }), "CLAIM_PLATFORM_UNSUPPORTED");
      return;
    }
    const checkpoints: readonly SyntheticClaimFailurePoint[] = ["after-lease-create", "after-lease-write", "after-lease-sync", "after-stage-create", "after-stage-write", "after-stage-sync", "after-publish", "after-directory-sync"];
    for (const point of checkpoints) {
      const root = await syntheticRoot();
      const input = claimInput();
      await expectCodeAsync(() => claimAuthorizationForSyntheticFailureTest(root, input, { failureAt: point }), "SYNTHETIC_CLAIM_FAILURE");
      const state = (await inspectAuthorizationClaim(root, input.authorizationId)).state;
      expect(["in-progress", "corrupt", "durability-unconfirmed"]).toContain(state);
      await expectCodeAsync(
        () => claimAuthorization(root, input),
        state === "in-progress" ? "CLAIM_IN_PROGRESS" : state === "corrupt" ? "CLAIM_CORRUPT" : "CLAIM_DURABILITY_UNCONFIRMED",
      );
    }
  });

  it("tests six-process contention repeatedly without a durability bypass", async () => {
    for (let run = 0; run < 3; run += 1) {
      const root = await syntheticRoot();
      const input = claimInput();
      const results = await Promise.all(Array.from({ length: 6 }, () => runClaimWorker(root, input)));
      if (process.platform === "win32") {
        expect(results).toEqual(Array.from({ length: 6 }, () => ({
          code: 1,
          stdout: "",
          stderr: "CLAIM_PLATFORM_UNSUPPORTED\n",
        })));
      } else {
        expect(results.filter(result => result.code === 0 && result.stdout === "CLAIM_CREATED\n")).toHaveLength(1);
        expect(results.filter(result => result.code === 1)).toHaveLength(5);
        expect(results.filter(result => result.code === 1).every(result => ["CLAIM_IN_PROGRESS\n", "CLAIM_DURABILITY_UNCONFIRMED\n"].includes(result.stderr))).toBe(true);
        await expect(lstat(path.join(root, `${input.authorizationId}.stage.json`))).rejects.toMatchObject({ code: "ENOENT" });
      }
    }
  });

  it("rejects corrupt claims, unsafe roots, root substitution, and non-canonical UUIDs", async () => {
    if (process.platform === "win32") {
      const root = await syntheticRoot();
      await expectCodeAsync(() => inspectAuthorizationClaim(root, claimInput().authorizationId), "CLAIM_PLATFORM_UNSUPPORTED");
      return;
    }
    const corruptRoot = await syntheticRoot();
    const corruptInput = claimInput();
    await writeFile(path.join(corruptRoot, `${corruptInput.authorizationId}.claim.json`), '{"kind":"tampered"}', "utf8");
    expect((await inspectAuthorizationClaim(corruptRoot, corruptInput.authorizationId)).state).toBe("corrupt");
    await expectCodeAsync(() => claimAuthorization(corruptRoot, corruptInput), "CLAIM_CORRUPT");
    const parent = await syntheticRoot();
    const fileRoot = path.join(parent, "not-a-directory");
    await writeFile(fileRoot, "synthetic", "utf8");
    await expectCodeAsync(() => claimAuthorization(fileRoot, claimInput()), "CLAIM_ROOT_UNSAFE");
    const target = await syntheticRoot();
    const linkParent = await syntheticRoot();
    const linkedRoot = path.join(linkParent, "linked-root");
    await symlink(target, linkedRoot, "dir");
    await expectCodeAsync(() => claimAuthorization(linkedRoot, claimInput()), "CLAIM_ROOT_UNSAFE");
    const replacedRoot = await syntheticRoot();
    await rm(replacedRoot, { recursive: true, force: true });
    await symlink(target, replacedRoot, "dir");
    await expectCodeAsync(() => claimAuthorization(replacedRoot, claimInput()), "CLAIM_ROOT_UNSAFE");
    const canonical = { ...claimInput(), authorizationId: "f23e4567-e89b-42d3-a456-426614174005" };
    await expectCodeAsync(() => claimAuthorization(target, { ...canonical, authorizationId: canonical.authorizationId.toUpperCase() }), "CLAIM_SCHEMA_INVALID");
    const hardLinkRoot = await syntheticRoot();
    const hardLinkInput = claimInput();
    const validClaim = createAuthorizationClaim(hardLinkInput);
    const published = path.join(hardLinkRoot, `${hardLinkInput.authorizationId}.claim.json`);
    const alternate = path.join(hardLinkRoot, "unexpected-hard-link.json");
    await writeFile(published, JSON.stringify(validClaim), "utf8");
    await link(published, alternate);
    expect((await inspectAuthorizationClaim(hardLinkRoot, hardLinkInput.authorizationId)).state).toBe("corrupt");
    await unlink(alternate);
  });
});

describe("synthetic receipt journal binding", () => {
  it("binds journal data only through an authenticated immutable receipt envelope", () => {
    const signer = signerPolicy("runtime-promotion-receipt");
    const { payload, journal } = receiptPayload(signer.policy, issuedAt, {
      receiptId: "a23e4567-e89b-42d3-a456-426614174006",
      operationId: "b23e4567-e89b-42d3-a456-426614174007",
      authorizationId: "c23e4567-e89b-42d3-a456-426614174008",
    });
    const { envelope } = signedEnvelope(payload, "runtime-promotion-receipt", signer);
    const bytes = Buffer.from(JSON.stringify(envelope));
    const proof = signedTimeEvidence(bytes, signer.policy);
    const options = { now, timeEvidenceBytes: Buffer.from(JSON.stringify(proof.evidence)), timeAuthorityPolicy: proof.authorityPolicy, currentRevocationPolicy: signer.policy };
    const verified = verifyHistoricalReceiptJournalBytes(bytes, journalBytes(journal), signer.policy, options);
    expect(Object.isFrozen(verified.receipt.payload)).toBe(true);
    expect(Object.isFrozen(verified.journal)).toBe(true);
    expect(Object.isFrozen(verified.journal.events)).toBe(true);
    expect(verified.journal.checksum).toBe(journal.checksum);

    // The immutable receipt is canonical, but the journal itself must reject
    // alternate textual representations rather than normalizing them.
    const upperJournalReceiptId = structuredClone(journal);
    upperJournalReceiptId.receiptId = journal.receiptId.toUpperCase();
    expectCode(() => verifyHistoricalReceiptJournalBytes(bytes, journalBytes(upperJournalReceiptId), signer.policy, options), "JOURNAL_SCHEMA_INVALID");
    const mixedJournalOperationId = structuredClone(journal);
    mixedJournalOperationId.operationId = `${journal.operationId.slice(0, 1).toUpperCase()}${journal.operationId.slice(1)}`;
    expectCode(() => verifyHistoricalReceiptJournalBytes(bytes, journalBytes(mixedJournalOperationId), signer.policy, options), "JOURNAL_SCHEMA_INVALID");

    // The journal is never accepted if either side of its authenticated proof
    // fails, even when the supplied journal is otherwise structurally valid.
    const invalidReceipt = structuredClone(envelope);
    invalidReceipt.signature.value = Buffer.alloc(64, 8).toString("base64");
    const invalidReceiptBytes = Buffer.from(JSON.stringify(invalidReceipt));
    const invalidReceiptProof = signedTimeEvidence(invalidReceiptBytes, signer.policy);
    expectCode(() => verifyHistoricalReceiptJournalBytes(invalidReceiptBytes, journalBytes(journal), signer.policy, {
      now,
      timeEvidenceBytes: Buffer.from(JSON.stringify(invalidReceiptProof.evidence)),
      timeAuthorityPolicy: invalidReceiptProof.authorityPolicy,
      currentRevocationPolicy: signer.policy,
    }), "TRUST_SIGNATURE_INVALID");
    const invalidTimeEvidence = structuredClone(proof.evidence);
    // Preserve canonical base64 so this exercises the time-evidence verifier,
    // rather than the generic envelope base64 parser.
    invalidTimeEvidence.signature.value = Buffer.alloc(64, 9).toString("base64");
    expectCode(() => verifyHistoricalReceiptJournalBytes(bytes, journalBytes(journal), signer.policy, {
      ...options,
      timeEvidenceBytes: Buffer.from(JSON.stringify(invalidTimeEvidence)),
    }), "TRUST_TIME_EVIDENCE_INVALID");

    let substitute = createSyntheticJournalFixture({ receiptId: journal.receiptId, operationId: journal.operationId, authorizationId: journal.authorizationId });
    substitute = appendSyntheticJournalFixture(substitute, { eventType: "OTHER", occurredAt: issuedAt, evidence: { result: "different" } });
    expectCode(() => verifyHistoricalReceiptJournalBytes(bytes, journalBytes(substitute), signer.policy, options), "TRUST_JOURNAL_DIGEST_MISMATCH");
    const altered = structuredClone(journal);
    altered.events[1].evidence.result = "altered";
    expectCode(() => verifyHistoricalReceiptJournalBytes(bytes, journalBytes(altered), signer.policy, options), "JOURNAL_EVENT_CHECKSUM_INVALID");
    const reordered = structuredClone(journal);
    reordered.events.reverse();
    expectCode(() => verifyHistoricalReceiptJournalBytes(bytes, journalBytes(reordered), signer.policy, options), "JOURNAL_SEQUENCE_INVALID");
    const duplicated = structuredClone(journal);
    duplicated.events.push(structuredClone(duplicated.events[1]));
    expectCode(() => verifyHistoricalReceiptJournalBytes(bytes, journalBytes(duplicated), signer.policy, options), "JOURNAL_SEQUENCE_INVALID");
    const deleted = structuredClone(journal);
    deleted.events.splice(0, 1);
    expectCode(() => verifyHistoricalReceiptJournalBytes(bytes, journalBytes(deleted), signer.policy, options), "JOURNAL_SEQUENCE_INVALID");
    const unknownJournal = structuredClone(journal);
    unknownJournal.version = 2;
    expectCode(() => verifyHistoricalReceiptJournalBytes(bytes, journalBytes(unknownJournal), signer.policy, options), "JOURNAL_SCHEMA_INVALID");
    const mutatedEnvelope = structuredClone(envelope);
    (mutatedEnvelope.payload.journal as StrictJsonRecord).sha256 = hex("0");
    expectCode(() => verifyHistoricalReceiptJournalBytes(Buffer.from(JSON.stringify(mutatedEnvelope)), journalBytes(journal), signer.policy, options), "TRUST_PAYLOAD_DIGEST_MISMATCH");
    expectCode(() => verifyHistoricalReceiptJournalBytes(Buffer.from(JSON.stringify(envelope)), journalBytes({ ...journal, operationId: randomUUID() }), signer.policy, options), "JOURNAL_CONTEXT_MISMATCH");
  });

  it("detects truncation and a broken chain before journal binding", async () => {
    const signer = signerPolicy("runtime-promotion-receipt");
    const { payload, journal } = receiptPayload(signer.policy);
    const { envelope } = signedEnvelope(payload, "runtime-promotion-receipt", signer);
    const bytes = Buffer.from(JSON.stringify(envelope));
    const proof = signedTimeEvidence(bytes, signer.policy);
    const options = {
      now,
      timeEvidenceBytes: Buffer.from(JSON.stringify(proof.evidence)),
      timeAuthorityPolicy: proof.authorityPolicy,
      currentRevocationPolicy: signer.policy,
    };
    const root = await syntheticRoot();
    const truncated = path.join(root, "synthetic-journal.json");
    await writeFile(truncated, JSON.stringify(journal).slice(0, -20), "utf8");
    const broken = structuredClone(journal);
    broken.events[1].previousChecksum = null;
    expectCode(() => verifyHistoricalReceiptJournalBytes(bytes, journalBytes(broken), signer.policy, options), "JOURNAL_CHAIN_BROKEN");
    expectCode(() => verifyHistoricalReceiptJournalBytes(bytes, journalBytes({ ...journal, events: [...journal.events.slice(0, 1)] }), signer.policy, options), "JOURNAL_CHECKSUM_INVALID");
    const truncatedBytes = await readFile(truncated);
    expectCode(() => parseStrictJsonBytes(truncatedBytes), "STRICT_JSON_TRUNCATED");
  });

  it("parses journal bytes strictly at the public verification boundary", () => {
    const signer = signerPolicy("runtime-promotion-receipt");
    const { payload, journal } = receiptPayload(signer.policy);
    const { envelope } = signedEnvelope(payload, "runtime-promotion-receipt", signer);
    const bytes = Buffer.from(JSON.stringify(envelope));
    const proof = signedTimeEvidence(bytes, signer.policy);
    const options = { now, timeEvidenceBytes: Buffer.from(JSON.stringify(proof.evidence)), timeAuthorityPolicy: proof.authorityPolicy, currentRevocationPolicy: signer.policy };
    expectCode(
      () => verifyHistoricalReceiptJournalBytes(bytes, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), journalBytes(journal)]), signer.policy, options),
      "STRICT_JSON_BOM",
    );
    expectCode(() => verifyHistoricalReceiptJournalBytes(bytes, Buffer.from([0xc3, 0x28]), signer.policy, options), "STRICT_JSON_UTF8");
    expectCode(
      () => verifyHistoricalReceiptJournalBytes(bytes, Buffer.from(`{"receiptId":"${journal.receiptId}","receiptId":"${journal.receiptId}"}`), signer.policy, options),
      "STRICT_JSON_DUPLICATE_KEY",
    );
    expectCode(() => verifyHistoricalReceiptJournalBytes(bytes, Buffer.from('{"events":"unterminated'), signer.policy, options), "STRICT_JSON_TRUNCATED");
  });
});
