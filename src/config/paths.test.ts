// Covers config path resolution across env, home, and agent roots.
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveLegacyOAuthPath } from "../agents/auth-profiles/legacy-source-diagnostic.js";
import { withTestDir } from "../test-helpers/temp-dir.js";
import {
  allowsProcessHomeSessionScan,
  CONFIG_PATH,
  DEFAULT_GATEWAY_PORT,
  isDefaultInstallIdentity,
  isDefaultStateDir,
  isNixMode,
  normalizeStateDirEnv,
  pinRuntimePaths,
  resolveNativeServiceProfileConflict,
  resolveDefaultConfigCandidates,
  resolveCanonicalConfigPath,
  resolveConfigPathCandidate,
  resolveConfigPath,
  resolveGatewayPort,
  resolveIncludeRoots,
  resolveOAuthDir,
  resolveStateDir,
  STATE_DIR,
} from "./paths.js";
import { resolveLegacyStateDirs, resolveNewStateDir } from "./state-dir.js";

describe("default state directory", () => {
  it("matches filesystem aliases of the default state directory", async () => {
    await withTestDir({ prefix: "openclaw-default-state-" }, async (root) => {
      const home = path.join(root, "home");
      const defaultStateDir = path.join(home, ".paddy");
      const stateAlias = path.join(home, "state-alias");
      await fs.mkdir(defaultStateDir, { recursive: true });
      await fs.symlink(defaultStateDir, stateAlias, "dir");

      expect(isDefaultStateDir({ HOME: home, OPENCLAW_STATE_DIR: stateAlias }, () => home)).toBe(
        true,
      );
    });
  });
});

