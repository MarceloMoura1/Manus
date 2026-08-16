import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const target = resolve(process.cwd(), ".env.local");
const temporary = `${target}.tmp`;
const source = readFileSync(target, "utf8");
const values = new Map();
for (const line of source.split(/\r?\n/)) {
  if (!line || line.trimStart().startsWith("#")) continue;
  const separator = line.indexOf("=");
  if (separator > 0) values.set(line.slice(0, separator), line.slice(separator + 1));
}
const secret = () => randomBytes(48).toString("base64url");
const required = {
  EVOLUTION_API_KEY: secret(),
  EVOLUTION_WEBHOOK_SECRET: secret(),
  EVOLUTION_MYSQL_ROOT_PASSWORD: secret(),
  EVOLUTION_MYSQL_DATABASE: "evolution_api",
  EVOLUTION_MYSQL_USER: "evolution",
  EVOLUTION_MYSQL_PASSWORD: secret(),
};
for (const [name, fallback] of Object.entries(required)) {
  if (!values.get(name)) values.set(name, fallback);
}
const managed = new Set(values.keys());
const output = source.split(/\r?\n/).filter((line) => {
  const separator = line.indexOf("=");
  if (separator <= 0) return line !== "";
  return !managed.has(line.slice(0, separator));
});
for (const [name, value] of values) output.push(`${name}=${value}`);
output.push("");
writeFileSync(temporary, output.join("\n"), { encoding: "utf8", mode: 0o600, flag: "wx" });
renameSync(temporary, target);
console.log("Configured fresh local Evolution secrets without displaying them.");
