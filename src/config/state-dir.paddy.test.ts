// Paddy's default state root is ~/.paddy. Every default path that upstream rooted at
// ~/.openclaw must now resolve under ~/.paddy so a separate OpenClaw install is never shared.
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDefaultAgentWorkspaceDir } from "../agents/workspace-default-path.js";
import { resolveProfileStateDir } from "../cli/profile-utils.js";
import { resolveGatewayStateDir } from "../daemon/paths.js";
import { resolveConfigDir } from "../infra/config-dir.js";
import { resolveExecApprovalsPath } from "../infra/exec-approvals-config.js";
import { resolveLegacyStandaloneAgentDir } from "../infra/state-migrations.agent-dir-receipt.js";
import { withTestDir } from "../test-helpers/temp-dir.js";
import {
  isDefaultInstallIdentity,
  resolveCanonicalConfigPath,
  resolveDefaultConfigCandidates,
} from "./paths.js";
import { resolveLegacyStateDirs, resolveNewStateDir, resolveStateDir } from "./state-dir.js";

const home = path.resolve("/home/paddy-user");
const homedir = () => home;
const paddy = path.join(home, ".paddy");

describe("Paddy default state dir", () => {
  it("roots the default state dir and config at ~/.paddy", () => {
    const env = { HOME: home };
    expect(resolveNewStateDir(homedir)).toBe(paddy);
    expect(resolveStateDir(env, homedir)).toBe(paddy);
    expect(resolveCanonicalConfigPath(env, paddy)).toBe(path.join(paddy, "openclaw.json"));
    expect(resolveDefaultConfigCandidates(env, homedir)).toEqual([
      path.join(paddy, "openclaw.json"),
    ]);
    expect(resolveLegacyStateDirs(homedir)).toEqual([]);
  });

  it("keeps the ~/.paddy default a default install identity (host service management stays on)", () => {
    expect(isDefaultInstallIdentity({ HOME: home }, homedir)).toBe(true);
    expect(
      isDefaultInstallIdentity(
        {
          HOME: home,
          OPENCLAW_STATE_DIR: paddy,
          OPENCLAW_CONFIG_PATH: path.join(paddy, "openclaw.json"),
        },
        homedir,
      ),
    ).toBe(true);
    // Pointing the override at a separate OpenClaw install is not the default install.
    expect(
      isDefaultInstallIdentity(
        { HOME: home, OPENCLAW_STATE_DIR: path.join(home, ".openclaw") },
        homedir,
      ),
    ).toBe(false);
  });

  it("derives profile, service, workspace, config-dir, approvals, and agent-dir defaults from ~/.paddy", () => {
    const env = { HOME: home };
    expect(resolveProfileStateDir("default", env, homedir)).toBe(paddy);
    expect(resolveProfileStateDir("work", env, homedir)).toBe(path.join(home, ".paddy-work"));
    expect(resolveGatewayStateDir(env)).toBe(paddy);
    expect(resolveGatewayStateDir({ HOME: home, OPENCLAW_PROFILE: "work" })).toBe(
      path.join(home, ".paddy-work"),
    );
    expect(resolveDefaultAgentWorkspaceDir(env, homedir)).toBe(path.join(paddy, "workspace"));
    expect(resolveConfigDir(env, homedir)).toBe(paddy);
    expect(resolveExecApprovalsPath(env)).toBe(path.join(paddy, "exec-approvals.json"));
    expect(resolveLegacyStandaloneAgentDir(homedir)).toBe(path.join(paddy, "agent"));
  });

  it("does not select an existing ~/.openclaw or ~/.clawdbot", async () => {
    await withTestDir({ prefix: "paddy-state-default-" }, async (root) => {
      await fs.mkdir(path.join(root, ".openclaw"), { recursive: true });
      await fs.writeFile(path.join(root, ".openclaw", "openclaw.json"), "{}");
      await fs.mkdir(path.join(root, ".clawdbot"), { recursive: true });
      await fs.writeFile(path.join(root, ".clawdbot", "clawdbot.json"), "{}");
      const env = { HOME: root };
      const rootHome = () => root;

      expect(resolveStateDir(env, rootHome)).toBe(path.join(root, ".paddy"));
      expect(resolveConfigDir(env, rootHome)).toBe(path.join(root, ".paddy"));
      expect(resolveDefaultAgentWorkspaceDir(env, rootHome)).toBe(
        path.join(root, ".paddy", "workspace"),
      );
    });
  });
});