describe("default install identity", () => {
  it("accepts default paths and equivalent explicit overrides", () => {
    const home = "/home/test";
    const stateDir = path.join(home, ".paddy");
    const configPath = path.join(stateDir, "openclaw.json");

    expect(isDefaultInstallIdentity({ HOME: home }, () => home)).toBe(true);
    expect(allowsProcessHomeSessionScan({ HOME: home }, () => home)).toBe(true);
    expect(
      isDefaultInstallIdentity(
        { HOME: home, OPENCLAW_STATE_DIR: stateDir, OPENCLAW_CONFIG_PATH: configPath },
        () => home,
      ),
    ).toBe(true);
  });

  it("does not discover ~/.clawdbot or ~/.openclaw configs for the default profile", async () => {
    await withTestDir({ prefix: "openclaw-default-install-legacy-config-" }, async (home) => {
      const stateDir = path.join(home, ".paddy");
      for (const [dir, file] of [
        [".clawdbot", "clawdbot.json"],
        [".clawdbot", "openclaw.json"],
        [".openclaw", "openclaw.json"],
        [".openclaw", "clawdbot.json"],
        [".paddy", "clawdbot.json"],
      ] as const) {
        await fs.mkdir(path.join(home, dir), { recursive: true });
        await fs.writeFile(path.join(home, dir, file), "{}");
      }

      const env = { HOME: home };
      expect(resolveConfigPathCandidate(env, () => home)).toBe(
        path.join(stateDir, "openclaw.json"),
      );
      expect(isDefaultInstallIdentity(env, () => home)).toBe(true);
    });
  });

  it("rejects non-default state or config paths", () => {
    const home = "/home/test";

    expect(
      isDefaultInstallIdentity({ HOME: home, OPENCLAW_STATE_DIR: "/tmp/copied-state" }, () => home),
    ).toBe(false);
    expect(
      isDefaultInstallIdentity(
        { HOME: home, OPENCLAW_CONFIG_PATH: "/tmp/copied-openclaw.json" },
        () => home,
      ),
    ).toBe(false);
  });

  it("rejects process home overrides that relocate the implicit install", () => {
    const accountHome = "/home/test";
    const stateDir = path.join(accountHome, ".paddy");

    expect(isDefaultInstallIdentity({ HOME: "/tmp/copied-home" }, () => accountHome)).toBe(false);
    expect(
      isDefaultInstallIdentity(
        {
          HOME: "/tmp/copied-home",
          OPENCLAW_STATE_DIR: stateDir,
          OPENCLAW_CONFIG_PATH: path.join(stateDir, "openclaw.json"),
        },
        () => accountHome,
      ),
    ).toBe(false);
    expect(
      isDefaultInstallIdentity(
        {
          USERPROFILE: "/tmp/copied-home",
          OPENCLAW_STATE_DIR: stateDir,
          OPENCLAW_CONFIG_PATH: path.join(stateDir, "openclaw.json"),
        },
        () => accountHome,
      ),
    ).toBe(false);
  });

  it("rejects installs relocated through OPENCLAW_HOME", () => {
    const accountHome = "/home/test";
    const installHome = "/srv/openclaw";
    const stateDir = path.join(installHome, ".paddy");

    expect(isDefaultInstallIdentity({ OPENCLAW_HOME: installHome }, () => accountHome)).toBe(false);
    expect(
      isDefaultInstallIdentity(
        {
          OPENCLAW_HOME: installHome,
          OPENCLAW_STATE_DIR: stateDir,
          OPENCLAW_CONFIG_PATH: path.join(stateDir, "openclaw.json"),
        },
        () => accountHome,
      ),
    ).toBe(false);
    expect(
      isDefaultInstallIdentity(
        {
          OPENCLAW_HOME: installHome,
          OPENCLAW_PROFILE: "work",
          OPENCLAW_STATE_DIR: path.join(installHome, ".paddy-work"),
          OPENCLAW_CONFIG_PATH: path.join(installHome, ".paddy-work", "openclaw.json"),
        },
        () => accountHome,
      ),
    ).toBe(false);
  });

  it("keeps the default install identity for unset home literals", () => {
    const home = "/home/test";

    for (const literal of ["undefined", "null", "  undefined  "]) {
      const env = { HOME: home, OPENCLAW_HOME: literal };
      // Home resolution already reads these literals as unset, so the install
      // stays on the account home and the default state dir.
      expect(isDefaultInstallIdentity(env, () => home)).toBe(true);
      expect(allowsProcessHomeSessionScan(env, () => home)).toBe(true);
    }
  });

  it("accepts the canonical paths a named profile projects", async () => {
    await withTestDir({ prefix: "openclaw-profile-install-" }, async (home) => {
      const defaultStateDir = path.join(home, ".paddy");
      const profileStateDir = path.join(home, ".paddy-work");
      await fs.mkdir(defaultStateDir, { recursive: true });
      await fs.writeFile(path.join(defaultStateDir, "openclaw.json"), "{}");

      expect(
        isDefaultInstallIdentity(
          {
            HOME: home,
            OPENCLAW_PROFILE: "work",
            OPENCLAW_STATE_DIR: profileStateDir,
            OPENCLAW_CONFIG_PATH: path.join(profileStateDir, "openclaw.json"),
          },
          () => home,
        ),
      ).toBe(true);
      expect(
        allowsProcessHomeSessionScan(
          {
            HOME: home,
            OPENCLAW_PROFILE: "work",
            OPENCLAW_STATE_DIR: profileStateDir,
            OPENCLAW_CONFIG_PATH: path.join(profileStateDir, "openclaw.json"),
          },
          () => home,
        ),
      ).toBe(false);
      expect(
        isDefaultInstallIdentity(
          {
            HOME: home,
            OPENCLAW_PROFILE: "work",
            OPENCLAW_STATE_DIR: profileStateDir,
          },
          () => home,
        ),
      ).toBe(false);

      await fs.mkdir(profileStateDir, { recursive: true });
      await fs.writeFile(path.join(profileStateDir, "openclaw.json"), "{}");
      expect(
        isDefaultInstallIdentity(
          {
            HOME: home,
            OPENCLAW_PROFILE: "work",
            OPENCLAW_STATE_DIR: profileStateDir,
          },
          () => home,
        ),
      ).toBe(true);
      expect(
        isDefaultInstallIdentity(
          {
            HOME: home,
            OPENCLAW_PROFILE: "work",
            OPENCLAW_STATE_DIR: path.join(home, ".paddy-other"),
          },
          () => home,
        ),
      ).toBe(false);
      expect(
        isDefaultInstallIdentity(
          {
            HOME: home,
            OPENCLAW_PROFILE: "default",
            OPENCLAW_STATE_DIR: defaultStateDir,
          },
          () => home,
        ),
      ).toBe(true);
    });
  });

  it.each([
    {
      platform: "darwin" as const,
      envKey: "OPENCLAW_LAUNCHD_LABEL",
      value: "ai.openclaw.gateway",
    },
    {
      platform: "linux" as const,
      envKey: "OPENCLAW_SYSTEMD_UNIT",
      value: "openclaw-gateway.service",
    },
    {
      platform: "win32" as const,
      envKey: "OPENCLAW_WINDOWS_TASK_NAME",
      value: "OpenClaw Gateway",
    },
  ])("rejects a named profile overriding $envKey on $platform", ({ platform, envKey, value }) => {
    const home = "/home/test";
    const stateDir = path.join(home, ".paddy-work");
    expect(
      isDefaultInstallIdentity(
        {
          HOME: home,
          OPENCLAW_PROFILE: "work",
          OPENCLAW_STATE_DIR: stateDir,
          OPENCLAW_CONFIG_PATH: path.join(stateDir, "openclaw.json"),
          [envKey]: value,
        },
        () => home,
        platform,
      ),
    ).toBe(false);
  });

  it.each(["../escape", "work\\..\\escape", "."])(
    "rejects invalid profile %j even when its derived paths match",
    (profile) => {
      const home = "/home/test";
      const profileStateDir = path.join(home, `.paddy-${profile}`);

      expect(
        isDefaultInstallIdentity(
          {
            HOME: home,
            OPENCLAW_PROFILE: profile,
            OPENCLAW_STATE_DIR: profileStateDir,
            OPENCLAW_CONFIG_PATH: path.join(profileStateDir, "openclaw.json"),
          },
          () => home,
        ),
      ).toBe(false);
    },
  );

  it.each(["gateway", "node"])(
    "rejects macOS profile %j because its LaunchAgent label is reserved",
    (profile) => {
      expect(resolveNativeServiceProfileConflict({ OPENCLAW_PROFILE: profile }, "darwin")).toBe(
        profile,
      );
      expect(
        resolveNativeServiceProfileConflict({ OPENCLAW_PROFILE: profile }, "linux"),
      ).toBeNull();
    },
  );

  it.each(["Main"])(
    "rejects mixed-case native service profile %j on case-insensitive platforms",
    (profile) => {
      expect(resolveNativeServiceProfileConflict({ OPENCLAW_PROFILE: profile }, "darwin")).toBe(
        profile,
      );
      expect(resolveNativeServiceProfileConflict({ OPENCLAW_PROFILE: profile }, "win32")).toBe(
        profile,
      );
      expect(
        resolveNativeServiceProfileConflict({ OPENCLAW_PROFILE: profile }, "linux"),
      ).toBeNull();
    },
  );

  it("keeps lowercase native service profiles byte-compatible", () => {
    expect(resolveNativeServiceProfileConflict({ OPENCLAW_PROFILE: "main" }, "darwin")).toBeNull();
    expect(resolveNativeServiceProfileConflict({ OPENCLAW_PROFILE: "main" }, "win32")).toBeNull();
  });
});

