// Verifies state-dir migrations preserve existing OpenClaw runtime data.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getPluginInstallRecordMapEntry } from "../config/plugin-install-record-map.js";
import { hashJson } from "../plugins/installed-plugin-index-hash.js";
import { writePersistedInstalledPluginIndex } from "../plugins/installed-plugin-index-store-write.js";
import { readPersistedInstalledPluginIndex } from "../plugins/installed-plugin-index-store.js";
import { runOpenClawStateWriteTransaction } from "../state/openclaw-state-db.js";
import { withTestDir } from "../test-helpers/temp-dir.js";
import {
  autoMigrateLegacyStateDir,
  resetAutoMigrateLegacyStateDirForTest,
  resolvePendingLegacyStateDirMigrationPaths,
} from "./state-migrations.state-dir.js";

async function withStateDirFixture(run: (root: string) => Promise<void>): Promise<void> {
  try {
    await withTestDir({ prefix: "openclaw-state-dir-" }, async (root) => {
      await run(root);
    });
  } finally {
    resetAutoMigrateLegacyStateDirForTest();
  }
}

describe("legacy state dir auto-migration", () => {
  // Paddy has no legacy state dirs: ~/.openclaw belongs to a separate OpenClaw install and
  // ~/.clawdbot to an even older one. Doctor must never adopt, move, or symlink either.
  it("never takes over, moves, or links an existing ~/.openclaw or ~/.clawdbot", async () => {
    await withStateDirFixture(async (root) => {
      const openclawDir = path.join(root, ".openclaw");
      const clawdbotDir = path.join(root, ".clawdbot");
      const paddyDir = path.join(root, ".paddy");
      for (const dir of [openclawDir, clawdbotDir]) {
        fs.mkdirSync(path.join(dir, "agents", "main", "sessions"), { recursive: true });
        fs.writeFileSync(path.join(dir, "openclaw.json"), '{"marker":"keep"}', "utf-8");
        fs.writeFileSync(path.join(dir, "clawdbot.json"), '{"marker":"keep"}', "utf-8");
        fs.writeFileSync(path.join(dir, "agents", "main", "sessions", "s.jsonl"), "{}\n", "utf-8");
      }

      expect(resolvePendingLegacyStateDirMigrationPaths({ env: {}, homedir: () => root })).toBe(
        undefined,
      );
      const result = await autoMigrateLegacyStateDir({ env: {}, homedir: () => root });

      expect(result).toMatchObject({ migrated: false, changes: [], warnings: [] });
      for (const dir of [openclawDir, clawdbotDir]) {
        expect(fs.lstatSync(dir).isSymbolicLink()).toBe(false);
        expect(fs.lstatSync(dir).isDirectory()).toBe(true);
        expect(fs.readFileSync(path.join(dir, "openclaw.json"), "utf-8")).toBe('{"marker":"keep"}');
        expect(fs.readFileSync(path.join(dir, "clawdbot.json"), "utf-8")).toBe('{"marker":"keep"}');
        expect(fs.existsSync(path.join(dir, "agents", "main", "sessions", "s.jsonl"))).toBe(true);
      }
      expect(fs.existsSync(path.join(paddyDir, "openclaw.json"))).toBe(false);
      expect(fs.existsSync(path.join(paddyDir, "clawdbot.json"))).toBe(false);
      expect(fs.existsSync(path.join(paddyDir, "agents"))).toBe(false);
    });
  });

  it("leaves legacy-named symlinks and empty dirs alone when ~/.paddy exists", async () => {
    await withStateDirFixture(async (root) => {
      const paddyDir = path.join(root, ".paddy");
      const openclawTarget = path.join(root, "openclaw-real-state");
      const openclawLink = path.join(root, ".openclaw");
      const clawdbotDir = path.join(root, ".clawdbot");
      fs.mkdirSync(paddyDir, { recursive: true });
      fs.writeFileSync(path.join(paddyDir, "openclaw.json"), "{}", "utf-8");
      fs.mkdirSync(openclawTarget, { recursive: true });
      fs.writeFileSync(path.join(openclawTarget, "marker.txt"), "ok", "utf-8");
      fs.symlinkSync(
        openclawTarget,
        openclawLink,
        process.platform === "win32" ? "junction" : "dir",
      );
      // Upstream retires an empty legacy dir by replacing it with a symlink to the new root.
      fs.mkdirSync(clawdbotDir, { recursive: true });

      const result = await autoMigrateLegacyStateDir({ env: {}, homedir: () => root });

      expect(result).toMatchObject({ migrated: false, changes: [], warnings: [] });
      expect(fs.realpathSync(openclawLink)).toBe(fs.realpathSync(openclawTarget));
      expect(fs.readFileSync(path.join(openclawLink, "marker.txt"), "utf-8")).toBe("ok");
      expect(fs.lstatSync(clawdbotDir).isSymbolicLink()).toBe(false);
      expect(fs.readdirSync(clawdbotDir)).toEqual([]);
      expect(fs.readdirSync(paddyDir)).toEqual(["openclaw.json"]);
    });
  });

  it("skips state-dir migration when OPENCLAW_STATE_DIR is explicitly set", async () => {
    await withStateDirFixture(async (root) => {
      const legacyDir = path.join(root, ".clawdbot");
      fs.mkdirSync(legacyDir, { recursive: true });

      const result = await autoMigrateLegacyStateDir({
        env: { OPENCLAW_STATE_DIR: path.join(root, "custom-state") } as NodeJS.ProcessEnv,
        homedir: () => root,
      });

      expect(result).toEqual({
        migrated: false,
        skipped: true,
        changes: [],
        warnings: [],
      });
      expect(fs.existsSync(legacyDir)).toBe(true);
    });
  });

  it("migrates the legacy plugin install index from an explicit state dir", async () => {
    await withStateDirFixture(async (root) => {
      const legacyDir = path.join(root, ".clawdbot");
      const stateDir = path.join(root, "custom-state");
      const sourcePath = path.join(stateDir, "plugins", "installs.json");
      fs.mkdirSync(legacyDir, { recursive: true });
      fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
      fs.writeFileSync(
        sourcePath,
        '{"records":{"demo":{"source":"npm","spec":"demo@1.0.0"},"constructor":{"source":"path"},"toString":{"source":"git"},"__proto__":{"source":"archive"}}}',
        "utf8",
      );

      const result = await autoMigrateLegacyStateDir({
        env: { OPENCLAW_STATE_DIR: stateDir } as NodeJS.ProcessEnv,
        homedir: () => root,
      });

      expect(result.migrated).toBe(true);
      expect(result.skipped).toBe(false);
      expect(result.changes).toContain(
        "Migrated plugin install index 4 records → shared SQLite state",
      );
      expect(fs.existsSync(legacyDir)).toBe(true);
      expect(fs.existsSync(sourcePath)).toBe(false);
      const persisted = await readPersistedInstalledPluginIndex({ stateDir });
      if (!persisted) {
        throw new Error("Expected migrated plugin install index");
      }
      expect(Object.getPrototypeOf(persisted.installRecords)).toBeNull();
      expect(getPluginInstallRecordMapEntry(persisted.installRecords, "demo")).toEqual({
        source: "npm",
        spec: "demo@1.0.0",
      });
      expect(getPluginInstallRecordMapEntry(persisted.installRecords, "constructor")).toEqual({
        source: "path",
      });
      expect(getPluginInstallRecordMapEntry(persisted.installRecords, "toString")).toEqual({
        source: "git",
      });
      expect(getPluginInstallRecordMapEntry(persisted.installRecords, "__proto__")).toEqual({
        source: "archive",
      });
    });
  });

  it("does not rewrite invalid SQLite records or archive a valid legacy index", async () => {
    await withStateDirFixture(async (root) => {
      const stateDir = path.join(root, "custom-state");
      const sourcePath = path.join(stateDir, "plugins", "installs.json");
      fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
      fs.writeFileSync(
        sourcePath,
        JSON.stringify({ records: { demo: { source: "npm", spec: "demo@1.0.0" } } }),
        "utf8",
      );
      const installRecordsJson = '{"__proto__":{"source":"bogus"}}';
      // Built by string concatenation so the "__proto__" key survives as JSON
      // text instead of mutating a JS object prototype during serialization.
      const persistedValueJson =
        '{"revision":123,"index":{"version":1,"hostContractVersion":"test",' +
        '"compatRegistryVersion":"test","migrationVersion":1,"policyHash":"test",' +
        `"generatedAtMs":1,"installRecords":${installRecordsJson},"plugins":[],"diagnostics":[]}}`;
      runOpenClawStateWriteTransaction(
        ({ db }) => {
          db.prepare(
            `
              INSERT OR REPLACE INTO config_machine_state (state_key, value_json, updated_at_ms)
              VALUES ('plugins.installedIndex', ?, 123)
            `,
          ).run(persistedValueJson);
        },
        { env: { ...process.env, OPENCLAW_STATE_DIR: stateDir } },
      );

      const result = await autoMigrateLegacyStateDir({
        env: { OPENCLAW_STATE_DIR: stateDir } as NodeJS.ProcessEnv,
        homedir: () => root,
      });

      expect(result.changes).toEqual([]);
      expect(result.warnings).toEqual([
        `Left plugin install index in place because persisted install records in ${stateDir} are invalid`,
      ]);
      expect(fs.existsSync(sourcePath)).toBe(true);
      expect(fs.existsSync(`${sourcePath}.migrated`)).toBe(false);
      const row = runOpenClawStateWriteTransaction(
        ({ db }) =>
          db
            .prepare(
              `SELECT value_json, updated_at_ms
                 FROM config_machine_state
                WHERE state_key = 'plugins.installedIndex'`,
            )
            .get() as { value_json: string; updated_at_ms: number | bigint },
        { env: { ...process.env, OPENCLAW_STATE_DIR: stateDir } },
      );
      expect(row).toEqual({ value_json: persistedValueJson, updated_at_ms: 123 });
    });
  });

  it("reports conflicting plugin install metadata as a notice from the early state-dir pass", async () => {
    await withStateDirFixture(async (root) => {
      const stateDir = path.join(root, "custom-state");
      const sourcePath = path.join(stateDir, "plugins", "installs.json");
      await writePersistedInstalledPluginIndex(
        {
          version: 1,
          hostContractVersion: "test",
          compatRegistryVersion: "test",
          migrationVersion: 1,
          policyHash: "test",
          generatedAtMs: 1,
          installRecords: {
            demo: { source: "npm", spec: "demo@latest", version: "1.0.0" },
          },
          plugins: [
            {
              pluginId: "demo",
              installRecordHash: hashJson({
                source: "npm",
                spec: "demo@latest",
                version: "1.0.0",
              }),
              manifestPath: "/plugins/demo/openclaw.plugin.json",
              manifestHash: "test",
              rootDir: "/plugins/demo",
              origin: "global",
              enabled: false,
              startup: {
                sidecar: false,
                memory: false,
                agentHarnesses: [],
              },
              compat: [],
            },
          ],
          diagnostics: [],
        },
        { stateDir },
      );
      fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
      fs.writeFileSync(
        sourcePath,
        JSON.stringify({
          records: {
            demo: { source: "npm", spec: "demo@1.0.0", version: "1.0.0" },
          },
        }),
        "utf8",
      );

      const result = await autoMigrateLegacyStateDir({
        env: { OPENCLAW_STATE_DIR: stateDir } as NodeJS.ProcessEnv,
        homedir: () => root,
      });

      expect(result.warnings).toStrictEqual([]);
      expect(result.notices).toStrictEqual([
        "Kept canonical shared SQLite plugin install metadata despite differing legacy records for: demo",
      ]);
      expect(result.skipped).toBe(false);
      expect(fs.existsSync(sourcePath)).toBe(false);
      expect(fs.existsSync(`${sourcePath}.migrated`)).toBe(true);
    });
  });

  it("removes legacy plugin install index source when the existing archive has identical bytes", async () => {
    await withStateDirFixture(async (root) => {
      const stateDir = path.join(root, "custom-state");
      const sourcePath = path.join(stateDir, "plugins", "installs.json");
      const archivePath = `${sourcePath}.migrated`;
      const legacyJson = JSON.stringify({
        records: {
          demo: {
            source: "npm",
            spec: "demo@1.0.0",
          },
        },
      });
      fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
      fs.writeFileSync(sourcePath, legacyJson, "utf8");
      fs.writeFileSync(archivePath, legacyJson, "utf8");

      const first = await autoMigrateLegacyStateDir({
        env: { OPENCLAW_STATE_DIR: stateDir } as NodeJS.ProcessEnv,
        homedir: () => root,
      });

      expect(first.warnings).toStrictEqual([]);
      expect(first.changes).toContain(
        `Removed already-archived plugin install index legacy source ${sourcePath}`,
      );
      expect(fs.existsSync(sourcePath)).toBe(false);
      expect(fs.readFileSync(archivePath, "utf8")).toBe(legacyJson);
      await expect(readPersistedInstalledPluginIndex({ stateDir })).resolves.toMatchObject({
        installRecords: { demo: { source: "npm", spec: "demo@1.0.0" } },
      });

      resetAutoMigrateLegacyStateDirForTest();
      const second = await autoMigrateLegacyStateDir({
        env: { OPENCLAW_STATE_DIR: stateDir } as NodeJS.ProcessEnv,
        homedir: () => root,
      });
      expect(second.changes).toStrictEqual([]);
      expect(second.warnings).toStrictEqual([]);
    });
  });

  it("renames legacy plugin install index source to the next archive when existing archive differs", async () => {
    await withStateDirFixture(async (root) => {
      const stateDir = path.join(root, "custom-state");
      const sourcePath = path.join(stateDir, "plugins", "installs.json");
      const archivePath = `${sourcePath}.migrated`;
      const nextArchivePath = `${sourcePath}.migrated.2`;
      const legacyJson = JSON.stringify({
        records: {
          demo: {
            source: "npm",
            spec: "demo@1.0.0",
          },
        },
      });
      fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
      fs.writeFileSync(sourcePath, legacyJson, "utf8");
      fs.writeFileSync(archivePath, "older archive", "utf8");

      const first = await autoMigrateLegacyStateDir({
        env: { OPENCLAW_STATE_DIR: stateDir } as NodeJS.ProcessEnv,
        homedir: () => root,
      });

      expect(first.warnings).toStrictEqual([]);
      expect(first.changes).toContain(
        `Archived plugin install index legacy source → ${nextArchivePath}`,
      );
      expect(fs.existsSync(sourcePath)).toBe(false);
      expect(fs.readFileSync(archivePath, "utf8")).toBe("older archive");
      expect(fs.readFileSync(nextArchivePath, "utf8")).toBe(legacyJson);
      await expect(readPersistedInstalledPluginIndex({ stateDir })).resolves.toMatchObject({
        installRecords: { demo: { source: "npm", spec: "demo@1.0.0" } },
      });

      resetAutoMigrateLegacyStateDirForTest();
      const second = await autoMigrateLegacyStateDir({
        env: { OPENCLAW_STATE_DIR: stateDir } as NodeJS.ProcessEnv,
        homedir: () => root,
      });
      expect(second.changes).toStrictEqual([]);
      expect(second.warnings).toStrictEqual([]);
    });
  });

  it("only runs once per process until reset", async () => {
    await withStateDirFixture(async (root) => {
      const first = await autoMigrateLegacyStateDir({
        env: {} as NodeJS.ProcessEnv,
        homedir: () => root,
      });
      const second = await autoMigrateLegacyStateDir({
        env: {} as NodeJS.ProcessEnv,
        homedir: () => root,
      });

      expect(first.skipped).toBe(false);
      expect(second).toEqual({
        migrated: false,
        skipped: true,
        changes: [],
        warnings: [],
      });
    });
  });

  it("migrates the legacy plugin install index before config reads", async () => {
    await withStateDirFixture(async (root) => {
      const stateDir = path.join(root, ".paddy");
      const sourcePath = path.join(stateDir, "plugins", "installs.json");
      fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
      fs.writeFileSync(
        sourcePath,
        JSON.stringify({
          records: {
            demo: {
              source: "npm",
              spec: "demo@1.0.0",
            },
          },
        }),
        "utf8",
      );

      const result = await autoMigrateLegacyStateDir({
        env: {} as NodeJS.ProcessEnv,
        homedir: () => root,
      });

      expect(result.migrated).toBe(true);
      expect(result.changes).toContain(
        "Migrated plugin install index 1 record → shared SQLite state",
      );
      expect(fs.existsSync(sourcePath)).toBe(false);
      await expect(readPersistedInstalledPluginIndex({ stateDir })).resolves.toMatchObject({
        installRecords: { demo: { source: "npm", spec: "demo@1.0.0" } },
      });
    });
  });
});
