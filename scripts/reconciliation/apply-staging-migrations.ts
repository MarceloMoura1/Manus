import { MAIN_MIGRATIONS_DIR, applyCanonicalMigrations } from "../../server/_core/canonical-migrations";
import { assertStagingDatabaseUrl } from "./reconciler.mjs";

const target = process.env.RECON_TARGET_URL;
if (!target) throw new Error("RECON_TARGET_URL is required.");
const { database: name } = assertStagingDatabaseUrl(target);

await applyCanonicalMigrations(target, MAIN_MIGRATIONS_DIR);
process.stdout.write(`STAGING_MIGRATION_APPLIED=${name}\n`);
