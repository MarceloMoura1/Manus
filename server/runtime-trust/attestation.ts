import { createHash, createPublicKey, timingSafeEqual, verify as verifyEd25519 } from "node:crypto";

import {
  canonicalSha256,
  canonicalUtf8,
  isStrictJsonRecord,
  parseStrictJsonBytes,
  RuntimeTrustError,
  type StrictJsonRecord,
  type StrictJsonValue,
} from "./strict-json";
import {
  SYNTHETIC_JOURNAL_KIND,
  SYNTHETIC_JOURNAL_VERSION,
  type SyntheticJournal,
  type SyntheticJournalContext,
  type SyntheticJournalEvent,
} from "./synthetic-journal";

export const RUNTIME_TRUST_ENVELOPE_KIND = "megadesk-runtime-trust-signed-envelope";
export const RUNTIME_TRUST_ENVELOPE_VERSION = 3;
export const RUNTIME_TRUST_PROTOCOL_DOMAIN = "megadesk-runtime-trust/v3";
export const TIME_EVIDENCE_ENVELOPE_KIND = "megadesk-runtime-trust-time-evidence";
export const TIME_EVIDENCE_ENVELOPE_VERSION = 1;
export const TIME_EVIDENCE_PROTOCOL_DOMAIN = "megadesk-runtime-trust/time-evidence/v1";

export const TRUST_PURPOSES = [
  "backup-orchestrator-identity",
  "runtime-promotion-authorization",
  "runtime-promotion-receipt",
] as const;

export type TrustPurpose = (typeof TRUST_PURPOSES)[number];

export interface TrustedKey {
  keyId: string;
  purpose: TrustPurpose;
  publicKeyPem: string;
  publicKeySha256: string;
  notBefore: string;
  notAfter: string;
  status: "active" | "revoked";
  revocation?: {
    occurredAt: string;
    reason: "compromise" | "superseded";
  };
}

/**
 * The caller supplies this policy from an independently authenticated trust
 * source. This library never treats a host-local JSON file as a trust root.
 */
export interface TrustPolicy {
  kind: "megadesk-runtime-trust-policy";
  version: 1;
  trustSetId: string;
  revocationStatus: "available" | "unavailable";
  revocationSetSha256: string;
  historicalReceiptRevocation: "reject-all-revoked" | "allow-superseded-before-revocation";
  maxAttestationTtlMs: number;
  keys: readonly TrustedKey[];
}

/**
 * A distinct trust root for signed signature-time evidence. It deliberately
 * cannot be substituted by a runtime-receipt signing key.
 */
export interface TimeAuthorityKey {
  keyId: string;
  publicKeyPem: string;
  publicKeySha256: string;
  notBefore: string;
  notAfter: string;
  status: "active" | "revoked";
  revocation?: {
    occurredAt: string;
    reason: "compromise" | "superseded";
  };
}

export interface TimeAuthorityPolicy {
  kind: "megadesk-runtime-trust-time-authority-policy";
  version: 1;
  authoritySetId: string;
  revocationStatus: "available" | "unavailable";
  revocationSetSha256: string;
  maxEvidenceTtlMs: number;
  keys: readonly TimeAuthorityKey[];
}

export interface VerificationOptions {
  now: Date;
  expectedPurpose?: TrustPurpose;
  expectedScope?: string;
}

export interface HistoricalReceiptVerificationOptions {
  now: Date;
  expectedScope?: string;
  /** Exact signed time-evidence envelope bytes. A Date supplied by a caller is
   * never evidence. Omission fails closed until human governance configures an
   * independently authenticated time authority. */
  timeEvidenceBytes?: Uint8Array;
  timeAuthorityPolicy?: TimeAuthorityPolicy;
  /**
   * Independently authenticated current trust state. The receipt itself is
   * bound to the immutable policy snapshot supplied as `policy`; current
   * revocation status is deliberately evaluated separately so a legitimate
   * revocation does not rewrite that historical snapshot.
   */
  currentRevocationPolicy?: TrustPolicy;
}

export interface VerifiedEnvelope {
  purpose: TrustPurpose;
  payload: Readonly<StrictJsonRecord>;
  payloadSha256: string;
  keyId: string;
  policySha256: string;
  revocationSetSha256: string;
}

export interface VerifiedReceiptJournal {
  receipt: VerifiedEnvelope;
  journal: Readonly<SyntheticJournal>;
  timeEvidenceId: string;
}

interface ValidatedEnvelope {
  purpose: TrustPurpose;
  payload: StrictJsonRecord;
  payloadSha256: string;
  keyId: string;
  signature: Buffer;
  protectedHeader: StrictJsonRecord;
}

const SHA_256 = /^[a-f0-9]{64}$/;
const GIT_OBJECT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function fail(code: string, message: string): never {
  throw new RuntimeTrustError(code, message);
}

function asRecord(value: StrictJsonValue, label: string): StrictJsonRecord {
  if (!isStrictJsonRecord(value)) fail("TRUST_SCHEMA_INVALID", `${label} must be a JSON object.`);
  return value;
}

function assertExactKeys(record: StrictJsonRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    fail("TRUST_SCHEMA_CLOSED", `${label} contains absent or unknown fields.`);
  }
}

function stringField(record: StrictJsonRecord, name: string, label: string): string {
  const value = record[name];
  if (typeof value !== "string" || value.length === 0) fail("TRUST_SCHEMA_INVALID", `${label}.${name} must be a non-empty string.`);
  return value;
}

function integerField(record: StrictJsonRecord, name: string, label: string): number {
  const value = record[name];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) fail("TRUST_SCHEMA_INVALID", `${label}.${name} must be a safe integer.`);
  return value;
}

function enumField<T extends string>(record: StrictJsonRecord, name: string, allowed: readonly T[], label: string): T {
  const value = stringField(record, name, label);
  if (!allowed.includes(value as T)) fail("TRUST_SCHEMA_INVALID", `${label}.${name} is not an allowed value.`);
  return value as T;
}

function sha256Field(record: StrictJsonRecord, name: string, label: string): string {
  const value = stringField(record, name, label);
  if (!SHA_256.test(value)) fail("TRUST_SCHEMA_INVALID", `${label}.${name} must be a lower-case SHA-256 hex digest.`);
  return value;
}

function gitObjectField(record: StrictJsonRecord, name: string, label: string): string {
  const value = stringField(record, name, label);
  if (!GIT_OBJECT.test(value)) fail("TRUST_SCHEMA_INVALID", `${label}.${name} must be a Git object ID.`);
  return value;
}

function uuidField(record: StrictJsonRecord, name: string, label: string): string {
  const value = stringField(record, name, label);
  if (!UUID.test(value)) fail("TRUST_SCHEMA_INVALID", `${label}.${name} must be a lower-case canonical UUID.`);
  return value;
}

function instantField(record: StrictJsonRecord, name: string, label: string): number {
  const value = stringField(record, name, label);
  const instant = Date.parse(value);
  if (!Number.isFinite(instant) || new Date(instant).toISOString() !== value) {
    fail("TRUST_SCHEMA_INVALID", `${label}.${name} must be a canonical UTC ISO-8601 instant.`);
  }
  return instant;
}

