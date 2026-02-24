import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import path from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import { computeHash, getChangedTools, handleRefresh, computeSkillDiff } from "../src/cli.js";
import { type LockFile } from "../src/lock.js";

describe("computeHash", () => {
  it("returns a hex string", () => {
    const h = computeHash("hello");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the same hash for the same input", () => {
    expect(computeHash("abc")).toBe(computeHash("abc"));
  });

  it("returns different hashes for different inputs", () => {
    expect(computeHash("abc")).not.toBe(computeHash("xyz"));
  });
});

describe("getChangedTools", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `get-changed-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns all tools when no tool.json exists", async () => {
    const tools = [{ id: "mytool", binary: "mytool" }];
    const runFn = () => ({ output: "help text", exitCode: 0 as number | null });
    const changed = await getChangedTools(tools, tmpDir, runFn);
    expect(changed).toEqual(["mytool"]);
  });

  it("returns empty when help output has not changed", async () => {
    const helpOutput = "unchanged help text";
    const toolDir = path.join(tmpDir, "mytool");
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(
      path.join(toolDir, "tool.json"),
      JSON.stringify({ helpHash: computeHash(helpOutput) })
    );

    const tools = [{ id: "mytool", binary: "mytool" }];
    const runFn = () => ({ output: helpOutput, exitCode: 0 as number | null });
    const changed = await getChangedTools(tools, tmpDir, runFn);
    expect(changed).toEqual([]);
  });

  it("returns tool when help output has changed", async () => {
    const toolDir = path.join(tmpDir, "mytool");
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(
      path.join(toolDir, "tool.json"),
      JSON.stringify({ helpHash: computeHash("old output") })
    );

    const tools = [{ id: "mytool", binary: "mytool" }];
    const runFn = () => ({ output: "new output", exitCode: 0 as number | null });
    const changed = await getChangedTools(tools, tmpDir, runFn);
    expect(changed).toEqual(["mytool"]);
  });

  it("returns tool when tool.json has no helpHash field", async () => {
    const toolDir = path.join(tmpDir, "mytool");
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(path.join(toolDir, "tool.json"), JSON.stringify({ kind: "tool" }));

    const tools = [{ id: "mytool", binary: "mytool" }];
    const runFn = () => ({ output: "some help", exitCode: 0 as number | null });
    const changed = await getChangedTools(tools, tmpDir, runFn);
    expect(changed).toEqual(["mytool"]);
  });

  it("only returns tools whose help changed among multiple", async () => {
    const unchangedOutput = "stable help";
    const toolADir = path.join(tmpDir, "tool-a");
    mkdirSync(toolADir, { recursive: true });
    writeFileSync(
      path.join(toolADir, "tool.json"),
      JSON.stringify({ helpHash: computeHash(unchangedOutput) })
    );
    // tool-b has no stored hash

    const tools = [
      { id: "tool-a", binary: "tool-a" },
      { id: "tool-b", binary: "tool-b" },
    ];
    const runFn = () => ({ output: unchangedOutput, exitCode: 0 as number | null });
    const changed = await getChangedTools(tools, tmpDir, runFn);
    expect(changed).toEqual(["tool-b"]);
  });

  it("uses tool.helpArgs when provided", async () => {
    const capturedArgs: string[][] = [];
    const tools = [{ id: "mytool", binary: "mytool", helpArgs: ["-h", "--verbose"] }];
    const runFn = (binary: string, args: string[]) => {
      capturedArgs.push(args);
      return { output: "help", exitCode: 0 as number | null };
    };
    await getChangedTools(tools, tmpDir, runFn);
    expect(capturedArgs[0]).toEqual(["-h", "--verbose"]);
  });

  it("defaults to ['--help'] when helpArgs not provided", async () => {
    const capturedArgs: string[][] = [];
    const tools = [{ id: "mytool", binary: "mytool" }];
    const runFn = (_b: string, args: string[]) => {
      capturedArgs.push(args);
      return { output: "help", exitCode: 0 as number | null };
    };
    await getChangedTools(tools, tmpDir, runFn);
    expect(capturedArgs[0]).toEqual(["--help"]);
  });
});

describe("handleRefresh", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `handle-refresh-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeLockFn(tools: Array<{ id: string; binary: string; helpArgs?: string[] }>): (lockPath?: string) => Promise<LockFile> {
    return async () => ({
      skills: Object.fromEntries(
        tools.map((t) => [t.id, { cliName: t.binary, version: "1.0", helpHash: "h", source: "help", syncedAt: "2026-01-01", generator: "skilldoc" as const, helpArgs: t.helpArgs }])
      ),
    });
  }

  it("calls generate and distill when help output has changed", async () => {
    const generateCalls: Record<string, string | boolean>[] = [];
    const distillCalls: Record<string, string | boolean>[] = [];

    await handleRefresh(
      { out: tmpDir },
      {
        generateFn: async (f) => { generateCalls.push(f); },
        distillFn: async (f) => { distillCalls.push(f); },
        runFn: () => ({ output: "new help output", exitCode: 0 }),
        loadLockFn: makeLockFn([{ id: "mytool", binary: "mytool" }]),
      }
    );

    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0].only).toBe("mytool");
    expect(distillCalls).toHaveLength(1);
    expect(distillCalls[0].only).toBe("mytool");
  });

  it("does not call generate or distill when nothing has changed", async () => {
    const helpOutput = "stable help text";
    const toolDir = path.join(tmpDir, "mytool");
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(
      path.join(toolDir, "tool.json"),
      JSON.stringify({ helpHash: computeHash(helpOutput) })
    );

    const generateCalls: Record<string, string | boolean>[] = [];
    const distillCalls: Record<string, string | boolean>[] = [];

    await handleRefresh(
      { out: tmpDir },
      {
        generateFn: async (f) => { generateCalls.push(f); },
        distillFn: async (f) => { distillCalls.push(f); },
        runFn: () => ({ output: helpOutput, exitCode: 0 }),
        loadLockFn: makeLockFn([{ id: "mytool", binary: "mytool" }]),
      }
    );

    expect(generateCalls).toHaveLength(0);
    expect(distillCalls).toHaveLength(0);
  });

  it("filters tools by --only flag", async () => {
    const checkedBinaries: string[] = [];
    const generateCalls: Record<string, string | boolean>[] = [];

    await handleRefresh(
      { out: tmpDir, only: "tool-a" },
      {
        generateFn: async (f) => { generateCalls.push(f); },
        distillFn: async () => {},
        runFn: (binary) => {
          checkedBinaries.push(binary);
          return { output: "help", exitCode: 0 };
        },
        loadLockFn: makeLockFn([{ id: "tool-a", binary: "tool-a" }, { id: "tool-b", binary: "tool-b" }]),
      }
    );

    // Only tool-a should have been checked
    expect(checkedBinaries).toEqual(["tool-a"]);
    // tool-a has no stored hash → changed
    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0].only).toBe("tool-a");
  });

  it("only passes changed tool ids to generate and distill", async () => {
    const unchangedOutput = "stable help";
    const toolADir = path.join(tmpDir, "tool-a");
    mkdirSync(toolADir, { recursive: true });
    writeFileSync(
      path.join(toolADir, "tool.json"),
      JSON.stringify({ helpHash: computeHash(unchangedOutput) })
    );
    // tool-b has no stored hash → changed

    const generateCalls: Record<string, string | boolean>[] = [];

    await handleRefresh(
      { out: tmpDir },
      {
        generateFn: async (f) => { generateCalls.push(f); },
        distillFn: async () => {},
        runFn: () => ({ output: unchangedOutput, exitCode: 0 }),
        loadLockFn: makeLockFn([{ id: "tool-a", binary: "tool-a" }, { id: "tool-b", binary: "tool-b" }]),
      }
    );

    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0].only).toBe("tool-b");
  });

  it("passes other flags through to generate and distill", async () => {
    const generateCalls: Record<string, string | boolean>[] = [];
    const distillCalls: Record<string, string | boolean>[] = [];

    await handleRefresh(
      { out: tmpDir, model: "claude-opus-4-6" },
      {
        generateFn: async (f) => { generateCalls.push(f); },
        distillFn: async (f) => { distillCalls.push(f); },
        runFn: () => ({ output: "help", exitCode: 0 }),
        loadLockFn: makeLockFn([{ id: "mytool", binary: "mytool" }]),
      }
    );

    expect(generateCalls[0].model).toBe("claude-opus-4-6");
    expect(distillCalls[0].model).toBe("claude-opus-4-6");
  });
});