describe("oauth paths", () => {
  it("prefers OPENCLAW_OAUTH_DIR over OPENCLAW_STATE_DIR", () => {
    const env = {
      OPENCLAW_OAUTH_DIR: "/custom/oauth",
      OPENCLAW_STATE_DIR: "/custom/state",
    };

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.resolve("/custom/oauth"));
    expect(resolveLegacyOAuthPath(env)).toBe(
      path.join(path.resolve("/custom/oauth"), "oauth.json"),
    );
  });

  it("derives oauth path from OPENCLAW_STATE_DIR when unset", () => {
    const env = {
      OPENCLAW_STATE_DIR: "/custom/state",
    };

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.join("/custom/state", "credentials"));
    expect(resolveLegacyOAuthPath(env)).toBe(
      path.join("/custom/state", "credentials", "oauth.json"),
    );
  });
});

describe("gateway port resolution", () => {
  it("prefers numeric env values over config", () => {
    expect(
      resolveGatewayPort(
        { gateway: { port: 19002 } },
        { OPENCLAW_GATEWAY_PORT: "19001", OPENCLAW_PROFILE: "work" },
      ),
    ).toBe(19001);
    expect(resolveGatewayPort({ gateway: { port: 19002 } }, { OPENCLAW_PROFILE: "work" })).toBe(
      19002,
    );
  });

  it.each([
    { profile: "ct2", expected: 45696 },
    { profile: "p1402", expected: 55636 },
    { profile: "p2380", expected: 55636 },
  ])("derives the byte-exact profile port for $profile", ({ profile, expected }) => {
    const port = resolveGatewayPort({}, { OPENCLAW_PROFILE: profile });
    expect(port).toBe(expected);
    expect(port).toBeGreaterThanOrEqual(20000);
    expect(port).toBeLessThan(60000);
  });

  it.each([undefined, "default", "Default", "../escape"])(
    "keeps the default port for profile %j",
    (profile) => {
      expect(resolveGatewayPort({}, { OPENCLAW_PROFILE: profile })).toBe(DEFAULT_GATEWAY_PORT);
    },
  );

  it("accepts Compose-style IPv4 host publish values from env", () => {
    expect(
      resolveGatewayPort(
        { gateway: { port: 19002 } },
        { OPENCLAW_GATEWAY_PORT: "127.0.0.1:18789" },
      ),
    ).toBe(18789);
  });

  it("accepts Compose-style IPv6 host publish values from env", () => {
    expect(
      resolveGatewayPort({ gateway: { port: 19002 } }, { OPENCLAW_GATEWAY_PORT: "[::1]:28789" }),
    ).toBe(28789);
  });

  it("ignores the legacy env name and falls back to config", () => {
    expect(
      resolveGatewayPort(
        { gateway: { port: 19002 } },
        { CLAWDBOT_GATEWAY_PORT: "127.0.0.1:18789" },
      ),
    ).toBe(19002);
  });

  it("falls back to config when the Compose-style suffix is invalid", () => {
    expect(
      resolveGatewayPort(
        { gateway: { port: 19003 } },
        { OPENCLAW_GATEWAY_PORT: "127.0.0.1:not-a-port" },
      ),
    ).toBe(19003);
  });

  it("falls back to config when env ports exceed TCP bounds", () => {
    expect(
      resolveGatewayPort({ gateway: { port: 19003 } }, { OPENCLAW_GATEWAY_PORT: "65536" }),
    ).toBe(19003);
    expect(
      resolveGatewayPort(
        { gateway: { port: 19004 } },
        { OPENCLAW_GATEWAY_PORT: "127.0.0.1:65536" },
      ),
    ).toBe(19004);
    expect(
      resolveGatewayPort({ gateway: { port: 19005 } }, { OPENCLAW_GATEWAY_PORT: "[::1]:65536" }),
    ).toBe(19005);
  });

  it("falls back when malformed IPv6 inputs do not provide an explicit port", () => {
    expect(resolveGatewayPort({ gateway: { port: 19003 } }, { OPENCLAW_GATEWAY_PORT: "::1" })).toBe(
      19003,
    );
    expect(resolveGatewayPort({}, { OPENCLAW_GATEWAY_PORT: "2001:db8::1" })).toBe(
      DEFAULT_GATEWAY_PORT,
    );
  });

  it("falls back to the default port when env is invalid and config is unset", () => {
    expect(resolveGatewayPort({}, { OPENCLAW_GATEWAY_PORT: "127.0.0.1:not-a-port" })).toBe(
      DEFAULT_GATEWAY_PORT,
    );
  });
});