function canonicalInstant(value: string, label: string): number {
  const instant = Date.parse(value);
  if (!Number.isFinite(instant) || new Date(instant).toISOString() !== value) {
    fail("TRUST_POLICY_INVALID", `${label} must be a canonical UTC ISO-8601 instant.`);
  }
  return instant;
}

function equalDigest(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

/**
 * Policy hashes include ordered arrays. JCS orders object members by UTF-16
 * code units; the same deterministic order is used for key arrays here. Do
 * not use locale-sensitive collation for a value that participates in a hash.
 */
function compareUtf16CodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function publicKeyMaterialSha256(pem: string, invalidCode: string, label: string): string {
  let key: ReturnType<typeof createPublicKey>;
  try {
    key = createPublicKey(pem);
  } catch {
    fail(invalidCode, `${label} public key cannot be parsed.`);
  }
  if (key.asymmetricKeyType !== "ed25519") fail(invalidCode, `${label} key must be Ed25519.`);
  return createHash("sha256").update(key.export({ format: "der", type: "spki" })).digest("hex");
}

function decodeBase64(value: string): Buffer {
  if (!BASE64.test(value)) fail("TRUST_SIGNATURE_INVALID", "Signature must be canonical base64.");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 64 || decoded.toString("base64") !== value) {
    fail("TRUST_SIGNATURE_INVALID", "Ed25519 signature must contain exactly 64 bytes.");
  }
  return decoded;
}

function assertIdentityPayload(payload: StrictJsonRecord): void {
  assertExactKeys(payload, [
    "artifact", "attestationId", "expiresAt", "issuedAt", "kind", "orchestrator", "scope", "trustSetVersion", "version",
  ], "identity payload");
  if (stringField(payload, "kind", "identity payload") !== "megadesk-backup-orchestrator-identity") fail("TRUST_SCHEMA_INVALID", "Unexpected identity payload kind.");
  if (integerField(payload, "version", "identity payload") !== 1) fail("TRUST_SCHEMA_INVALID", "Unsupported identity payload version.");
  uuidField(payload, "attestationId", "identity payload");
  instantField(payload, "issuedAt", "identity payload");
  instantField(payload, "expiresAt", "identity payload");
  if (stringField(payload, "scope", "identity payload") !== "backup-orchestrator-identity") fail("TRUST_SCHEMA_INVALID", "Identity scope is invalid.");
  if (integerField(payload, "trustSetVersion", "identity payload") < 1) fail("TRUST_SCHEMA_INVALID", "trustSetVersion must be positive.");

  const orchestrator = asRecord(payload.orchestrator, "identity payload.orchestrator");
  assertExactKeys(orchestrator, ["gitBlob", "gitCommit", "gitTree", "logicalName", "sha256", "sizeBytes"], "identity payload.orchestrator");
  stringField(orchestrator, "logicalName", "identity payload.orchestrator");
  sha256Field(orchestrator, "sha256", "identity payload.orchestrator");
  gitObjectField(orchestrator, "gitBlob", "identity payload.orchestrator");
  gitObjectField(orchestrator, "gitTree", "identity payload.orchestrator");
  gitObjectField(orchestrator, "gitCommit", "identity payload.orchestrator");
  if (integerField(orchestrator, "sizeBytes", "identity payload.orchestrator") < 0) fail("TRUST_SCHEMA_INVALID", "orchestrator.sizeBytes must be non-negative.");

  const artifact = asRecord(payload.artifact, "identity payload.artifact");
  assertExactKeys(artifact, ["manifestSha256", "packageSha256"], "identity payload.artifact");
  sha256Field(artifact, "manifestSha256", "identity payload.artifact");
  sha256Field(artifact, "packageSha256", "identity payload.artifact");
}

function assertAuthorizationPayload(payload: StrictJsonRecord): void {
  assertExactKeys(payload, [
    "attestationSha256", "authorizationId", "candidate", "expiresAt", "issuedAt", "kind", "nonce", "operationId", "scope", "version",
  ], "authorization payload");
  if (stringField(payload, "kind", "authorization payload") !== "megadesk-runtime-promotion-authorization") fail("TRUST_SCHEMA_INVALID", "Unexpected authorization payload kind.");
  if (integerField(payload, "version", "authorization payload") !== 1) fail("TRUST_SCHEMA_INVALID", "Unsupported authorization payload version.");
  uuidField(payload, "authorizationId", "authorization payload");
  uuidField(payload, "operationId", "authorization payload");
  instantField(payload, "issuedAt", "authorization payload");
  instantField(payload, "expiresAt", "authorization payload");
  if (stringField(payload, "scope", "authorization payload") !== "runtime-promotion") fail("TRUST_SCHEMA_INVALID", "Authorization scope is invalid.");
  sha256Field(payload, "attestationSha256", "authorization payload");
  const nonce = stringField(payload, "nonce", "authorization payload");
  if (!/^[a-f0-9]{64}$/.test(nonce)) fail("TRUST_SCHEMA_INVALID", "Authorization nonce must be 32 random bytes encoded as hex.");

  const candidate = asRecord(payload.candidate, "authorization payload.candidate");
  assertExactKeys(candidate, ["artifactSha256", "gitCommit", "gitTree", "manifestSha256"], "authorization payload.candidate");
  sha256Field(candidate, "artifactSha256", "authorization payload.candidate");
  sha256Field(candidate, "manifestSha256", "authorization payload.candidate");
  gitObjectField(candidate, "gitCommit", "authorization payload.candidate");
  gitObjectField(candidate, "gitTree", "authorization payload.candidate");
}

