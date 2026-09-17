import { createServerFn } from "@tanstack/react-start";
import { upsertSecrets } from "./config.mjs";
import { cliGatewayMiddleware } from "./cli-gateway-middleware";
import { BRAIN_KEY_ENV } from "./secret-scope";

/**
 * Persist brain keys into ~/.paddy/.env.
 * Requires presented Bearer when off-loopback (see cliGatewayMiddleware).
 * FE contract: send Authorization: Bearer <PADDY_CLI_TOKEN> on this call when
 * PADDY_BIND is not loopback; loopback single-operator may omit it.
 */
export const persistBrainKeys = createServerFn({ method: "POST" })
  .middleware([cliGatewayMiddleware])
  .validator((input: { keys: Record<string, string> }) => input)
  .handler(async ({ data }) => {
    const patch: Record<string, string> = {};
    for (const [field, value] of Object.entries(data.keys ?? {})) {
      const envName = BRAIN_KEY_ENV[field];
      if (!envName) continue;
      patch[envName] = (value ?? "").trim();
    }
    if (!Object.keys(patch).length) return { ok: true as const, wrote: 0 };
    // Hosted preview is shared and auth-off: visitor keys stay in the browser.
    // Self-host (`paddy gateway`) sets PADDY_CLI_TOKEN and owns ~/.paddy/.env.
    if (!(process.env.PADDY_CLI_TOKEN ?? "").trim()) {
      return { ok: true as const, wrote: 0 };
    }
    upsertSecrets(patch);
    return { ok: true as const, wrote: Object.keys(patch).length };
  });
