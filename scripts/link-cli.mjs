#!/usr/bin/env node
/**
 * Put `paddy` on PATH (~/.local/bin). Used by postinstall and the curl installer.
 * Never npx — the command is paddy.
 */
import { chmodSync, existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const kitRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(kitRoot, "bin", "paddy.mjs");
const win = process.platform === "win32";

export function linkCli() {
  const binDir = process.env.PADDY_BIN_DIR?.trim() || join(homedir(), ".local", "bin");
  const dest = join(binDir, win ? "paddy.cmd" : "paddy");
  if (!existsSync(cli)) {
    throw new Error(`missing ${cli}`);
  }
  mkdirSync(binDir, { recursive: true, mode: 0o755 });
  if (/["$`\n;&|<>%]/.test(cli) || /["$`\n;&|<>%]/.test(binDir)) {
    throw new Error("unsafe path for paddy wrapper");
  }
  if (win) {
    writeFileSync(dest, `@echo off\r\nnode "${cli}" %*\r\n`, { encoding: "utf8", mode: 0o755 });
  } else {
    writeFileSync(dest, `#!/usr/bin/env bash\nexport PATH="${binDir}:$PATH"\nexec node "${cli}" "$@"\n`, { encoding: "utf8", mode: 0o755 });
    chmodSync(dest, 0o755);
  }
  return { binDir, dest };
}

function pathHas(dir) {
  const path = process.env.PATH || process.env.Path || "";
  return path.split(win ? ";" : ":").includes(dir);
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return resolve(entry) === fileURLToPath(import.meta.url);
  }
}

if (isMain()) {
  try {
    const { binDir: dir, dest: file } = linkCli();
    console.log(`paddy → ${file}`);
    if (!pathHas(dir)) {
      if (win) {
        console.log(`Add ${dir} to your user PATH, then open a new terminal.`);
      } else {
        console.log(`If 'paddy' is not found:  export PATH="${dir}:$PATH"`);
      }
    }
  } catch (err) {
    console.warn(`paddy link skipped: ${err instanceof Error ? err.message : err}`);
    process.exitCode = 0;
  }
}