function assertReceiptPayload(payload: StrictJsonRecord): void {
  assertExactKeys(payload, [
    "authorizationId", "backup", "candidate", "executorId", "issuedAt", "journal", "kind", "operationId", "previous", "receiptId", "scope", "trustPolicy", "version",
  ], "receipt payload");
  if (stringField(payload, "kind", "receipt payload") !== "megadesk-app-runtime-promotion-receipt") fail("TRUST_SCHEMA_INVALID", "Unexpected receipt payload kind.");
  if (integerField(payload, "version", "receipt payload") !== 1) fail("TRUST_SCHEMA_INVALID", "Unsupported receipt payload version.");
  uuidField(payload, "receiptId", "receipt payload");
  uuidField(payload, "authorizationId", "receipt payload");
  uuidField(payload, "operationId", "receipt payload");
  instantField(payload, "issuedAt", "receipt payload");
  if (stringField(payload, "scope", "receipt payload") !== "runtime-promotion-receipt") fail("TRUST_SCHEMA_INVALID", "Receipt scope is invalid.");
  stringField(payload, "executorId", "receipt payload");
  for (const name of ["previous", "candidate"] as const) {
    const runtime = asRecord(payload[name], `receipt payload.${name}`);
    assertExactKeys(runtime, ["composeSha256", "releaseSha", "runtimeSha256"], `receipt payload.${name}`);
    sha256Field(runtime, "composeSha256", `receipt payload.${name}`);
    gitObjectField(runtime, "releaseSha", `receipt payload.${name}`);
    sha256Field(runtime, "runtimeSha256", `receipt payload.${name}`);
  }
  const backup = asRecord(payload.backup, "receipt payload.backup");
  assertExactKeys(backup, ["databaseSha256", "manifestSha256", "mediaSha256", "runId"], "receipt payload.backup");
  stringField(backup, "runId", "receipt payload.backup");
  sha256Field(backup, "manifestSha256", "receipt payload.backup");
  sha256Field(backup, "databaseSha256", "receipt payload.backup");
  sha256Field(backup, "mediaSha256", "receipt payload.backup");
  const journal = asRecord(payload.journal, "receipt payload.journal");
  assertExactKeys(journal, ["authorizationId", "kind", "operationId", "receiptId", "sha256", "version"], "receipt payload.journal");
  if (stringField(journal, "kind", "receipt payload.journal") !== "megadesk-runtime-trust-synthetic-journal") fail("TRUST_SCHEMA_INVALID", "Receipt journal kind is invalid.");
  if (integerField(journal, "version", "receipt payload.journal") !== 1) fail("TRUST_SCHEMA_INVALID", "Receipt journal version is invalid.");
  sha256Field(journal, "sha256", "receipt payload.journal");
  if (stringField(journal, "receiptId", "receipt payload.journal") !== stringField(payload, "receiptId", "receipt payload")) fail("TRUST_SCHEMA_INVALID", "Receipt journal receiptId does not match.");
  if (stringField(journal, "operationId", "receipt payload.journal") !== stringField(payload, "operationId", "receipt payload")) fail("TRUST_SCHEMA_INVALID", "Receipt journal operationId does not match.");
  if (stringField(journal, "authorizationId", "receipt payload.journal") !== stringField(payload, "authorizationId", "receipt payload")) fail("TRUST_SCHEMA_INVALID", "Receipt journal authorizationId does not match.");
  const trustPolicy = asRecord(payload.trustPolicy, "receipt payload.trustPolicy");
  assertExactKeys(trustPolicy, ["revocationSetSha256", "sha256", "trustSetId", "version"], "receipt payload.trustPolicy");
  if (integerField(trustPolicy, "version", "receipt payload.trustPolicy") !== 1) fail("TRUST_SCHEMA_INVALID", "Receipt trust-policy version is invalid.");
  stringField(trustPolicy, "trustSetId", "receipt payload.trustPolicy");
  sha256Field(trustPolicy, "sha256", "receipt payload.trustPolicy");
  sha256Field(trustPolicy, "revocationSetSha256", "receipt payload.trustPolicy");
}

function assertTimeEvidencePayload(payload: StrictJsonRecord): void {
  assertExactKeys(payload, [
    "authorityPolicySha256", "authoritySetId", "evidenceId", "expiresAt", "issuedAt", "kind", "receiptEnvelopeSha256", "receiptPolicySha256", "receiptRevocationSetSha256", "scope", "signedAt", "version",
  ], "time evidence payload");
  if (stringField(payload, "kind", "time evidence payload") !== "megadesk-runtime-trust-receipt-signature-time") fail("TRUST_TIME_EVIDENCE_INVALID", "Unexpected time-evidence payload kind.");
  if (integerField(payload, "version", "time evidence payload") !== 1) fail("TRUST_TIME_EVIDENCE_INVALID", "Unsupported time-evidence payload version.");
  uuidField(payload, "evidenceId", "time evidence payload");
  if (stringField(payload, "scope", "time evidence payload") !== "runtime-promotion-receipt-signature-time") fail("TRUST_TIME_EVIDENCE_INVALID", "Time-evidence scope is invalid.");
  stringField(payload, "authoritySetId", "time evidence payload");
  for (const name of ["authorityPolicySha256", "receiptEnvelopeSha256", "receiptPolicySha256", "receiptRevocationSetSha256"] as const) {
    sha256Field(payload, name, "time evidence payload");
  }
  const signedAt = instantField(payload, "signedAt", "time evidence payload");
  const issuedAt = instantField(payload, "issuedAt", "time evidence payload");
  const expiresAt = instantField(payload, "expiresAt", "time evidence payload");
  if (signedAt > issuedAt || expiresAt <= issuedAt) fail("TRUST_TIME_EVIDENCE_INVALID", "Time-evidence validity interval is invalid.");
}

export function validateTrustPayload(payload: StrictJsonRecord): TrustPurpose {
  const kind = stringField(payload, "kind", "payload");
  if (kind === "megadesk-backup-orchestrator-identity") {
    assertIdentityPayload(payload);
    return "backup-orchestrator-identity";
  }
  if (kind === "megadesk-runtime-promotion-authorization") {
    assertAuthorizationPayload(payload);
    return "runtime-promotion-authorization";
  }
  if (kind === "megadesk-app-runtime-promotion-receipt") {
    assertReceiptPayload(payload);
    return "runtime-promotion-receipt";
  }
  fail("TRUST_SCHEMA_INVALID", "Payload kind is unsupported.");
}

function validateEnvelope(value: StrictJsonValue): ValidatedEnvelope {
  const envelope = asRecord(value, "signed envelope");
  assertExactKeys(envelope, ["kind", "payload", "protected", "signature", "version"], "signed envelope");
  if (stringField(envelope, "kind", "signed envelope") !== RUNTIME_TRUST_ENVELOPE_KIND) fail("TRUST_SCHEMA_INVALID", "Unexpected signed envelope kind.");
  if (integerField(envelope, "version", "signed envelope") !== RUNTIME_TRUST_ENVELOPE_VERSION) fail("TRUST_SCHEMA_INVALID", "Unsupported signed envelope version.");
  const protectedHeader = asRecord(envelope.protected, "signed envelope.protected");
  assertExactKeys(protectedHeader, ["domain", "envelopeKind", "keyId", "payloadSha256", "payloadType", "protocolVersion"], "signed envelope.protected");
  if (stringField(protectedHeader, "domain", "signed envelope.protected") !== RUNTIME_TRUST_PROTOCOL_DOMAIN) fail("TRUST_DOMAIN_MISMATCH", "Signed envelope domain is invalid.");
  if (stringField(protectedHeader, "envelopeKind", "signed envelope.protected") !== RUNTIME_TRUST_ENVELOPE_KIND) fail("TRUST_DOMAIN_MISMATCH", "Protected envelope kind is invalid.");
  if (integerField(protectedHeader, "protocolVersion", "signed envelope.protected") !== RUNTIME_TRUST_ENVELOPE_VERSION) fail("TRUST_DOMAIN_MISMATCH", "Protected protocol version is invalid.");
  const purpose = enumField(protectedHeader, "payloadType", TRUST_PURPOSES, "signed envelope.protected");
  const payload = asRecord(envelope.payload, "signed envelope.payload");
  const payloadSha256 = sha256Field(protectedHeader, "payloadSha256", "signed envelope.protected");
  const actualPayloadSha256 = canonicalSha256(payload);
  if (!equalDigest(payloadSha256, actualPayloadSha256)) fail("TRUST_PAYLOAD_DIGEST_MISMATCH", "Signed envelope payload digest does not match canonical payload bytes.");
  if (validateTrustPayload(payload) !== purpose) fail("TRUST_PURPOSE_MISMATCH", "Envelope purpose does not match the payload kind.");

  const signature = asRecord(envelope.signature, "signed envelope.signature");
  assertExactKeys(signature, ["algorithm", "encoding", "keyId", "value"], "signed envelope.signature");
  if (stringField(signature, "algorithm", "signed envelope.signature") !== "Ed25519") fail("TRUST_SIGNATURE_INVALID", "Only Ed25519 signatures are supported.");
  if (stringField(signature, "encoding", "signed envelope.signature") !== "base64") fail("TRUST_SIGNATURE_INVALID", "Only base64 signatures are supported.");
  const keyId = stringField(protectedHeader, "keyId", "signed envelope.protected");
  if (stringField(signature, "keyId", "signed envelope.signature") !== keyId) {
    fail("TRUST_KEY_ID_MISMATCH", "Unprotected signature keyId does not match the signed protected keyId.");
  }
  return { purpose, payload, payloadSha256, keyId, signature: decodeBase64(stringField(signature, "value", "signed envelope.signature")), protectedHeader };
}

