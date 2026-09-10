#!/usr/bin/env node
import { mkdirSync, rmSync, cpSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const root = join(import.meta.dirname, "..");
const staging = join(root, ".grok", "paddy-selfhost");
const zipPath = join(root, "public", "paddy-selfhost.zip");

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

const copies = [
  "bin",
  "src",
  "scripts",
  "server",
  "migrations",
  "docs",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "eslint.config.mjs",
  "LICENSE",
  "README.md",
  "SELFHOST.md",
  "selfhost.env.example",
  "install.sh",
  "install.ps1",
  ".gitignore",
];

for (const rel of copies) {
  const from = join(root, rel);
  if (!existsSync(from)) continue;
  cpSync(from, join(staging, rel), { recursive: true });
}

mkdirSync(join(staging, "public"), { recursive: true });
for (const f of ["favicon.svg", "og.jpg", "paddy-icon.jpg", "paddy.jpg", "install.sh", "install.ps1"]) {
  const from = join(root, "public", f);
  if (existsSync(from)) cpSync(from, join(staging, "public", f));
}

const pkgPath = join(staging, "package.json");
if (existsSync(pkgPath)) {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.name = "paddy";
  pkg.description = "Paddy — Irish-roots super harness. CLI: paddy gateway";
  pkg.bin = { paddy: "./bin/paddy.mjs" };
  pkg.repository = { type: "git", url: "git+https://github.com/coruairc/paddy.git" };
  pkg.homepage = "https://github.com/coruairc/paddy";
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

mkdirSync(join(staging, ".grok"), { recursive: true });
const appEnv = join(root, ".grok", "app-env.json");
if (existsSync(appEnv)) cpSync(appEnv, join(staging, ".grok", "app-env.json"));

rmSync(zipPath, { force: true });
execFileSync("python3", ["-c", `
import pathlib, zipfile
root = pathlib.Path(${JSON.stringify(staging)})
out = pathlib.Path(${JSON.stringify(zipPath)})
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for p in root.rglob("*"):
        if p.is_file():
            z.write(p, p.relative_to(root))
print("wrote", out, "bytes", out.stat().st_size)
`]);
rmSync(staging, { recursive: true, force: true });
