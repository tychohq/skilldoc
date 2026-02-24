import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const CLI = path.resolve(import.meta.dir, "../bin/skilldoc.js");

function run(args: string[], opts: { timeout?: number } = {}): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    timeout: opts.timeout ?? 60_000,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? null,
  };
}

// ---------------------------------------------------------------------------
// Task 1: generate jq
// ---------------------------------------------------------------------------

describe("e2e: skilldoc generate jq", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `e2e-generate-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("produces tool.json and tool.md with real parsed content", () => {
    const result = run(["generate", "jq", "--out", tmpDir]);
    expect(result.status).toBe(0);

    const toolJsonPath = path.join(tmpDir, "jq", "tool.json");
    const toolMdPath = path.join(tmpDir, "jq", "tool.md");

    expect(existsSync(toolJsonPath)).toBe(true);
    expect(existsSync(toolMdPath)).toBe(true);

    const doc = JSON.parse(readFileSync(toolJsonPath, "utf8")) as Record<string, unknown>;
    expect(doc.kind).toBe("tool");
    expect(doc.id).toBe("jq");
    expect(doc.binary).toBe("jq");
    // jq has real options (-r, -c, -n, etc.)
    expect(Array.isArray(doc.options) && (doc.options as unknown[]).length).toBeGreaterThan(0);
    // helpHash is a SHA-256 hex string
    expect(typeof doc.helpHash === "string" && (doc.helpHash as string).length).toBe(64);

    const toolMd = readFileSync(toolMdPath, "utf8");
    expect(toolMd).toContain("jq");
  });
});

// ---------------------------------------------------------------------------
// Task 1: list and remove via pre-populated lock file
// ---------------------------------------------------------------------------

describe("e2e: skilldoc list and remove", () => {
  let tmpDir: string;
  let tmpLock: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `e2e-list-remove-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    tmpLock = path.join(tmpDir, "lock.yaml");

    // Simulate what 'skilldoc add jq' would have written to the lock
    writeFileSync(tmpLock, [
      "skills:",
      "  jq:",
      "    cliName: jq",
      '    version: "1.6"',
      "    helpHash: placeholder",
      "    source: help",
      '    syncedAt: "2026-01-01"',
      "    generator: skilldoc",
    ].join("\n") + "\n", "utf8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("list shows jq from the lock file", () => {
    const result = run(["list", "--lock", tmpLock]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("jq");
  });

  it("remove jq clears it from the lock file", () => {
    const removeResult = run(["remove", "jq", "--lock", tmpLock]);
    expect(removeResult.status).toBe(0);

    // After remove, list should show nothing
    const listResult = run(["list", "--lock", tmpLock]);
    expect(listResult.status).toBe(0);
    expect(listResult.stdout).toContain("No skills installed");
  });

  it("list after remove shows no skills", () => {
    run(["remove", "jq", "--lock", tmpLock]);
    const result = run(["list", "--lock", tmpLock]);
    expect(result.stdout).toContain("No skills installed");
  });
});

// ---------------------------------------------------------------------------
// Task 1: batch generate from lock file
// ---------------------------------------------------------------------------

describe("e2e: batch skilldoc generate from lock file", () => {
  let tmpDir: string;
  let tmpLock: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `e2e-batch-generate-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    tmpLock = path.join(tmpDir, "lock.yaml");

    writeFileSync(tmpLock, [
      "skills:",
      "  jq:",
      "    cliName: jq",
      '    version: "1.6"',
      "    helpHash: placeholder",
      "    source: help",
      '    syncedAt: "2026-01-01"',
      "    generator: skilldoc",
      "  curl:",
      "    cliName: curl",
      '    version: "7.x"',
      "    helpHash: placeholder",
      "    source: help",
      '    syncedAt: "2026-01-01"',
      "    generator: skilldoc",
    ].join("\n") + "\n", "utf8");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates docs for all tools in the lock file", () => {
    const result = run(["generate", "--lock", tmpLock, "--out", tmpDir]);
    expect(result.status).toBe(0);

    expect(existsSync(path.join(tmpDir, "jq", "tool.json"))).toBe(true);
    expect(existsSync(path.join(tmpDir, "curl", "tool.json"))).toBe(true);

    const jqDoc = JSON.parse(readFileSync(path.join(tmpDir, "jq", "tool.json"), "utf8")) as Record<string, unknown>;
    const curlDoc = JSON.parse(readFileSync(path.join(tmpDir, "curl", "tool.json"), "utf8")) as Record<string, unknown>;

    expect(jqDoc.id).toBe("jq");
    expect(curlDoc.id).toBe("curl");

    // Both tools have real options
    expect(Array.isArray(jqDoc.options) && (jqDoc.options as unknown[]).length).toBeGreaterThan(0);
    expect(Array.isArray(curlDoc.options) && (curlDoc.options as unknown[]).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Task 2: aws help detection fallback
// ---------------------------------------------------------------------------

const awsBin = spawnSync("which", ["aws"]).stdout?.toString().trim() ?? "";

describe.skipIf(!awsBin)("e2e: aws help detection fallback", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `e2e-aws-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects 'help' as helpArgs and produces real subcommands (s3, ec2, etc)", () => {
    const result = run(["generate", "aws", "--out", tmpDir], { timeout: 120_000 });
    expect(result.status).toBe(0);

    const toolJsonPath = path.join(tmpDir, "aws", "tool.json");
    expect(existsSync(toolJsonPath)).toBe(true);

    const doc = JSON.parse(readFileSync(toolJsonPath, "utf8")) as Record<string, unknown>;

    // The fallback detection should have chosen 'help' over '--help'
    expect(doc.helpArgs).toEqual(["help"]);

    // aws help lists dozens of services: s3, ec2, lambda, etc.
    const commands = doc.commands as Array<{ name: string }>;
    expect(commands.length).toBeGreaterThan(5);
    const names = commands.map((c) => c.name);
    expect(names).toContain("s3");
    expect(names).toContain("ec2");
  }, 120_000);
});