export function signedEnvelopeBytes(protectedHeader: StrictJsonRecord, payload: StrictJsonRecord): Buffer {
  return canonicalUtf8({ payload, protected: protectedHeader });
}

function keyPolicyValue(key: TrustedKey): StrictJsonRecord {
  return {
    keyId: key.keyId,
    notAfter: key.notAfter,
    notBefore: key.notBefore,
    publicKeySha256: key.publicKeySha256,
    purpose: key.purpose,
    revocation: key.revocation ? { occurredAt: key.revocation.occurredAt, reason: key.revocation.reason } : null,
    status: key.status,
  };
}

/** Canonical, secret-free policy identity. PEM bytes are represented by their
 * separately validated SHA-256 so the hash is stable across object ordering. */
export function canonicalTrustPolicyValue(policy: TrustPolicy): StrictJsonRecord {
  return {
    historicalReceiptRevocation: policy.historicalReceiptRevocation,
    keys: [...policy.keys].sort((left, right) => compareUtf16CodeUnits(left.keyId, right.keyId)).map(keyPolicyValue),
    kind: policy.kind,
    maxAttestationTtlMs: policy.maxAttestationTtlMs,
    revocationSetSha256: policy.revocationSetSha256,
    revocationStatus: policy.revocationStatus,
    trustSetId: policy.trustSetId,
    version: policy.version,
  };
}

export function trustPolicySha256(policy: TrustPolicy): string {
  validateTrustPolicy(policy);
  return canonicalSha256(canonicalTrustPolicyValue(policy));
}

function timeAuthorityKeyValue(key: TimeAuthorityKey): StrictJsonRecord {
  return {
    keyId: key.keyId,
    notAfter: key.notAfter,
    notBefore: key.notBefore,
    publicKeySha256: key.publicKeySha256,
    revocation: key.revocation ? { occurredAt: key.revocation.occurredAt, reason: key.revocation.reason } : null,
    status: key.status,
  };
}

function canonicalTimeAuthorityPolicyValue(policy: TimeAuthorityPolicy): StrictJsonRecord {
  return {
    authoritySetId: policy.authoritySetId,
    keys: [...policy.keys].sort((left, right) => compareUtf16CodeUnits(left.keyId, right.keyId)).map(timeAuthorityKeyValue),
    kind: policy.kind,
    maxEvidenceTtlMs: policy.maxEvidenceTtlMs,
    revocationSetSha256: policy.revocationSetSha256,
    revocationStatus: policy.revocationStatus,
    version: policy.version,
  };
}

export function timeAuthorityPolicySha256(policy: TimeAuthorityPolicy): string {
  validateTimeAuthorityPolicy(policy);
  return canonicalSha256(canonicalTimeAuthorityPolicyValue(policy));
}

function validateTrustPolicy(policy: TrustPolicy): void {
  if (policy.kind !== "megadesk-runtime-trust-policy" || policy.version !== 1 || policy.trustSetId.length === 0 || !SHA_256.test(policy.revocationSetSha256)) {
    fail("TRUST_POLICY_INVALID", "Trust policy identity is invalid.");
  }
  if (!Number.isSafeInteger(policy.maxAttestationTtlMs) || policy.maxAttestationTtlMs <= 0) {
    fail("TRUST_POLICY_INVALID", "Trust policy maxAttestationTtlMs must be positive.");
  }
  if (policy.revocationStatus !== "available" && policy.revocationStatus !== "unavailable") {
    fail("TRUST_POLICY_INVALID", "Trust policy revocation status is invalid.");
  }
  if (policy.historicalReceiptRevocation !== "reject-all-revoked" && policy.historicalReceiptRevocation !== "allow-superseded-before-revocation") {
    fail("TRUST_POLICY_INVALID", "Trust policy historical receipt revocation policy is invalid.");
  }
  const keyIds = new Set<string>();
  const publicKeyMaterials = new Set<string>();
  for (const key of policy.keys) {
    if (typeof key.keyId !== "string" || key.keyId.length === 0 || keyIds.has(key.keyId)) fail("TRUST_POLICY_INVALID", "Trust policy key IDs must be unique and non-empty.");
    keyIds.add(key.keyId);
    if (!equalDigest(createHash("sha256").update(key.publicKeyPem, "utf8").digest("hex"), key.publicKeySha256)) fail("TRUST_POLICY_INVALID", "Trust policy public-key digest does not match its PEM bytes.");
    const material = publicKeyMaterialSha256(key.publicKeyPem, "TRUST_POLICY_INVALID", "Trust policy");
    if (publicKeyMaterials.has(material)) fail("TRUST_POLICY_INVALID", "Trust policy may not assign one public key material to multiple key IDs.");
    publicKeyMaterials.add(material);
    if (!TRUST_PURPOSES.includes(key.purpose) || !SHA_256.test(key.publicKeySha256) || (key.status !== "active" && key.status !== "revoked")) {
      fail("TRUST_POLICY_INVALID", "Trust policy key metadata is invalid.");
    }
    const notBefore = canonicalInstant(key.notBefore, "Trust policy key notBefore");
    const notAfter = canonicalInstant(key.notAfter, "Trust policy key notAfter");
    if (notAfter <= notBefore) fail("TRUST_POLICY_INVALID", "Trust policy key validity is invalid.");
    if (key.status === "revoked") {
      if (!key.revocation) fail("TRUST_POLICY_INVALID", "A revoked key requires signed revocation metadata.");
      const revokedAt = canonicalInstant(key.revocation.occurredAt, "Trust policy key revocation time");
      if (revokedAt < notBefore || (key.revocation.reason !== "compromise" && key.revocation.reason !== "superseded")) {
        fail("TRUST_POLICY_INVALID", "Trust policy key revocation metadata is invalid.");
      }
    } else if (key.revocation) {
      fail("TRUST_POLICY_INVALID", "An active key cannot carry revocation metadata.");
    }
  }
}

