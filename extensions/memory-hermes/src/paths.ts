import os from "node:os";
import path from "node:path";

/** Same override OpenClaw already reads. Default home is ~/.paddy. */
function resolveHermesStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OPENCLAW_STATE_DIR?.trim();
  if (override) {
    return override.startsWith("~") ? path.join(os.homedir(), override.slice(1)) : override;
  }
  return path.join(os.homedir(), ".paddy");
}

export function hermesDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveHermesStateDir(env), "hermes", "memory.sqlite");
}
