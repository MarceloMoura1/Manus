import { claimAuthorization, type AuthorizationClaimInput } from "./claims";
import { RuntimeTrustError } from "./strict-json";

const [root, serializedInput] = process.argv.slice(2);

if (!root || !serializedInput) {
  process.stderr.write("claim worker requires a root and serialized synthetic input\n");
  process.exitCode = 64;
} else {
  void claimAuthorization(root, JSON.parse(serializedInput) as AuthorizationClaimInput)
    .then(() => {
      process.stdout.write("CLAIM_CREATED\n");
    })
    .catch((error: unknown) => {
      const code = error instanceof RuntimeTrustError ? error.code : "CLAIM_WORKER_FAILURE";
      process.stderr.write(`${code}\n`);
      process.exitCode = 1;
    });
}