describe("computeSkillDiff", () => {
  it("returns empty string when contents are identical", () => {
    const content = "# SKILL\nsome text\n";
    const result = computeSkillDiff(content, content, "mytool/SKILL.md");
    expect(result).toBe("");
  });

  it("returns a diff string when contents differ", () => {
    const result = computeSkillDiff("old line\n", "new line\n", "mytool/SKILL.md");
    expect(result).toContain("-old line");
    expect(result).toContain("+new line");
  });

  it("includes the label in the diff header", () => {
    const result = computeSkillDiff("a\n", "b\n", "rg/SKILL.md");
    expect(result).toContain("a/rg/SKILL.md");
    expect(result).toContain("b/rg/SKILL.md");
  });
});

describe("handleRefresh --diff", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `handle-refresh-diff-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeLockFn(tools: Array<{ id: string; binary: string }>): (lockPath?: string) => Promise<LockFile> {
    return async () => ({
      skills: Object.fromEntries(
        tools.map((t) => [t.id, { cliName: t.binary, version: "1.0", helpHash: "h", source: "help", syncedAt: "2026-01-01", generator: "skilldoc" as const }])
      ),
    });
  }

  it("calls diffFn with before/after content when --diff is set", async () => {
    const diffCalls: Array<{ old: string; after: string; label: string }> = [];

    const skillFiles: Record<string, string> = {
      [path.join(tmpDir, "mytool", "SKILL.md")]: "# Old Skill\n",
    };

    await handleRefresh(
      { out: tmpDir, diff: true },
      {
        generateFn: async () => {},
        distillFn: async () => {
          skillFiles[path.join(tmpDir, "mytool", "SKILL.md")] = "# New Skill\n";
        },
        runFn: () => ({ output: "new help", exitCode: 0 }),
        readFileFn: async (p) => skillFiles[p] ?? null,
        diffFn: (oldContent, newContent, label) => {
          diffCalls.push({ old: oldContent, after: newContent, label });
          return `--- ${label}\n+++ ${label}\n-old\n+new\n`;
        },
        loadLockFn: makeLockFn([{ id: "mytool", binary: "mytool" }]),
      }
    );

    expect(diffCalls).toHaveLength(1);
    expect(diffCalls[0].old).toBe("# Old Skill\n");
    expect(diffCalls[0].after).toBe("# New Skill\n");
    expect(diffCalls[0].label).toBe("mytool/SKILL.md");
  });

  it("prints 'unchanged' message when skill content did not change", async () => {
    const diffCalls: unknown[] = [];
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));

    try {
      await handleRefresh(
        { out: tmpDir, diff: true },
        {
          generateFn: async () => {},
          distillFn: async () => {},
          runFn: () => ({ output: "new help", exitCode: 0 }),
          readFileFn: async () => "# Same Skill\n",
          diffFn: (oldContent, newContent, label) => {
            diffCalls.push({ oldContent, newContent, label });
            return "";
          },
          loadLockFn: makeLockFn([{ id: "mytool", binary: "mytool" }]),
        }
      );
    } finally {
      console.log = originalLog;
    }

    expect(diffCalls).toHaveLength(0);
    expect(logs.some((l) => l.includes("unchanged"))).toBe(true);
  });

  it("does not call diffFn when --diff flag is not set", async () => {
    const diffCalls: unknown[] = [];

    await handleRefresh(
      { out: tmpDir },
      {
        generateFn: async () => {},
        distillFn: async () => {},
        runFn: () => ({ output: "new help", exitCode: 0 }),
        readFileFn: async () => "# Skill\n",
        diffFn: (...args) => {
          diffCalls.push(args);
          return "";
        },
        loadLockFn: makeLockFn([{ id: "mytool", binary: "mytool" }]),
      }
    );

    expect(diffCalls).toHaveLength(0);
  });

  it("reads before state for all changed tools before distilling", async () => {
    const readCalls: string[] = [];
    const distillCalled: boolean[] = [];

    await handleRefresh(
      { out: tmpDir, diff: true },
      {
        generateFn: async () => {},
        distillFn: async () => { distillCalled.push(true); },
        runFn: () => ({ output: "new help", exitCode: 0 }),
        readFileFn: async (p) => {
          readCalls.push(p);
          return null;
        },
        diffFn: () => "",
        loadLockFn: makeLockFn([{ id: "tool-a", binary: "tool-a" }, { id: "tool-b", binary: "tool-b" }]),
      }
    );

    // Both tools should have been read before distill, then again after
    expect(readCalls.length).toBe(4);
    expect(distillCalled).toHaveLength(1);
    // First two reads (before) should come before distill call
  });
});
