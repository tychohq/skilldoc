import { describe, expect, it } from "bun:test";
import { readFileSync, existsSync, accessSync, constants, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(import.meta.dir, "..");
const pkgPath = path.join(ROOT, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

describe("package.json", () => {
  it("has a description", () => {
    expect(typeof pkg.description).toBe("string");
    expect(pkg.description.length).toBeGreaterThan(0);
  });

  it("has keywords array", () => {
    expect(Array.isArray(pkg.keywords)).toBe(true);
    expect(pkg.keywords.length).toBeGreaterThan(0);
  });

  it("has homepage", () => {
    expect(typeof pkg.homepage).toBe("string");
    expect(pkg.homepage).toMatch(/^https?:\/\//);
  });

  it("has repository with type and url", () => {
    expect(pkg.repository).toBeDefined();
    expect(pkg.repository.type).toBe("git");
    expect(pkg.repository.url).toMatch(/^git\+https?:\/\//);
  });

  it("has license", () => {
    expect(typeof pkg.license).toBe("string");
    expect(pkg.license.length).toBeGreaterThan(0);
  });
});

describe("npm publish readiness", () => {
  it("is not marked private", () => {
    expect(pkg.private).toBeUndefined();
  });

  it("has agent-tool-docs bin entry for npx", () => {
    expect(pkg.bin["agent-tool-docs"]).toBe("bin/tool-docs.js");
  });

  it("has tool-docs bin entry for short alias", () => {
    expect(pkg.bin["tool-docs"]).toBe("bin/tool-docs.js");
  });

  it("has files whitelist", () => {
    expect(Array.isArray(pkg.files)).toBe(true);
    expect(pkg.files).toContain("bin/tool-docs.js");
  });

  it("has engines field requiring node >= 18", () => {
    expect(pkg.engines).toBeDefined();
    expect(pkg.engines.node).toBe(">=18");
  });

  it("bin file exists and is executable", () => {
    const binPath = path.join(ROOT, pkg.bin["agent-tool-docs"]);
    expect(existsSync(binPath)).toBe(true);
    accessSync(binPath, constants.X_OK);
  });

  it("bin file has node shebang", () => {
    const binPath = path.join(ROOT, pkg.bin["agent-tool-docs"]);
    const firstLine = readFileSync(binPath, "utf8").split("\n")[0];
    expect(firstLine).toBe("#!/usr/bin/env node");
  });

  it("bin runs --help without errors", () => {
    const binPath = path.join(ROOT, pkg.bin["agent-tool-docs"]);
    const result = spawnSync("node", [binPath, "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("tool-docs");
  });

  it("bin runs --version and matches package.json", () => {
    const binPath = path.join(ROOT, pkg.bin["agent-tool-docs"]);
    const result = spawnSync("node", [binPath, "--version"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
  });

  it("LICENSE file exists", () => {
    expect(existsSync(path.join(ROOT, "LICENSE"))).toBe(true);
  });

  it("has no runtime dependencies (all bundled)", () => {
    const deps = Object.keys(pkg.dependencies ?? {});
    expect(deps).toEqual([]);
  });

  it("npm pack includes only expected files", () => {
    const npmCache = mkdtempSync(path.join(os.tmpdir(), "npm-cache-"));
    const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
      encoding: "utf8",
      cwd: ROOT,
      env: { ...process.env, npm_config_cache: npmCache },
    });
    rmSync(npmCache, { recursive: true, force: true });
    expect(result.status).toBe(0);
    const packInfo = JSON.parse(result.stdout);
    const filePaths = packInfo[0].files.map((f: { path: string }) => f.path);
    expect(filePaths).toContain("bin/tool-docs.js");
    expect(filePaths).toContain("package.json");
    expect(filePaths).toContain("README.md");
    expect(filePaths).toContain("LICENSE");
    // Source and test files should NOT be included
    for (const f of filePaths) {
      expect(f).not.toMatch(/^src\//);
      expect(f).not.toMatch(/^test\//);
    }
  });
});