describe("state + config path candidates", () => {
  function expectOpenClawHomeDefaults(env: NodeJS.ProcessEnv): void {
    const configuredHome = env.OPENCLAW_HOME;
    if (!configuredHome) {
      throw new Error("OPENCLAW_HOME must be set for this assertion helper");
    }
    const resolvedHome = path.resolve(configuredHome);
    expect(resolveStateDir(env)).toBe(path.join(resolvedHome, ".paddy"));

    const candidates = resolveDefaultConfigCandidates(env);
    expect(candidates[0]).toBe(path.join(resolvedHome, ".paddy", "openclaw.json"));
  }

  it("uses OPENCLAW_STATE_DIR when set", () => {
    const env = {
      OPENCLAW_STATE_DIR: "/new/state",
    };

    expect(resolveStateDir(env, () => "/home/test")).toBe(path.resolve("/new/state"));
  });

  it("pins a relative state-dir override before later resolution", () => {
    const env = {
      OPENCLAW_STATE_DIR: "relative-state",
      OPENCLAW_HOME: "/srv/openclaw-home",
    };

    normalizeStateDirEnv(env);
    const normalized = env.OPENCLAW_STATE_DIR;

    expect(normalized).toBe(path.resolve("relative-state"));
    expect(resolveStateDir(env, () => "/srv/other-home")).toBe(normalized);
  });

  it("re-pins exported runtime paths after startup environment selection", () => {
    const originalConfigPath = CONFIG_PATH;
    const originalNixMode = isNixMode;
    const originalStateDir = STATE_DIR;
    const selectedStateDir = path.resolve("/tmp/openclaw-selected-runtime-state");
    const selectedConfigPath = path.join(selectedStateDir, "selected.json");
    try {
      const pinned = pinRuntimePaths({
        OPENCLAW_CONFIG_PATH: selectedConfigPath,
        OPENCLAW_NIX_MODE: "1",
        OPENCLAW_STATE_DIR: selectedStateDir,
        OPENCLAW_TEST_FAST: "1",
      });

      expect(pinned).toEqual({
        configPath: selectedConfigPath,
        stateDir: selectedStateDir,
      });
      expect(CONFIG_PATH).toBe(selectedConfigPath);
      expect(isNixMode).toBe(true);
      expect(STATE_DIR).toBe(selectedStateDir);
    } finally {
      pinRuntimePaths({
        OPENCLAW_CONFIG_PATH: originalConfigPath,
        OPENCLAW_NIX_MODE: originalNixMode ? "1" : undefined,
        OPENCLAW_STATE_DIR: originalStateDir,
        OPENCLAW_TEST_FAST: "1",
      });
    }
  });

  it("prefers OPENCLAW_HOME over HOME for default state/config locations", () => {
    const env = {
      OPENCLAW_HOME: "/srv/openclaw-home",
      HOME: "/home/other",
    };
    expectOpenClawHomeDefaults(env);
  });

  it("orders default config candidates in a stable order", () => {
    const home = "/home/test";
    const resolvedHome = path.resolve(home);
    const candidates = resolveDefaultConfigCandidates({}, () => home);
    // Paddy discovers only its own config; no ~/.openclaw or clawdbot candidates.
    const expected = [path.join(resolvedHome, ".paddy", "openclaw.json")];
    expect(candidates).toEqual(expected);
  });

  it("defaults to ~/.paddy when no state dir exists yet", () => {
    expect(resolveStateDir({}, () => "/home/test")).toBe(path.join("/home/test", ".paddy"));
  });

  it("prefers ~/.paddy when it exists alongside ~/.openclaw and ~/.clawdbot", async () => {
    await withTestDir({ prefix: "openclaw-state-" }, async (root) => {
      const newDir = path.join(root, ".paddy");
      await fs.mkdir(newDir, { recursive: true });
      await fs.mkdir(path.join(root, ".openclaw"), { recursive: true });
      await fs.mkdir(path.join(root, ".clawdbot"), { recursive: true });
      const resolved = resolveStateDir({}, () => root);
      expect(resolved).toBe(newDir);
    });
  });

  it("never adopts an existing ~/.openclaw or ~/.clawdbot when ~/.paddy is missing", async () => {
    await withTestDir({ prefix: "openclaw-state-legacy-" }, async (root) => {
      await fs.mkdir(path.join(root, ".openclaw"), { recursive: true });
      await fs.mkdir(path.join(root, ".clawdbot"), { recursive: true });
      const resolved = resolveStateDir({}, () => root);
      expect(resolved).toBe(path.join(root, ".paddy"));
      expect(resolveNewStateDir(() => root)).toBe(path.join(root, ".paddy"));
      expect(resolveLegacyStateDirs(() => root)).toEqual([]);
    });
  });

  it("CONFIG_PATH prefers existing config when present", async () => {
    await withTestDir({ prefix: "openclaw-config-" }, async (root) => {
      const legacyDir = path.join(root, ".paddy");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyPath = path.join(legacyDir, "openclaw.json");
      await fs.writeFile(legacyPath, "{}", "utf-8");

      const resolved = resolveConfigPathCandidate({}, () => root);
      expect(resolved).toBe(legacyPath);
    });
  });

  it("CONFIG_PATH ignores an existing ~/.openclaw/openclaw.json", async () => {
    await withTestDir({ prefix: "openclaw-config-foreign-" }, async (root) => {
      const openclawDir = path.join(root, ".openclaw");
      await fs.mkdir(openclawDir, { recursive: true });
      await fs.writeFile(path.join(openclawDir, "openclaw.json"), "{}", "utf-8");

      expect(resolveConfigPathCandidate({}, () => root)).toBe(
        path.join(root, ".paddy", "openclaw.json"),
      );
    });
  });

  it.each([
    { name: "candidate", resolve: resolveConfigPathCandidate },
    { name: "active", resolve: resolveConfigPath },
    { name: "canonical", resolve: resolveCanonicalConfigPath },
  ])("resolves explicit config selection in $name without filesystem discovery", ({ resolve }) => {
    const home = path.resolve("config-selection-home");
    const configPath = path.join(home, "selected.json");
    const exists = vi.spyOn(fsSync, "existsSync").mockReturnValue(false);
    try {
      expect(resolve({ HOME: home, OPENCLAW_CONFIG_PATH: configPath })).toBe(configPath);
      expect(exists).not.toHaveBeenCalled();
    } finally {
      exists.mockRestore();
    }
  });

  it("respects state dir overrides when config is missing", async () => {
    await withTestDir({ prefix: "openclaw-config-override-" }, async (root) => {
      const legacyDir = path.join(root, ".paddy");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyConfig = path.join(legacyDir, "openclaw.json");
      await fs.writeFile(legacyConfig, "{}", "utf-8");

      const overrideDir = path.join(root, "override");
      const env = { OPENCLAW_STATE_DIR: overrideDir };
      const resolved = resolveConfigPath(env, overrideDir, () => root);
      expect(resolved).toBe(path.join(overrideDir, "openclaw.json"));
    });
  });
});