function validateTimeAuthorityPolicy(policy: TimeAuthorityPolicy): void {
  if (policy.kind !== "megadesk-runtime-trust-time-authority-policy" || policy.version !== 1 || policy.authoritySetId.length === 0 || !SHA_256.test(policy.revocationSetSha256)) {
    fail("TRUST_TIME_AUTHORITY_INVALID", "Time-authority policy identity is invalid.");
  }
  if (policy.revocationStatus !== "available" || !Number.isSafeInteger(policy.maxEvidenceTtlMs) || policy.maxEvidenceTtlMs <= 0) {
    fail("TRUST_TIME_AUTHORITY_INVALID", "Time-authority policy availability or maximum evidence TTL is invalid.");
  }
  const keyIds = new Set<string>();
  const publicKeyMaterials = new Set<string>();
  for (const key of policy.keys) {
    if (typeof key.keyId !== "string" || key.keyId.length === 0 || keyIds.has(key.keyId) || !SHA_256.test(key.publicKeySha256)) {
      fail("TRUST_TIME_AUTHORITY_INVALID", "Time-authority key identifiers and material must be unique.");
    }
    keyIds.add(key.keyId);
    if (!equalDigest(createHash("sha256").update(key.publicKeyPem, "utf8").digest("hex"), key.publicKeySha256)) fail("TRUST_TIME_AUTHORITY_INVALID", "Time-authority public-key digest does not match its PEM bytes.");
    const material = publicKeyMaterialSha256(key.publicKeyPem, "TRUST_TIME_AUTHORITY_INVALID", "Time-authority");
    if (publicKeyMaterials.has(material)) fail("TRUST_TIME_AUTHORITY_INVALID", "Time-authority policy may not assign one public key material to multiple key IDs.");
    publicKeyMaterials.add(material);
    const notBefore = canonicalInstant(key.notBefore, "Time-authority key notBefore");
    const notAfter = canonicalInstant(key.notAfter, "Time-authority key notAfter");
    if (notAfter <= notBefore || (key.status !== "active" && key.status !== "revoked")) fail("TRUST_TIME_AUTHORITY_INVALID", "Time-authority key validity is invalid.");
    if (key.status === "revoked") {
      if (!key.revocation) fail("TRUST_TIME_AUTHORITY_INVALID", "A revoked time-authority key requires revocation metadata.");
      const revokedAt = canonicalInstant(key.revocation.occurredAt, "Time-authority revocation time");
      if (revokedAt < notBefore || (key.revocation.reason !== "compromise" && key.revocation.reason !== "superseded")) {
        fail("TRUST_TIME_AUTHORITY_INVALID", "Time-authority revocation metadata is invalid.");
      }
    } else if (key.revocation) {
      fail("TRUST_TIME_AUTHORITY_INVALID", "An active time-authority key cannot carry revocation metadata.");
    }
  }
}

/**
 * A receipt signer must never be able to act as its own time authority. Key
 * labels and PEM formatting are not identities, so compare parsed SPKI/DER
 * material after both policies have passed their individual validation.
 */
function assertDistinctTimeAuthorityMaterial(receiptPolicy: TrustPolicy, authorityPolicy: TimeAuthorityPolicy): void {
  const receiptMaterials = new Set(
    receiptPolicy.keys.map(key => publicKeyMaterialSha256(key.publicKeyPem, "TRUST_POLICY_INVALID", "Trust policy")),
  );
  for (const key of authorityPolicy.keys) {
    const material = publicKeyMaterialSha256(key.publicKeyPem, "TRUST_TIME_AUTHORITY_INVALID", "Time-authority");
    if (receiptMaterials.has(material)) {
      fail("TRUST_TIME_AUTHORITY_NOT_DISTINCT", "Time-authority key material must be distinct from every receipt trust-policy key.");
    }
  }
}

function assertPayloadValidity(payload: StrictJsonRecord, now: number, maxTtlMs: number): void {
  const issuedAt = instantField(payload, "issuedAt", "payload");
  if (!("expiresAt" in payload)) {
    if (issuedAt > now) fail("TRUST_VALIDITY_INVALID", "Receipt issue time is in the future.");
    return;
  }
  const expiresAt = instantField(payload, "expiresAt", "payload");
  if (expiresAt <= issuedAt || expiresAt - issuedAt > maxTtlMs) fail("TRUST_VALIDITY_INVALID", "Payload validity interval is invalid.");
  if (now < issuedAt || now > expiresAt) fail("TRUST_ATTESTATION_EXPIRED", "Payload is outside its validity interval.");
}

function validNow(value: Date): number {
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds)) fail("TRUST_VALIDITY_INVALID", "Verification time is invalid.");
  return milliseconds;
}

function assertExpectedEnvelope(validated: ValidatedEnvelope, expectedPurpose?: TrustPurpose, expectedScope?: string): void {
  if (expectedPurpose && expectedPurpose !== validated.purpose) fail("TRUST_PURPOSE_MISMATCH", "Signed envelope purpose is not authorized for this operation.");
  if (expectedScope && stringField(validated.payload, "scope", "payload") !== expectedScope) fail("TRUST_SCOPE_MISMATCH", "Signed envelope scope does not match the requested operation.");
}

function trustedKeyFor(validated: ValidatedEnvelope, policy: TrustPolicy): TrustedKey {
  const key = policy.keys.find(candidate => candidate.keyId === validated.keyId && candidate.purpose === validated.purpose);
  if (!key) fail("TRUST_KEY_UNKNOWN", "No trusted key authorizes this purpose.");
  return key;
}

function assertSignature(validated: ValidatedEnvelope, key: TrustedKey): void {
  const actualKeySha256 = createHash("sha256").update(key.publicKeyPem, "utf8").digest("hex");
  if (!equalDigest(actualKeySha256, key.publicKeySha256)) fail("TRUST_KEY_DIGEST_MISMATCH", "Trusted public key bytes do not match the policy digest.");

  let publicKey: ReturnType<typeof createPublicKey>;
  try {
    publicKey = createPublicKey(key.publicKeyPem);
  } catch {
    fail("TRUST_KEY_INVALID", "Trusted public key cannot be parsed.");
  }
  if (publicKey.asymmetricKeyType !== "ed25519") fail("TRUST_KEY_INVALID", "Trusted key must be an Ed25519 public key.");
  const signedBytes = signedEnvelopeBytes(validated.protectedHeader, validated.payload);
  if (!verifyEd25519(null, signedBytes, publicKey, validated.signature)) fail("TRUST_SIGNATURE_INVALID", "Ed25519 signature verification failed.");
}

