// A failing legacy-config copy must surface, not silently leave doctor
// looking like a clean fresh install while the operator's config exists.
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withTempDir } from "../test-utils/temp-dir.js";
import { runDoctorConfigPreflight } from "./doctor-config-preflight.js";

const envKeys = ["HOME", "OPENCLAW_CONFIG_PATH", "OPENCLAW_STATE_DIR"] as const;
const savedEnv = new Map<string, string | undefined>();

function setEnv(values: Partial<Record<(typeof envKeys)[number], string>>) {
  for (const key of envKeys) {
    if (!savedEnv.has(key)) {
      savedEnv.set(key, process.env[key]);
    }
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  savedEnv.clear();
});

// Upstream copied ~/.clawdbot/clawdbot.json into the active config path when none existed, and
// this file pinned that a failed copy surfaced. Paddy has no legacy state dirs, so Doctor never
// reads or copies that file and the copy-failure case has nothing left to exercise.
describe("doctor legacy config migration", () => {
  it("never copies a ~/.clawdbot/clawdbot.json into Paddy's config path", async () => {
    await withTempDir("openclaw-doctor-legacy-copy-", async (home) => {
      const legacyDir = path.join(home, ".clawdbot");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyPath = path.join(legacyDir, "clawdbot.json");
      await fs.writeFile(legacyPath, '{"gateway":{"mode":"local"}}\n', "utf-8");
      const targetPath = path.join(home, "state-root", "openclaw.json");
      setEnv({
        HOME: home,
        OPENCLAW_CONFIG_PATH: targetPath,
        OPENCLAW_STATE_DIR: path.join(home, "state"),
      });

      await runDoctorConfigPreflight({ migrateState: false, invalidConfigNote: false });

      await expect(fs.access(targetPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(fs.readFile(legacyPath, "utf-8")).resolves.toBe(
        '{"gateway":{"mode":"local"}}\n',
      );
    });
  });
});
