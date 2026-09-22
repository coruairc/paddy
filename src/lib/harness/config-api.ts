import { createServerFn } from "@tanstack/react-start";
import {
  SCHEMA_VERSION,
  canonicalConfigSchema,
  configGet as configGetPath,
  configPath,
  configSet as configSetPath,
  configUnset as configUnsetPath,
  loadCanonical,
  redactConfig,
  resolvedSnapshot,
  upsertSecrets,
  validateCanonical,
} from "./config.mjs";
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

function pathError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code || "") : "";
  return { ok: false as const, error: message, code: code || undefined };
}

/** Full redacted config for Control UI / FE. Behind cliGatewayMiddleware. */
export const getConfig = createServerFn({ method: "GET" })
  .middleware([cliGatewayMiddleware])
  .handler(async () => {
    const { config } = loadCanonical({ persist: true });
    return {
      ok: true as const,
      config: redactConfig(config),
      path: configPath(),
      schemaVersion: SCHEMA_VERSION,
    };
  });

/**
 * Stable JSON Schema subset for path-keyed FE forms.
 * Includes gateway.auth (maps to cli.token), brain, channels, agents.defaults.memory, skills.
 */
export const getConfigSchema = createServerFn({ method: "GET" })
  .middleware([cliGatewayMiddleware])
  .handler(async () => {
    const schema = canonicalConfigSchema();
    return {
      ok: true as const,
      schema,
      schemaVersion: SCHEMA_VERSION,
      mapping: {
        "gateway.auth.token": "cli.token",
        "agents.defaults.memory": "optional nested keys on v1 config.json (not yet runtime SoT)",
        skills: "optional nested keys on v1 config.json (not yet runtime SoT)",
      },
    };
  });

export const configGet = createServerFn({ method: "POST" })
  .middleware([cliGatewayMiddleware])
  .validator((input: { path: string }) => input)
  .handler(async ({ data }) => {
    try {
      const result = configGetPath(data.path);
      return { ...result, ok: true as const };
    } catch (err) {
      return pathError(err);
    }
  });

export const configSet = createServerFn({ method: "POST" })
  .middleware([cliGatewayMiddleware])
  .validator((input: { path: string; value: unknown; merge?: boolean }) => input)
  .handler(async ({ data }) => {
    try {
      const result = configSetPath(data.path, data.value, { merge: Boolean(data.merge) });
      return { ...result, ok: true as const };
    } catch (err) {
      return pathError(err);
    }
  });

export const configUnset = createServerFn({ method: "POST" })
  .middleware([cliGatewayMiddleware])
  .validator((input: { path: string }) => input)
  .handler(async ({ data }) => {
    try {
      const result = configUnsetPath(data.path);
      return { ...result, ok: true as const };
    } catch (err) {
      return pathError(err);
    }
  });

export const configValidate = createServerFn({ method: "POST" })
  .middleware([cliGatewayMiddleware])
  .validator((input?: { patch?: Record<string, unknown> }) => input ?? {})
  .handler(async ({ data }) => {
    const snap = resolvedSnapshot();
    let candidate = snap.config;
    if (data?.patch && typeof data.patch === "object" && !Array.isArray(data.patch)) {
      candidate = { ...snap.config, ...data.patch };
    }
    const valid = validateCanonical(candidate);
    const missing = (snap.missing || []).map((m: { path: string; name: string }) => ({
      path: m.path,
      name: m.name,
      message: `missing env ${m.name} for ${m.path}`,
    }));
    const issues = [
      ...(valid.issues || []).map((i: { path: string; message: string }) => ({
        path: i.path,
        message: i.message,
        severity: "error" as const,
      })),
      ...missing.map((m: { path: string; message: string }) => ({
        path: m.path,
        message: m.message,
        severity: "warning" as const,
      })),
    ];
    return {
      ok: valid.ok,
      issues,
      errors: valid.errors,
      missing: snap.missing || [],
      schemaVersion: SCHEMA_VERSION,
    };
  });