function asVerified(validated: ValidatedEnvelope): VerifiedEnvelope {
  return deepFreeze({
    purpose: validated.purpose,
    payload: structuredClone(validated.payload),
    payloadSha256: validated.payloadSha256,
    keyId: validated.keyId,
    policySha256: "",
    revocationSetSha256: "",
  });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function asVerifiedWithPolicy(validated: ValidatedEnvelope, policy: TrustPolicy): VerifiedEnvelope {
  const verified = asVerified(validated);
  return deepFreeze({ ...verified, policySha256: trustPolicySha256(policy), revocationSetSha256: policy.revocationSetSha256 });
}

/**
 * Verifies an authorization that is valid now. Historical receipts use the
 * separate API below because their signature time must come from external
 * evidence, never from the signed issuedAt field alone.
 */
export function verifySignedEnvelopeBytes(input: Uint8Array, policy: TrustPolicy, options: VerificationOptions): VerifiedEnvelope {
  validateTrustPolicy(policy);
  if (policy.revocationStatus !== "available") fail("TRUST_REVOCATION_UNAVAILABLE", "Revocation status is unavailable; verification fails closed.");
  const validated = validateEnvelope(parseStrictJsonBytes(input));
  if (validated.purpose === "runtime-promotion-receipt") fail("TRUST_HISTORICAL_RECEIPT_API_REQUIRED", "Receipts require verified external signature-time evidence.");
  assertExpectedEnvelope(validated, options.expectedPurpose, options.expectedScope);
  const now = validNow(options.now);
  assertPayloadValidity(validated.payload, now, policy.maxAttestationTtlMs);
  const key = trustedKeyFor(validated, policy);
  if (key.status !== "active") fail("TRUST_KEY_REVOKED", "The signing key is revoked.");
  const keyNotBefore = canonicalInstant(key.notBefore, "Trust policy key notBefore");
  const keyNotAfter = canonicalInstant(key.notAfter, "Trust policy key notAfter");
  if (now < keyNotBefore || now > keyNotAfter) fail("TRUST_KEY_EXPIRED", "The signing key is outside its validity interval.");
  assertSignature(validated, key);
  return asVerifiedWithPolicy(validated, policy);
}

interface ValidatedTimeEvidence {
  payload: StrictJsonRecord;
  protectedHeader: StrictJsonRecord;
  keyId: string;
  signature: Buffer;
}

function timeEvidenceSignedBytes(protectedHeader: StrictJsonRecord, payload: StrictJsonRecord): Buffer {
  return canonicalUtf8({ payload, protected: protectedHeader });
}

function validateTimeEvidenceEnvelope(value: StrictJsonValue): ValidatedTimeEvidence {
  const envelope = asRecord(value, "time-evidence envelope");
  assertExactKeys(envelope, ["kind", "payload", "protected", "signature", "version"], "time-evidence envelope");
  if (stringField(envelope, "kind", "time-evidence envelope") !== TIME_EVIDENCE_ENVELOPE_KIND || integerField(envelope, "version", "time-evidence envelope") !== TIME_EVIDENCE_ENVELOPE_VERSION) {
    fail("TRUST_TIME_EVIDENCE_INVALID", "Time-evidence envelope identity is invalid.");
  }
  const protectedHeader = asRecord(envelope.protected, "time-evidence envelope.protected");
  assertExactKeys(protectedHeader, ["authorityPolicySha256", "authoritySetId", "domain", "envelopeKind", "keyId", "payloadSha256", "payloadType", "protocolVersion"], "time-evidence envelope.protected");
  if (stringField(protectedHeader, "domain", "time-evidence envelope.protected") !== TIME_EVIDENCE_PROTOCOL_DOMAIN || stringField(protectedHeader, "envelopeKind", "time-evidence envelope.protected") !== TIME_EVIDENCE_ENVELOPE_KIND || integerField(protectedHeader, "protocolVersion", "time-evidence envelope.protected") !== TIME_EVIDENCE_ENVELOPE_VERSION || stringField(protectedHeader, "payloadType", "time-evidence envelope.protected") !== "runtime-promotion-receipt-signature-time") {
    fail("TRUST_TIME_EVIDENCE_INVALID", "Time-evidence protected header is invalid.");
  }
  const payload = asRecord(envelope.payload, "time-evidence envelope.payload");
  assertTimeEvidencePayload(payload);
  if (!equalDigest(sha256Field(protectedHeader, "payloadSha256", "time-evidence envelope.protected"), canonicalSha256(payload))) fail("TRUST_TIME_EVIDENCE_INVALID", "Time-evidence payload digest does not match its canonical bytes.");
  const signature = asRecord(envelope.signature, "time-evidence envelope.signature");
  assertExactKeys(signature, ["algorithm", "encoding", "keyId", "value"], "time-evidence envelope.signature");
  if (stringField(signature, "algorithm", "time-evidence envelope.signature") !== "Ed25519" || stringField(signature, "encoding", "time-evidence envelope.signature") !== "base64") fail("TRUST_TIME_EVIDENCE_INVALID", "Time-evidence signature metadata is invalid.");
  const keyId = stringField(protectedHeader, "keyId", "time-evidence envelope.protected");
  if (stringField(signature, "keyId", "time-evidence envelope.signature") !== keyId) fail("TRUST_KEY_ID_MISMATCH", "Time-evidence keyId is not protected by its signature.");
  return { payload, protectedHeader, keyId, signature: decodeBase64(stringField(signature, "value", "time-evidence envelope.signature")) };
}

function trustedTimeAuthorityKeyFor(validated: ValidatedTimeEvidence, policy: TimeAuthorityPolicy): TimeAuthorityKey {
  const key = policy.keys.find(candidate => candidate.keyId === validated.keyId);
  if (!key) fail("TRUST_TIME_AUTHORITY_UNKNOWN", "Time-evidence signer is not trusted by the configured authority policy.");
  return key;
}

function assertTimeAuthoritySignature(validated: ValidatedTimeEvidence, key: TimeAuthorityKey): void {
  if (!equalDigest(createHash("sha256").update(key.publicKeyPem, "utf8").digest("hex"), key.publicKeySha256)) fail("TRUST_TIME_AUTHORITY_INVALID", "Time-authority public-key digest does not match its policy.");
  let publicKey: ReturnType<typeof createPublicKey>;
  try {
    publicKey = createPublicKey(key.publicKeyPem);
  } catch {
    fail("TRUST_TIME_AUTHORITY_INVALID", "Time-authority public key cannot be parsed.");
  }
  if (publicKey.asymmetricKeyType !== "ed25519" || !verifyEd25519(null, timeEvidenceSignedBytes(validated.protectedHeader, validated.payload), publicKey, validated.signature)) {
    fail("TRUST_TIME_EVIDENCE_INVALID", "Time-evidence signature verification failed.");
  }
}

function assertReceiptPolicyBinding(payload: StrictJsonRecord, policy: TrustPolicy): void {
  const reference = asRecord(payload.trustPolicy, "receipt payload.trustPolicy");
  if (stringField(reference, "trustSetId", "receipt payload.trustPolicy") !== policy.trustSetId || integerField(reference, "version", "receipt payload.trustPolicy") !== policy.version || !equalDigest(sha256Field(reference, "sha256", "receipt payload.trustPolicy"), trustPolicySha256(policy)) || !equalDigest(sha256Field(reference, "revocationSetSha256", "receipt payload.trustPolicy"), policy.revocationSetSha256)) {
    fail("TRUST_POLICY_BINDING_MISMATCH", "Receipt is not bound to the exact trust and revocation policy being evaluated.");
  }
}

/**
 * A receipt authenticates the policy snapshot present when it was issued. A
 * later revocation is current state, not a mutation of those signed bytes. The
 * caller must independently authenticate both policies; this library only
 * checks their continuity for the receipt signing key.
 */
function currentRevocationKeyFor(historicalKey: TrustedKey, historicalPolicy: TrustPolicy, currentPolicy: TrustPolicy | undefined): TrustedKey {
  if (!currentPolicy) {
    fail("TRUST_CURRENT_REVOCATION_UNAVAILABLE", "Historical receipt verification requires an independently authenticated current revocation policy.");
  }
  validateTrustPolicy(currentPolicy);
  if (currentPolicy.revocationStatus !== "available") {
    fail("TRUST_REVOCATION_UNAVAILABLE", "Current revocation status is unavailable; historical verification fails closed.");
  }
  if (currentPolicy.trustSetId !== historicalPolicy.trustSetId || currentPolicy.version !== historicalPolicy.version) {
    fail("TRUST_CURRENT_REVOCATION_INCOMPATIBLE", "Current revocation policy does not continue the receipt trust set.");
  }
  const currentKey = currentPolicy.keys.find(candidate => candidate.keyId === historicalKey.keyId && candidate.purpose === historicalKey.purpose);
  if (!currentKey) {
    fail("TRUST_CURRENT_REVOCATION_INCOMPATIBLE", "Current revocation policy does not contain the historical receipt signing key.");
  }
  const historicalMaterial = publicKeyMaterialSha256(historicalKey.publicKeyPem, "TRUST_POLICY_INVALID", "Historical trust policy");
  const currentMaterial = publicKeyMaterialSha256(currentKey.publicKeyPem, "TRUST_POLICY_INVALID", "Current revocation policy");
  if (!equalDigest(historicalMaterial, currentMaterial)) {
    fail("TRUST_CURRENT_REVOCATION_INCOMPATIBLE", "Current revocation policy changes the historical receipt signing key material.");
  }
  return currentKey;
}

function verifiedSignatureTime(input: Uint8Array, receiptPolicy: TrustPolicy, options: HistoricalReceiptVerificationOptions): { evidenceId: string; signedAt: number } {
  if (!options.timeEvidenceBytes || !options.timeAuthorityPolicy) fail("TRUST_TIME_AUTHORITY_UNAVAILABLE", "Historical receipt verification is blocked until an independently configured time authority is available.");
  const authorityPolicy = options.timeAuthorityPolicy;
  validateTimeAuthorityPolicy(authorityPolicy);
  assertDistinctTimeAuthorityMaterial(receiptPolicy, authorityPolicy);
  const now = validNow(options.now);
  const validated = validateTimeEvidenceEnvelope(parseStrictJsonBytes(options.timeEvidenceBytes));
  const payload = validated.payload;
  const authorityPolicySha = timeAuthorityPolicySha256(authorityPolicy);
  if (stringField(validated.protectedHeader, "authoritySetId", "time-evidence envelope.protected") !== authorityPolicy.authoritySetId || !equalDigest(sha256Field(validated.protectedHeader, "authorityPolicySha256", "time-evidence envelope.protected"), authorityPolicySha) || stringField(payload, "authoritySetId", "time evidence payload") !== authorityPolicy.authoritySetId || !equalDigest(sha256Field(payload, "authorityPolicySha256", "time evidence payload"), authorityPolicySha)) {
    fail("TRUST_TIME_AUTHORITY_INVALID", "Time-evidence is not bound to the configured authority policy.");
  }
  if (!equalDigest(sha256Field(payload, "receiptEnvelopeSha256", "time evidence payload"), createHash("sha256").update(input).digest("hex")) || !equalDigest(sha256Field(payload, "receiptPolicySha256", "time evidence payload"), trustPolicySha256(receiptPolicy)) || !equalDigest(sha256Field(payload, "receiptRevocationSetSha256", "time evidence payload"), receiptPolicy.revocationSetSha256)) {
    fail("TRUST_TIME_EVIDENCE_BINDING_MISMATCH", "Time-evidence is not bound to these exact receipt bytes and receipt policy identities.");
  }
  const issuedAt = instantField(payload, "issuedAt", "time evidence payload");
  const expiresAt = instantField(payload, "expiresAt", "time evidence payload");
  if (expiresAt - issuedAt > authorityPolicy.maxEvidenceTtlMs || now < issuedAt || now > expiresAt) fail("TRUST_TIME_EVIDENCE_EXPIRED", "Time-evidence is outside its permitted validity interval.");
  const key = trustedTimeAuthorityKeyFor(validated, authorityPolicy);
  if (key.status !== "active") fail("TRUST_TIME_AUTHORITY_REVOKED", "Time-authority signing key is revoked.");
  const keyNotBefore = canonicalInstant(key.notBefore, "Time-authority key notBefore");
  const keyNotAfter = canonicalInstant(key.notAfter, "Time-authority key notAfter");
  const signedAt = instantField(payload, "signedAt", "time evidence payload");
  if (now < keyNotBefore || now > keyNotAfter || signedAt < keyNotBefore || signedAt > keyNotAfter || issuedAt < keyNotBefore || issuedAt > keyNotAfter) {
    fail("TRUST_TIME_AUTHORITY_EXPIRED", "Time-authority key must be valid at evidence issuance, claimed signature time, and verification.");
  }
  assertTimeAuthoritySignature(validated, key);
  return { evidenceId: stringField(payload, "evidenceId", "time evidence payload"), signedAt };
}

/** `issuedAt` of a receipt is never treated as a timestamp authority. Historical
 * verification is unavailable without exact signed evidence from a separately
 * configured time authority. */
export function verifyHistoricalReceiptEnvelopeBytes(input: Uint8Array, policy: TrustPolicy, options: HistoricalReceiptVerificationOptions): VerifiedEnvelope {
  validateTrustPolicy(policy);
  if (policy.revocationStatus !== "available") fail("TRUST_REVOCATION_UNAVAILABLE", "Revocation status is unavailable; verification fails closed.");
  const now = validNow(options.now);
  const validated = validateEnvelope(parseStrictJsonBytes(input));
  if (validated.purpose !== "runtime-promotion-receipt") fail("TRUST_PURPOSE_MISMATCH", "Historical verification accepts only runtime promotion receipts.");
  assertExpectedEnvelope(validated, "runtime-promotion-receipt", options.expectedScope);
  assertReceiptPolicyBinding(validated.payload, policy);
  const time = verifiedSignatureTime(input, policy, options);
  if (time.signedAt > now) fail("TRUST_TIME_EVIDENCE_INVALID", "Verified signature time is in the future relative to verification.");
  assertPayloadValidity(validated.payload, time.signedAt, policy.maxAttestationTtlMs);
  const historicalKey = trustedKeyFor(validated, policy);
  const keyNotBefore = canonicalInstant(historicalKey.notBefore, "Trust policy key notBefore");
  const keyNotAfter = canonicalInstant(historicalKey.notAfter, "Trust policy key notAfter");
  if (time.signedAt < keyNotBefore || time.signedAt > keyNotAfter) fail("TRUST_KEY_EXPIRED", "The receipt signing key was outside its validity interval at the authenticated signature time.");
  const currentKey = currentRevocationKeyFor(historicalKey, policy, options.currentRevocationPolicy);
  if (currentKey.status === "revoked") {
    const revocation = currentKey.revocation!;
    const revokedAt = canonicalInstant(revocation.occurredAt, "Trust policy key revocation time");
    const allowed = policy.historicalReceiptRevocation === "allow-superseded-before-revocation" && revocation.reason === "superseded" && time.signedAt < revokedAt;
    if (!allowed) fail("TRUST_KEY_REVOKED", "The receipt signing key is revoked under the historical-receipt policy.");
  }
  assertSignature(validated, historicalKey);
  return asVerifiedWithPolicy(validated, policy);
}

/** Structural journal validation is intentionally private. A structurally
 * coherent journal is not a receipt: only verifyHistoricalReceiptJournalBytes
 * associates it with authenticated receipt and time-evidence bytes. */
function journalRecord(value: StrictJsonValue, label: string): StrictJsonRecord {
  if (!isStrictJsonRecord(value)) fail("JOURNAL_SCHEMA_INVALID", `${label} must be a JSON object.`);
  return value;
}

function assertJournalExactKeys(record: StrictJsonRecord, expected: readonly string[], label: string): void {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail("JOURNAL_SCHEMA_CLOSED", `${label} contains absent or unknown fields.`);
  }
}

