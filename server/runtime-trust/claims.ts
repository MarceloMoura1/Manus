import { link, lstat, open, readFile, realpath, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import {
  canonicalSha256,
  canonicalUtf8,
  isStrictJsonRecord,
  parseStrictJsonBytes,
  RuntimeTrustError,
  type StrictJsonRecord,
  type StrictJsonValue,
} from "./strict-json";

export const AUTHORIZATION_CLAIM_KIND = "megadesk-runtime-trust-authorization-claim";
export const AUTHORIZATION_CLAIM_VERSION = 2;

export interface AuthorizationClaimInput {
  authorizationId: string;
  operationId: string;
  nonce: string;
  payloadSha256: string;
  claimedAt: string;
}

export interface AuthorizationClaim extends AuthorizationClaimInput {
  kind: typeof AUTHORIZATION_CLAIM_KIND;
  version: typeof AUTHORIZATION_CLAIM_VERSION;
  checksum: string;
}

export type ClaimState = "absent" | "in-progress" | "consumed" | "corrupt" | "durability-unconfirmed";
export type DirectoryDurability = "confirmed" | "unavailable" | "unconfirmed";

export interface ClaimFilesystemReport {
  platform: NodeJS.Platform;
  rootMode: number | null;
  rootModePrivate: boolean | "not-applicable" | "not-verifiable";
  rootOwnerUid: number | null;
  rootOwnership: "not-verifiable";
  rootAcl: "not-verifiable";
  directoryFsync: DirectoryDurability;
}

export interface AuthorizationClaimResult {
  state: "consumed";
  claim: AuthorizationClaim;
  filesystem: ClaimFilesystemReport;
}

export type SyntheticClaimFailurePoint =
  | "after-lease-create"
  | "after-lease-write"
  | "after-lease-sync"
  | "after-stage-create"
  | "after-stage-write"
  | "after-stage-sync"
  | "after-publish"
  | "after-directory-sync";

/** This is accepted only by the explicitly named synthetic harness below. It
 * can introduce a failure but can never turn unconfirmed durability into an
 * authorization result. */
export interface SyntheticClaimFailureOptions {
  failureAt?: SyntheticClaimFailurePoint;
}

const SHA_256 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function fail(code: string, message: string): never {
  throw new RuntimeTrustError(code, message);
}

function assertExactKeys(record: StrictJsonRecord, expected: readonly string[]): void {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    fail("CLAIM_SCHEMA_CLOSED", "Authorization claim contains absent or unknown fields.");
  }
}

function stringField(record: StrictJsonRecord, name: string): string {
  const value = record[name];
  if (typeof value !== "string" || value.length === 0) fail("CLAIM_SCHEMA_INVALID", `${name} must be a non-empty string.`);
  return value;
}

function canonicalInstant(value: string): void {
  const instant = Date.parse(value);
  if (!Number.isFinite(instant) || new Date(instant).toISOString() !== value) fail("CLAIM_SCHEMA_INVALID", "claimedAt must be a canonical UTC ISO-8601 instant.");
}

function canonicalUuid(value: string, label: string): string {
  if (!UUID.test(value)) fail("CLAIM_SCHEMA_INVALID", `${label} must be a lower-case canonical UUID.`);
  return value;
}

export function validateAuthorizationClaimInput(input: AuthorizationClaimInput): void {
  canonicalUuid(input.authorizationId, "authorizationId");
  canonicalUuid(input.operationId, "operationId");
  if (!/^[a-f0-9]{64}$/.test(input.nonce) || !SHA_256.test(input.payloadSha256)) fail("CLAIM_SCHEMA_INVALID", "Nonce and payload digest must be lower-case SHA-256 hex digests.");
  canonicalInstant(input.claimedAt);
}

