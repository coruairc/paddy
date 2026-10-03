import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  writeNativeHookRelayBridgeRecord,
  type NativeHookRelayBridgeRecord,
} from "../agents/harness/native-hook-relay-store.js";
import {
  autoMigrateLegacyStateDir,
  resetAutoMigrateLegacyStateDirForTest,
} from "../infra/state-migrations.state-dir.js";
import { closeOpenClawStateDatabaseAsync } from "../state/openclaw-state-db-cache.js";
import { openOpenClawStateDatabase } from "../state/openclaw-state-db.js";
import { captureOpenClawStateWorkerContext } from "../state/openclaw-state-worker-context.js";
import { executeOpenClawStateWorker } from "../state/openclaw-state-worker-store.js";
import { withEnvAsync } from "../test-utils/env.js";
import { withOpenClawTestState } from "../test-utils/openclaw-test-state.js";
import { beginDoctorMaintenance } from "./doctor-maintenance.js";

function relayRecord(revision: number): NativeHookRelayBridgeRecord {
  return {
    relayId: "doctor",
    pid: revision,
    hostname: "127.0.0.1",
    port: 18789,
    token: "synthetic-doctor-worker-token",
    expiresAtMs: 20000,
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await closeOpenClawStateDatabaseAsync();
  resetAutoMigrateLegacyStateDirForTest();
});

