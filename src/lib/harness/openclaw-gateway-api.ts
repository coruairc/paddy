/**
 * OpenClaw gateway FE serverFns (Phase B).
 * Config SoT: openclaw.runtime|url|token|model (Backend Phase B @ 851b99b).
 * HTTP client lives in openclaw-gateway.ts (Backend) — this module is UI Probe/persist only.
 * Probe prefers Backend probeOpenClawGateway (/v1/models); falls back to /health|/healthz.
 * Do NOT enable hosted auth / PADDY_CLI_TOKEN in hosted startup.
 */

import { createServerFn } from "@tanstack/react-start";
import { cliGatewayMiddleware } from "./cli-gateway-middleware";
import { configGet, configSet, getConfig } from "./config-api";
import { probeOpenClawGateway as probeOpenClawModels } from "./openclaw-gateway";
import {
  hostedOpenClawDemoNote,
  isHostedPaddyDemoEnv,
  isLoopbackOpenClawUrl,
  normalizeOpenClawUrl,
  OPENCLAW_TARGET_PATHS,
  OPENCLAW_TARGET_ROOT,
  parseOpenClawTargetFromConfig,
  probeOpenClawHealth,
  resolveEffectiveRuntime,
  type AgentRuntime,
  type OpenClawProbeResult,
  type OpenClawUiTarget,
} from "./openclaw-gateway-helpers";

export * from "./openclaw-gateway-helpers";

export type OpenClawTargetState = {
  ok: true;
  hostedDemo: boolean;
  target: OpenClawUiTarget;
  effectiveRuntime: AgentRuntime;
  loopbackDisabled: boolean;
  tokenConfigured: boolean;
  note?: string;
};

export const getOpenClawTargetState = createServerFn({ method: "GET" })
  .middleware([cliGatewayMiddleware])
  .handler(async (): Promise<OpenClawTargetState> => {
    const hostedDemo = isHostedPaddyDemoEnv();
    let config: Record<string, unknown> | null = null;
    let tokenConfigured = false;
    try {
      const snap = await getConfig();
      if (snap.ok && snap.config && typeof snap.config === "object") {
        config = snap.config as Record<string, unknown>;
      }
    } catch {
      /* preview without config is fine */
    }
    try {
      const tok = await configGet({ data: { path: OPENCLAW_TARGET_PATHS.token } });
      if (tok.ok && tok.value != null && String(tok.value).length > 0) tokenConfigured = true;
    } catch {
      tokenConfigured = false;
    }
    const parsed = parseOpenClawTargetFromConfig(config);
    const effectiveRuntime = resolveEffectiveRuntime({
      configured: parsed.runtime,
      hostedDemo,
    });
    return {
      ok: true,
      hostedDemo,
      target: {
        runtime: effectiveRuntime,
        url: parsed.url,
        model: parsed.model,
      },
      effectiveRuntime,
      loopbackDisabled: hostedDemo,
      tokenConfigured,
      note: hostedDemo ? hostedOpenClawDemoNote() : undefined,
    };
  });

export const probeOpenClawGateway = createServerFn({ method: "POST" })
  .middleware([cliGatewayMiddleware])
  .validator((input: { url: string; token?: string }) => input)
  .handler(async ({ data }): Promise<OpenClawProbeResult> => {
    const hostedDemo = isHostedPaddyDemoEnv();
    const url = String(data.url ?? "");
    if (hostedDemo && isLoopbackOpenClawUrl(url)) {
      return {
        ok: false,
        error:
          "OpenClaw loopback is non-functional in the hosted demo. Self-host with `paddy gateway` to probe a local OpenClaw URL.",
      };
    }
    if (hostedDemo) {
      return { ok: false, error: hostedOpenClawDemoNote() };
    }
    const normalized = normalizeOpenClawUrl(url);
    const token = (data.token ?? "").trim();
    // Prefer Backend probe (models list / status openclaw); fall back to health endpoints.
    if (normalized) {
      const modelsProbe = await probeOpenClawModels(
        { url: normalized, token, model: "openclaw" },
        fetch,
      );
      if (modelsProbe.ok) {
        return {
          ok: true,
          detail: modelsProbe.detail,
          status: 200,
          endpoint: `${normalized.replace(/\/+$/, "")}/v1/models`,
        };
      }
      // If models path missing, try /health|/healthz for older gateways.
    }
    return probeOpenClawHealth({ url, token });
  });

export type SaveOpenClawTargetResult =
  | { ok: true; detail: string; target: OpenClawUiTarget; effectiveRuntime: AgentRuntime }
  | { ok: false; error: string };

export const saveOpenClawTarget = createServerFn({ method: "POST" })
  .middleware([cliGatewayMiddleware])
  .validator(
    (input: {
      runtime: AgentRuntime;
      url: string;
      token?: string;
      model?: string;
    }) => input,
  )
  .handler(async ({ data }): Promise<SaveOpenClawTargetResult> => {
    const hostedDemo = isHostedPaddyDemoEnv();
    if (hostedDemo) {
      return {
        ok: false,
        error:
          "OpenClaw target is not persisted on the hosted demo (runtime stays “paddy” + SuperGrok). Self-host with `paddy gateway`.",
      };
    }

    const url = normalizeOpenClawUrl(data.url);
    if (data.url.trim() && !url) {
      return { ok: false, error: "URL must be http:// or https://." };
    }

    const runtime: AgentRuntime = data.runtime === "openclaw" ? "openclaw" : "paddy";
    if (runtime === "openclaw" && !url) {
      return { ok: false, error: "Set an OpenClaw gateway URL before switching runtime to openclaw." };
    }

    const model = data.model == null ? "" : String(data.model).trim();
    const patch: Record<string, unknown> = { runtime, url, model };
    const token = (data.token ?? "").trim();
    if (token) {
      // Backend promotePlainSecrets maps plaintext → ${OPENCLAW_GATEWAY_TOKEN}
      patch.token = token;
    }

    try {
      const result = await configSet({
        data: { path: OPENCLAW_TARGET_ROOT, value: patch, merge: true },
      });
      if (!result.ok) {
        return { ok: false, error: result.error || "configSet failed" };
      }
      return {
        ok: true,
        detail: `Saved openclaw · runtime ${runtime}`,
        target: { runtime, url, model },
        effectiveRuntime: runtime,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Save failed",
      };
    }
  });