function buildClaimBody(input: AuthorizationClaimInput): StrictJsonRecord {
  validateAuthorizationClaimInput(input);
  return {
    authorizationId: input.authorizationId,
    claimedAt: input.claimedAt,
    kind: AUTHORIZATION_CLAIM_KIND,
    nonce: input.nonce,
    operationId: input.operationId,
    payloadSha256: input.payloadSha256,
    version: AUTHORIZATION_CLAIM_VERSION,
  };
}

function claimValue(claim: AuthorizationClaim): StrictJsonRecord {
  return {
    authorizationId: claim.authorizationId,
    checksum: claim.checksum,
    claimedAt: claim.claimedAt,
    kind: claim.kind,
    nonce: claim.nonce,
    operationId: claim.operationId,
    payloadSha256: claim.payloadSha256,
    version: claim.version,
  };
}

export function createAuthorizationClaim(input: AuthorizationClaimInput): AuthorizationClaim {
  const body = buildClaimBody(input);
  return { ...body, checksum: canonicalSha256(body) } as AuthorizationClaim;
}

function validateAuthorizationClaim(value: StrictJsonValue): AuthorizationClaim {
  if (!isStrictJsonRecord(value)) fail("CLAIM_SCHEMA_INVALID", "Authorization claim must be a JSON object.");
  assertExactKeys(value, ["authorizationId", "checksum", "claimedAt", "kind", "nonce", "operationId", "payloadSha256", "version"]);
  if (value.kind !== AUTHORIZATION_CLAIM_KIND || value.version !== AUTHORIZATION_CLAIM_VERSION) fail("CLAIM_SCHEMA_INVALID", "Authorization claim identity is invalid.");
  const input: AuthorizationClaimInput = {
    authorizationId: stringField(value, "authorizationId"),
    operationId: stringField(value, "operationId"),
    nonce: stringField(value, "nonce"),
    payloadSha256: stringField(value, "payloadSha256"),
    claimedAt: stringField(value, "claimedAt"),
  };
  validateAuthorizationClaimInput(input);
  const checksum = stringField(value, "checksum");
  if (!SHA_256.test(checksum) || checksum !== canonicalSha256(buildClaimBody(input))) fail("CLAIM_CHECKSUM_INVALID", "Authorization claim checksum does not match its canonical body.");
  return { ...input, kind: AUTHORIZATION_CLAIM_KIND, version: AUTHORIZATION_CLAIM_VERSION, checksum };
}

interface ClaimPaths {
  lease: string;
  staged: string;
  published: string;
}

function claimPaths(root: string, authorizationId: string): ClaimPaths {
  const base = join(root, authorizationId);
  if (!base.startsWith(`${root}${sep}`)) fail("CLAIM_PATH_INVALID", "Claim path escaped its root.");
  return { lease: `${base}.lease`, staged: `${base}.stage.json`, published: `${base}.claim.json` };
}

function platformFilesystemReport(rootStat: Awaited<ReturnType<typeof stat>>): ClaimFilesystemReport {
  const mode = process.platform === "win32" || typeof rootStat.mode !== "number" ? null : rootStat.mode & 0o777;
  const ownerUid = process.platform === "win32" || typeof rootStat.uid !== "number" ? null : rootStat.uid;
  return {
    platform: process.platform,
    rootMode: mode,
    rootModePrivate: process.platform === "win32" ? "not-applicable" : mode === null ? "not-verifiable" : (mode & 0o077) === 0,
    rootOwnerUid: ownerUid,
    rootOwnership: "not-verifiable",
    rootAcl: "not-verifiable",
    directoryFsync: process.platform === "win32" ? "unavailable" : "unconfirmed",
  };
}

interface PreparedClaimDirectory {
  root: string;
  device: number;
  inode: number;
  filesystem: ClaimFilesystemReport;
}