function journalStringField(record: StrictJsonRecord, name: string, label: string): string {
  const value = record[name];
  if (typeof value !== "string" || value.length === 0) fail("JOURNAL_SCHEMA_INVALID", `${label}.${name} must be a non-empty string.`);
  return value;
}

function journalSafeIntegerField(record: StrictJsonRecord, name: string, label: string): number {
  const value = record[name];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) fail("JOURNAL_SCHEMA_INVALID", `${label}.${name} must be a safe integer.`);
  return value;
}

function assertJournalInstant(value: string): void {
  const instant = Date.parse(value);
  if (!Number.isFinite(instant) || new Date(instant).toISOString() !== value) {
    fail("JOURNAL_SCHEMA_INVALID", "Journal time must be a canonical UTC ISO-8601 instant.");
  }
}

function assertJournalContext(context: SyntheticJournalContext): void {
  if (!UUID.test(context.receiptId) || !UUID.test(context.operationId) || !UUID.test(context.authorizationId)) {
    fail("JOURNAL_SCHEMA_INVALID", "Journal identity values must be lower-case canonical UUIDs.");
  }
}

function journalEventBody(event: Omit<SyntheticJournalEvent, "checksum">): StrictJsonRecord {
  return {
    eventType: event.eventType,
    evidence: event.evidence,
    occurredAt: event.occurredAt,
    previousChecksum: event.previousChecksum,
    sequence: event.sequence,
  };
}

