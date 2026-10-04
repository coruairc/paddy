// Paddy's security-review policy has no `rollout` block, so the guards always enforce. The scripts
// still support upstream's rollout modes (inactive, grandfathered); tests for those run the
// scripts from a temporary trusted checkout whose policy names a rollout pull request, instead of
// relying on the repository policy or adding a production-only-for-tests override.
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

/** Rollout pull request number used by the rollout fixtures (upstream openclaw/openclaw#152415). */
export const TEST_ROLLOUT_PULL_REQUEST = 152415;

/** The repository policy plus a `rollout` block naming {@link TEST_ROLLOUT_PULL_REQUEST}. */
export function rolloutPolicyText(): string {
  const policy = readFileSync(".github/security-review-policy.yml", "utf8");
  return `${policy.trimEnd()}\n\nrollout:\n  pull-request: ${TEST_ROLLOUT_PULL_REQUEST}\n`;
}

/**
 * Copies `scripts/github` (and the shared bounded-response helper) into `root` with the rollout
 * policy, and returns the real path of the script to run from that checkout.
 */
export function createRolloutPolicyCheckout(root: string, script: string): string {
  cpSync("scripts/github", path.join(root, "scripts/github"), { recursive: true });
  const boundedResponse = "scripts/lib/bounded-response.mjs";
  mkdirSync(path.dirname(path.join(root, boundedResponse)), { recursive: true });
  copyFileSync(boundedResponse, path.join(root, boundedResponse));
  mkdirSync(path.join(root, ".github"), { recursive: true });
  writeFileSync(path.join(root, ".github/security-review-policy.yml"), rolloutPolicyText());
  symlinkSync(path.resolve("node_modules"), path.join(root, "node_modules"), "junction");
  return realpathSync(path.join(root, `scripts/github/${script}.mjs`));
}