async function assertNoSymbolicLinkComponents(absolute: string): Promise<void> {
  let current = absolute;
  while (true) {
    const entry = await lstat(current);
    if (entry.isSymbolicLink()) fail("CLAIM_ROOT_UNSAFE", "Claim root and every parent component must be non-symlink directories.");
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

async function prepareClaimDirectory(root: string): Promise<PreparedClaimDirectory> {
  if (process.platform === "win32") {
    fail("CLAIM_PLATFORM_UNSUPPORTED", "Claims fail closed on Windows because this primitive cannot verify reparse-point, ACL, and directory-durability requirements there.");
  }
  const absolute = resolve(root);
  await assertNoSymbolicLinkComponents(absolute);
  let entry;
  try {
    entry = await lstat(absolute);
  } catch {
    fail("CLAIM_ROOT_INVALID", "Claim root does not exist or cannot be inspected.");
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) fail("CLAIM_ROOT_UNSAFE", "Claim root must be a non-symlink directory.");
  const rootStat = await stat(absolute);
  const filesystem = platformFilesystemReport(rootStat);
  if (filesystem.rootModePrivate === false) fail("CLAIM_ROOT_UNSAFE", "Claim root permissions allow group or other access.");
  if (filesystem.rootOwnerUid === null || typeof process.getuid !== "function" || filesystem.rootOwnerUid !== process.getuid()) {
    fail("CLAIM_ROOT_UNSAFE", "Claim root must be pre-provisioned and owned by the executing authorized identity.");
  }
  const canonicalRoot = await realpath(absolute);
  if (canonicalRoot !== absolute) fail("CLAIM_ROOT_UNSAFE", "Claim root may not resolve through a symbolic-link or reparse-point path.");
  const stable = await lstat(canonicalRoot);
  if (!stable.isDirectory() || stable.isSymbolicLink() || stable.dev !== entry.dev || stable.ino !== entry.ino) {
    fail("CLAIM_ROOT_RACE", "Claim root changed while its safety properties were being established.");
  }
  return { root: canonicalRoot, device: stable.dev, inode: stable.ino, filesystem };
}

async function assertPreparedClaimDirectoryStable(prepared: PreparedClaimDirectory): Promise<void> {
  const current = await lstat(prepared.root);
  if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== prepared.device || current.ino !== prepared.inode) {
    fail("CLAIM_ROOT_RACE", "Claim root changed after preflight; no authorization can be issued.");
  }
}

interface StableRegularFile {
  bytes: Buffer;
  stat: Awaited<ReturnType<typeof lstat>>;
}

async function readStableRegularFile(path: string, permittedLinks: readonly number[]): Promise<StableRegularFile> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink()) fail("CLAIM_FILESYSTEM_UNSAFE", "Claim file must be a regular non-symlink file.");
  if (!permittedLinks.includes(before.nlink)) fail("CLAIM_FILESYSTEM_UNSAFE", "Claim file has an unsafe hard-link count.");
  const bytes = await readFile(path);
  const after = await lstat(path);
  if (!after.isFile() || after.isSymbolicLink() || after.dev !== before.dev || after.ino !== before.ino || after.nlink !== before.nlink) {
    fail("CLAIM_FILESYSTEM_RACE", "Claim file changed while it was being inspected.");
  }
  return { bytes, stat: after };
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readPublishedClaim(path: string, permittedLinks: readonly number[] = [1]): Promise<{ claim: AuthorizationClaim; stat: Awaited<ReturnType<typeof lstat>> }> {
  const file = await readStableRegularFile(path, permittedLinks);
  return { claim: validateAuthorizationClaim(parseStrictJsonBytes(file.bytes)), stat: file.stat };
}