function authenticatedJournalBody(journal: Omit<SyntheticJournal, "checksum">): StrictJsonRecord {
  return {
    authorizationId: journal.authorizationId,
    events: journal.events.map(event => ({ checksum: event.checksum, ...journalEventBody(event) })),
    kind: journal.kind,
    operationId: journal.operationId,
    receiptId: journal.receiptId,
    version: journal.version,
  };
}

function parseAuthenticatedJournalEvent(value: StrictJsonValue, expectedSequence: number, expectedPreviousChecksum: string | null): SyntheticJournalEvent {
  const record = journalRecord(value, "journal event");
  assertJournalExactKeys(record, ["checksum", "eventType", "evidence", "occurredAt", "previousChecksum", "sequence"], "journal event");
  const sequence = journalSafeIntegerField(record, "sequence", "journal event");
  if (sequence !== expectedSequence) fail("JOURNAL_SEQUENCE_INVALID", "Journal event sequence is discontinuous.");
  const previousChecksum = record.previousChecksum;
  if (previousChecksum !== expectedPreviousChecksum || (previousChecksum !== null && (typeof previousChecksum !== "string" || !SHA_256.test(previousChecksum)))) {
    fail("JOURNAL_CHAIN_BROKEN", "Journal previous checksum does not match the preceding event.");
  }
  const eventType = journalStringField(record, "eventType", "journal event");
  const occurredAt = journalStringField(record, "occurredAt", "journal event");
  assertJournalInstant(occurredAt);
  const evidence = journalRecord(record.evidence, "journal event.evidence");
  const checksum = journalStringField(record, "checksum", "journal event");
  if (!SHA_256.test(checksum)) fail("JOURNAL_SCHEMA_INVALID", "Journal event checksum must be lower-case SHA-256 hex.");
  const event: SyntheticJournalEvent = { sequence, eventType, occurredAt, evidence, previousChecksum, checksum };
  if (!equalDigest(canonicalSha256(journalEventBody(event)), checksum)) fail("JOURNAL_EVENT_CHECKSUM_INVALID", "Journal event checksum does not match its canonical body.");
  return event;
}

function validateAuthenticatedJournalStructure(value: StrictJsonValue, expectedContext: SyntheticJournalContext): SyntheticJournal {
  const record = journalRecord(value, "synthetic journal");
  assertJournalExactKeys(record, ["authorizationId", "checksum", "events", "kind", "operationId", "receiptId", "version"], "synthetic journal");
  if (record.kind !== SYNTHETIC_JOURNAL_KIND || record.version !== SYNTHETIC_JOURNAL_VERSION) fail("JOURNAL_SCHEMA_INVALID", "Journal identity is invalid.");
  const context: SyntheticJournalContext = {
    receiptId: journalStringField(record, "receiptId", "synthetic journal"),
    operationId: journalStringField(record, "operationId", "synthetic journal"),
    authorizationId: journalStringField(record, "authorizationId", "synthetic journal"),
  };
  assertJournalContext(context);
  if (expectedContext.receiptId !== context.receiptId || expectedContext.operationId !== context.operationId || expectedContext.authorizationId !== context.authorizationId) {
    fail("JOURNAL_CONTEXT_MISMATCH", "Journal does not belong to the authenticated receipt operation.");
  }
  if (!Array.isArray(record.events)) fail("JOURNAL_SCHEMA_INVALID", "Journal events must be an array.");
  const events: SyntheticJournalEvent[] = [];
  let previousChecksum: string | null = null;
  for (const [index, event] of record.events.entries()) {
    const parsed = parseAuthenticatedJournalEvent(event, index + 1, previousChecksum);
    events.push(parsed);
    previousChecksum = parsed.checksum;
  }
  const checksum = journalStringField(record, "checksum", "synthetic journal");
  if (!SHA_256.test(checksum)) fail("JOURNAL_SCHEMA_INVALID", "Journal checksum must be lower-case SHA-256 hex.");
  const withoutChecksum: Omit<SyntheticJournal, "checksum"> = { ...context, kind: SYNTHETIC_JOURNAL_KIND, version: SYNTHETIC_JOURNAL_VERSION, events };
  if (!equalDigest(canonicalSha256(authenticatedJournalBody(withoutChecksum)), checksum)) fail("JOURNAL_CHECKSUM_INVALID", "Journal checksum does not match its canonical body.");
  return { ...withoutChecksum, checksum };
}

/** The only public receipt-to-journal verifier receives receipt envelope bytes,
 * not caller-owned payload objects. It verifies the signed receipt and then
 * derives the immutable payload used for journal binding internally. */
export function verifyHistoricalReceiptJournalBytes(input: Uint8Array, journalBytes: Uint8Array, policy: TrustPolicy, options: HistoricalReceiptVerificationOptions): VerifiedReceiptJournal {
  const receipt = verifyHistoricalReceiptEnvelopeBytes(input, policy, options);
  const payload = receipt.payload as StrictJsonRecord;
  const journal = parseStrictJsonBytes(journalBytes);
  const reference = asRecord(payload.journal, "receipt payload.journal");
  const validatedJournal = validateAuthenticatedJournalStructure(journal, {
    receiptId: stringField(reference, "receiptId", "receipt payload.journal"),
    operationId: stringField(reference, "operationId", "receipt payload.journal"),
    authorizationId: stringField(reference, "authorizationId", "receipt payload.journal"),
  });
  if (!equalDigest(canonicalSha256(validatedJournal as unknown as StrictJsonValue), sha256Field(reference, "sha256", "receipt payload.journal"))) {
    fail("TRUST_JOURNAL_DIGEST_MISMATCH", "Receipt journal digest does not match the authenticated receipt payload.");
  }
  const evidencePayload = validateTimeEvidenceEnvelope(parseStrictJsonBytes(options.timeEvidenceBytes!)).payload;
  return deepFreeze({ receipt, journal: structuredClone(validatedJournal), timeEvidenceId: stringField(evidencePayload, "evidenceId", "time evidence payload") });
}
