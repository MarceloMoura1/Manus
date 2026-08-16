import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve(process.cwd(), ".env.local");
if (existsSync(target)) {
  console.error(".env.local already exists; refusing to overwrite it.");
  process.exit(1);
}
const secret = () => randomBytes(48).toString("base64url");
const rootPassword = secret();
const userPassword = secret();
const databaseUrl = `mysql://megadesk_local:${encodeURIComponent(userPassword)}@127.0.0.1:3308/megadesk_local`;
const lines = [
  "NODE_ENV=development", "PORT=3000", "LOCAL_MYSQL_PORT=3308",
  "LOCAL_MYSQL_DATABASE=megadesk_local", "LOCAL_MYSQL_USER=megadesk_local",
  `LOCAL_MYSQL_ROOT_PASSWORD=${rootPassword}`, `LOCAL_MYSQL_PASSWORD=${userPassword}`,
  `DATABASE_URL=${databaseUrl}`, `MAIN_DATABASE_URL=${databaseUrl}`, `JWT_SECRET=${secret()}`,
  "EVOLUTION_API_URL=http://127.0.0.1:8080", "EVOLUTION_API_KEY=",
  "WEBHOOK_BASE_URL=http://host.docker.internal:3000", "",
];
writeFileSync(target, lines.join("\n"), { encoding: "utf8", mode: 0o600, flag: "wx" });
console.log("Created ignored .env.local with fresh local-only secrets.");