async function syncDirectory(directory: string): Promise<DirectoryDurability> {
  if (process.platform === "win32") return "unavailable";
  try {
    const handle = await open(directory, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    return "confirmed";
  } catch {
    return "unconfirmed";
  }
}

async function syncClaimFile(handle: Awaited<ReturnType<typeof open>>, label: string): Promise<void> {
  try {
    await handle.sync();
  } catch {
    fail("CLAIM_DURABILITY_UNCONFIRMED", `${label} could not be synchronized; the authorization remains unavailable for reuse.`);
  }
}

async function writeClaimFile(handle: Awaited<ReturnType<typeof open>>, bytes: Uint8Array, label: string): Promise<void> {
  try {
    await handle.writeFile(bytes);
  } catch {
    fail("CLAIM_PERSISTENCE_FAILED", `${label} could not be written completely; the authorization remains unavailable for reuse.`);
  }
}

function syntheticCheckpoint(options: SyntheticClaimFailureOptions | undefined, point: SyntheticClaimFailurePoint): void {
  if (options?.failureAt === point) fail("SYNTHETIC_CLAIM_FAILURE", `Synthetic failure at ${point}.`);
}

async function classifyClaim(paths: ClaimPaths, filesystem: ClaimFilesystemReport): Promise<{ state: ClaimState; claim?: AuthorizationClaim }> {
  const [hasLease, hasStage, hasPublished] = await Promise.all([exists(paths.lease), exists(paths.staged), exists(paths.published)]);
  if (hasPublished && hasStage) {
    if (!hasLease) return { state: "corrupt" };
    try {
      const published = await readPublishedClaim(paths.published, [2]);
      const staged = await readPublishedClaim(paths.staged, [2]);
      if (published.stat.dev !== staged.stat.dev || published.stat.ino !== staged.stat.ino || published.claim.checksum !== staged.claim.checksum) {
        return { state: "corrupt" };
      }
      return { state: "in-progress" };
    } catch {
      // The publisher may have removed the staging hard link between the
      // snapshot and the read. Reclassify the stable published name once;
      // this is bounded and never releases the authorization.
      if (!(await exists(paths.staged))) {
        try {
          const published = await readPublishedClaim(paths.published);
          return filesystem.directoryFsync === "confirmed"
            ? { state: "consumed", claim: published.claim }
            : { state: "durability-unconfirmed", claim: published.claim };
        } catch {
          return { state: "corrupt" };
        }
      }
      return { state: "corrupt" };
    }
  }
  if (hasPublished) {
    try {
      const published = await readPublishedClaim(paths.published);
      if (filesystem.directoryFsync !== "confirmed") return { state: "durability-unconfirmed", claim: published.claim };
      return { state: "consumed", claim: published.claim };
    } catch {
      return { state: "corrupt" };
    }
  }
  if (hasStage) {
    if (!hasLease) return { state: "corrupt" };
    // A stage name can legitimately be observed after exclusive creation but
    // before its complete contents are visible. The permanent lease blocks
    // reuse, so report in-progress rather than accepting or releasing it.
    return { state: "in-progress" };
  }
  if (hasLease) return { state: "in-progress" };
  return { state: "absent" };
}

async function resolveExistingClaim(paths: ClaimPaths, filesystem: ClaimFilesystemReport): Promise<never> {
  const existing = await classifyClaim(paths, filesystem);
  if (existing.state === "consumed") fail("CLAIM_ALREADY_CONSUMED", "Authorization was already consumed by a validated, durably published claim.");
  if (existing.state === "in-progress") fail("CLAIM_IN_PROGRESS", "Authorization is reserved by an unfinished claim; no automatic release is permitted.");
  if (existing.state === "durability-unconfirmed") fail("CLAIM_DURABILITY_UNCONFIRMED", "A validated claim exists, but its prior directory durability cannot be independently confirmed.");
  if (existing.state === "corrupt") fail("CLAIM_CORRUPT", "Existing claim state is partial or corrupt and requires authorized forensic recovery.");
  fail("CLAIM_RACE_DETECTED", "Claim lease disappeared during acquisition; retry requires explicit caller policy.");
}

/**
 * Atomicity uses an exclusive lease and publication by hard link. The lease is
 * permanent: an interrupted attempt remains in-progress rather than becoming
 * reusable. This public function has no testing or durability bypass.
 */
async function claimAuthorizationInternal(root: string, input: AuthorizationClaimInput, synthetic?: SyntheticClaimFailureOptions): Promise<AuthorizationClaimResult> {
  const claim = createAuthorizationClaim(input);
  const prepared = await prepareClaimDirectory(root);
  await assertPreparedClaimDirectoryStable(prepared);
  const paths = claimPaths(prepared.root, claim.authorizationId);
  let lease;
  try {
    lease = await open(paths.lease, "wx", 0o600);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return resolveExistingClaim(paths, prepared.filesystem);
    throw error;
  }
  try {
    syntheticCheckpoint(synthetic, "after-lease-create");
    await writeClaimFile(lease, canonicalUtf8({ authorizationId: claim.authorizationId, kind: "megadesk-runtime-trust-lease", version: 1 }), "Claim lease");
    syntheticCheckpoint(synthetic, "after-lease-write");
    await syncClaimFile(lease, "Claim lease");
    syntheticCheckpoint(synthetic, "after-lease-sync");
  } finally {
    await lease.close();
  }

  let staged;
  try {
    staged = await open(paths.staged, "wx", 0o600);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") fail("CLAIM_IN_PROGRESS", "Existing staged claim is reserved by an unfinished operation.");
    throw error;
  }
  try {
    syntheticCheckpoint(synthetic, "after-stage-create");
    await writeClaimFile(staged, canonicalUtf8(claimValue(claim)), "Staged claim");
    syntheticCheckpoint(synthetic, "after-stage-write");
    await syncClaimFile(staged, "Staged claim");
    syntheticCheckpoint(synthetic, "after-stage-sync");
  } finally {
    await staged.close();
  }

  try {
    await link(paths.staged, paths.published);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return resolveExistingClaim(paths, prepared.filesystem);
    fail("CLAIM_FILESYSTEM_UNSUPPORTED", "Filesystem does not support safe no-replace hard-link publication.");
  }
  syntheticCheckpoint(synthetic, "after-publish");
  await unlink(paths.staged);
  await readPublishedClaim(paths.published);
  const directoryFsync = await syncDirectory(dirname(paths.published));
  syntheticCheckpoint(synthetic, "after-directory-sync");
  await assertPreparedClaimDirectoryStable(prepared);
  if (directoryFsync !== "confirmed") {
    fail("CLAIM_DURABILITY_UNCONFIRMED", "Claim publication is visible but directory durability is not confirmed; it cannot authorize a promotion.");
  }
  return {
    state: "consumed",
    claim: (await readPublishedClaim(paths.published)).claim,
    filesystem: { ...prepared.filesystem, directoryFsync },
  };
}

export async function claimAuthorization(root: string, input: AuthorizationClaimInput): Promise<AuthorizationClaimResult> {
  return claimAuthorizationInternal(root, input);
}

/** Synthetic harness only: it injects deterministic failures but has no route
 * to bypass directory durability or authorize an uncertain claim. */
export async function claimAuthorizationForSyntheticFailureTest(root: string, input: AuthorizationClaimInput, options: SyntheticClaimFailureOptions): Promise<AuthorizationClaimResult> {
  return claimAuthorizationInternal(root, input, options);
}

export async function inspectAuthorizationClaim(root: string, authorizationId: string): Promise<{ state: ClaimState; filesystem: ClaimFilesystemReport; claim?: AuthorizationClaim }> {
  canonicalUuid(authorizationId, "authorizationId");
  const prepared = await prepareClaimDirectory(root);
  await assertPreparedClaimDirectoryStable(prepared);
  const paths = claimPaths(prepared.root, authorizationId);
  const classified = await classifyClaim(paths, prepared.filesystem);
  return { ...classified, filesystem: prepared.filesystem };
}

export async function recoverAuthorizationClaim(): Promise<never> {
  fail("RECOVERY_AUTHORIZATION_REQUIRED", "A consumed authorization cannot be recovered without an independently authorized recovery protocol.");
}