describe("Doctor maintenance with shared-state workers", () => {
  it("never relocates a legacy ~/.clawdbot state root around Doctor maintenance", async () => {
    await withOpenClawTestState(
      { layout: "home", scenario: "external-service", label: "doctor-legacy-root" },
      async (state) => {
        openOpenClawStateDatabase();
        await closeOpenClawStateDatabaseAsync();
        const legacy = path.join(state.home, ".clawdbot");
        fs.renameSync(state.stateDir, legacy);
        await withEnvAsync(
          {
            OPENCLAW_STATE_DIR: "",
            OPENCLAW_CONFIG_PATH: "",
            OPENCLAW_TEST_FAST: "0",
            OPENCLAW_DISABLE_BUNDLED_PLUGINS: "1",
          },
          async () => {
            const result = await autoMigrateLegacyStateDir({ env: process.env });
            expect(result.migrated).toBe(false);
            expect(fs.lstatSync(legacy).isDirectory()).toBe(true);
            expect(fs.existsSync(state.stateDir)).toBe(false);
          },
        );
      },
    );
  });
  // Upstream's seven implicit-relocation scenarios (schema upgrade, resident worker, link
  // rollback, contenders, receipts) all exercised the ~/.clawdbot -> default-root move. Paddy has
  // no legacy roots, so there is no move to hold custody over; what remains to pin is that a full
  // Doctor maintenance window never moves, links, or reads a legacy root, including upstream's own
  // ~/.openclaw default and a config path that still points into that root.
  it.each([
    { legacyName: ".clawdbot", configInLegacy: false },
    { legacyName: ".clawdbot", configInLegacy: true },
    { legacyName: ".openclaw", configInLegacy: false },
    { legacyName: ".openclaw", configInLegacy: true },
  ])(
    "Doctor maintenance leaves a legacy ~/$legacyName root untouched (config in legacy root: $configInLegacy)",
    async ({ legacyName, configInLegacy }) => {
      await withOpenClawTestState(
        { layout: "home", scenario: "external-service", label: "doctor-legacy-root-window" },
        async (state) => {
          const { db } = openOpenClawStateDatabase();
          db.exec(`
            INSERT INTO config_machine_state (state_key, value_json, updated_at_ms)
              VALUES ('doctor-relocation-sentinel', '{"keep":true}', 1);
          `);
          await closeOpenClawStateDatabaseAsync();
          const legacy = path.join(state.home, legacyName);
          fs.renameSync(state.stateDir, legacy);
          const readSentinel = (databasePath: string) => {
            const database = new DatabaseSync(databasePath, { readOnly: true });
            try {
              return database
                .prepare("SELECT value_json FROM config_machine_state WHERE state_key = ?")
                .get("doctor-relocation-sentinel");
            } finally {
              database.close();
            }
          };
          await withEnvAsync(
            {
              OPENCLAW_STATE_DIR: "",
              OPENCLAW_CONFIG_PATH: configInLegacy ? path.join(legacy, "openclaw.json") : "",
              OPENCLAW_TEST_FAST: "0",
              OPENCLAW_DISABLE_BUNDLED_PLUGINS: "1",
            },
            async () => {
              const log = vi.fn();
              const maintenance = await beginDoctorMaintenance({
                options: { repair: true, nonInteractive: true },
                root: null,
                runtime: { log, error() {}, exit() {} },
              });
              try {
                await maintenance!.run(async () => {
                  const result = await autoMigrateLegacyStateDir({ env: process.env });
                  expect(result.migrated).toBe(false);
                  expect(result.changes).toEqual([]);
                });
              } finally {
                await maintenance?.release();
              }
              await closeOpenClawStateDatabaseAsync();
              expect(log.mock.calls.flat().join("\n")).not.toMatch(/State dir( migration)?[: ]/);
            },
          );
          expect(fs.lstatSync(legacy).isSymbolicLink()).toBe(false);
          expect(fs.lstatSync(legacy).isDirectory()).toBe(true);
          expect(readSentinel(path.join(legacy, "state", "openclaw.sqlite"))).toEqual({
            value_json: '{"keep":true}',
          });
          const paddyDatabase = path.join(state.stateDir, "state", "openclaw.sqlite");
          if (fs.existsSync(paddyDatabase)) {
            expect(fs.lstatSync(state.stateDir).isSymbolicLink()).toBe(false);
            expect(readSentinel(paddyDatabase)).toBeUndefined();
          }
        },
      );
    },
  );
  it.each([
    { alreadyOpen: false, reload: false },
    { alreadyOpen: true, reload: false },
    { alreadyOpen: true, reload: true },
  ])(
    "completes writes and drainage with an already-open worker=$alreadyOpen after module reload=$reload",
    async ({ alreadyOpen, reload }) => {
      await withOpenClawTestState(
        { scenario: "external-service", label: "doctor-managed-worker" },
        async () => {
          openOpenClawStateDatabase();
          let execute = executeOpenClawStateWorker;
          let capture = captureOpenClawStateWorkerContext;
          let write = writeNativeHookRelayBridgeRecord;
          if (alreadyOpen) {
            await execute(capture(), {
              type: "nativeHookRelay.read",
              input: { relayId: "doctor" },
            });
          }
          let enterMaintenance = beginDoctorMaintenance;
          if (reload) {
            await closeOpenClawStateDatabaseAsync();
            vi.resetModules();
            const [doctor, worker, contexts, relay] = await Promise.all([
              import("./doctor-maintenance.js"),
              import("../state/openclaw-state-worker-store.js"),
              import("../state/openclaw-state-worker-context.js"),
              import("../agents/harness/native-hook-relay-store.js"),
            ]);
            enterMaintenance = doctor.beginDoctorMaintenance;
            execute = worker.executeOpenClawStateWorker;
            capture = contexts.captureOpenClawStateWorkerContext;
            write = relay.writeNativeHookRelayBridgeRecord;
          }
          const maintenance = await enterMaintenance({
            options: { repair: true, nonInteractive: true },
            root: null,
            runtime: { log() {}, error() {}, exit() {} },
          });
          const record = relayRecord(1);
          try {
            await maintenance!.run(async () => {
              await write({ record, updatedAtMs: 1 });
              expect(
                await execute(capture(), {
                  type: "nativeHookRelay.read",
                  input: { relayId: record.relayId },
                }),
              ).toEqual(record);
            });
          } finally {
            await maintenance?.release();
          }
          await closeOpenClawStateDatabaseAsync();
          expect(
            await execute(capture(), {
              type: "nativeHookRelay.read",
              input: { relayId: record.relayId },
            }),
          ).toEqual(record);
          const successor = relayRecord(2);
          await write({ record: successor, updatedAtMs: 2 });
          expect(
            await execute(capture(), {
              type: "nativeHookRelay.read",
              input: { relayId: record.relayId },
            }),
          ).toEqual(successor);
        },
      );
    },
  );
});