describe("resolveIncludeRoots", () => {
  const HOME = path.parse(process.cwd()).root + "fakehome";

  it("returns an empty list when OPENCLAW_INCLUDE_ROOTS is unset or blank", () => {
    expect(resolveIncludeRoots({}, () => HOME)).toStrictEqual([]);
    expect(resolveIncludeRoots({ OPENCLAW_INCLUDE_ROOTS: "" }, () => HOME)).toStrictEqual([]);
    expect(resolveIncludeRoots({ OPENCLAW_INCLUDE_ROOTS: "   " }, () => HOME)).toStrictEqual([]);
  });

  it("splits on the platform path delimiter and resolves each entry to an absolute path", () => {
    const a = path.resolve(path.parse(process.cwd()).root, "shared", "a");
    const b = path.resolve(path.parse(process.cwd()).root, "shared", "b");
    const env = { OPENCLAW_INCLUDE_ROOTS: [a, b].join(path.delimiter) };
    expect(resolveIncludeRoots(env, () => HOME)).toEqual([a, b]);
  });

  it("expands a leading tilde in each entry using the resolved home dir", () => {
    const env = { OPENCLAW_INCLUDE_ROOTS: "~/share/openclaw" };
    expect(resolveIncludeRoots(env, () => HOME)).toEqual([path.join(HOME, "share", "openclaw")]);
  });

  it("drops empty entries and preserves de-duplicated order for repeated roots", () => {
    const a = path.resolve(path.parse(process.cwd()).root, "shared", "a");
    const env = {
      OPENCLAW_INCLUDE_ROOTS: ["", a, "  ", a].join(path.delimiter),
    };
    expect(resolveIncludeRoots(env, () => HOME)).toEqual([a]);
  });
});
