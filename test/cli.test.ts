import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import path from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { parseFlags, extractPositionalArgs, handleAutoRedist, handleGenerate, handleDistill, handleRun, handleRunBatch, resolveBinary, lookupRegistryTool, type RunDeps, type RunBatchDeps, type RunResult } from "../src/cli.js";
import { DEFAULT_MODEL, DEFAULT_SKILLS_DIR, DistillOptions, DistillResult } from "../src/distill.js";
import { DEFAULT_VALIDATION_MODELS, type MultiModelValidationReport } from "../src/validate.js";

describe("parseFlags --out", () => {
  it("returns the specified path when --out is provided", () => {
    const flags = parseFlags(["--out", "/tmp/my-skills"]);
    expect(flags.out).toBe("/tmp/my-skills");
  });

  it("returns undefined for out when --out is not provided", () => {
    const flags = parseFlags(["--registry", "/some/path"]);
    expect(flags.out).toBeUndefined();
  });

  it("accepts any path string value", () => {
    const flags = parseFlags(["--out", "~/.agents/skills"]);
    expect(flags.out).toBe("~/.agents/skills");
  });

  it("throws when --out flag has no value", () => {
    expect(() => parseFlags(["--out"])).toThrow("Missing value for --out");
  });

  it("throws when --out value looks like another flag", () => {
    expect(() => parseFlags(["--out", "--registry"])).toThrow("Missing value for --out");
  });

  it("parses --out alongside other flags", () => {
    const flags = parseFlags(["--out", "/tmp/out", "--only", "rg,git", "--model", "claude-sonnet-4-6"]);
    expect(flags.out).toBe("/tmp/out");
    expect(flags.only).toBe("rg,git");
    expect(flags.model).toBe("claude-sonnet-4-6");
  });

  it("DEFAULT_SKILLS_DIR is ~/.agents/skills", () => {
    expect(DEFAULT_SKILLS_DIR).toBe("~/.agents/skills");
  });
});

describe("parseFlags --model", () => {
  it("returns the specified model when --model is provided", () => {
    const flags = parseFlags(["--model", "claude-opus-4-6"]);
    expect(flags.model).toBe("claude-opus-4-6");
  });

  it("returns undefined for model when --model is not provided", () => {
    const flags = parseFlags(["--registry", "/some/path"]);
    expect(flags.model).toBeUndefined();
  });

  it("accepts any model string value", () => {
    const flags = parseFlags(["--model", "claude-haiku-4-5-20251001"]);
    expect(flags.model).toBe("claude-haiku-4-5-20251001");
  });

  it("throws when --model flag has no value", () => {
    expect(() => parseFlags(["--model"])).toThrow("Missing value for --model");
  });

  it("throws when --model value looks like another flag", () => {
    expect(() => parseFlags(["--model", "--out"])).toThrow("Missing value for --model");
  });

  it("parses --model alongside other flags", () => {
    const flags = parseFlags(["--model", "claude-sonnet-4-6", "--only", "rg,git", "--out", "/tmp/out"]);
    expect(flags.model).toBe("claude-sonnet-4-6");
    expect(flags.only).toBe("rg,git");
    expect(flags.out).toBe("/tmp/out");
  });

  it("DEFAULT_MODEL is a non-empty string used as fallback", () => {
    expect(typeof DEFAULT_MODEL).toBe("string");
    expect(DEFAULT_MODEL.length).toBeGreaterThan(0);
  });
});

describe("parseFlags --models", () => {
  it("returns the specified models string when --models is provided", () => {
    const flags = parseFlags(["--models", "claude-sonnet-4-6,claude-opus-4-6"]);
    expect(flags.models).toBe("claude-sonnet-4-6,claude-opus-4-6");
  });

  it("returns undefined for models when --models is not provided", () => {
    const flags = parseFlags(["--registry", "/some/path"]);
    expect(flags.models).toBeUndefined();
  });

  it("accepts a single model", () => {
    const flags = parseFlags(["--models", "claude-haiku-4-5-20251001"]);
    expect(flags.models).toBe("claude-haiku-4-5-20251001");
  });

  it("throws when --models flag has no value", () => {
    expect(() => parseFlags(["--models"])).toThrow("Missing value for --models");
  });

  it("throws when --models value looks like another flag", () => {
    expect(() => parseFlags(["--models", "--skills"])).toThrow("Missing value for --models");
  });

  it("parses --models alongside other flags", () => {
    const flags = parseFlags(["--models", "model-a,model-b", "--threshold", "8"]);
    expect(flags.models).toBe("model-a,model-b");
    expect(flags.threshold).toBe("8");
  });

  it("DEFAULT_VALIDATION_MODELS contains at least 2 Claude models", () => {
    expect(DEFAULT_VALIDATION_MODELS.length).toBeGreaterThanOrEqual(2);
    expect(DEFAULT_VALIDATION_MODELS.every((m) => m.startsWith("claude-"))).toBe(true);
  });
});

describe("parseFlags --auto-redist", () => {
  it("returns true when --auto-redist is provided", () => {
    const flags = parseFlags(["--auto-redist"]);
    expect(flags["auto-redist"]).toBe(true);
  });

  it("returns undefined when --auto-redist is not provided", () => {
    const flags = parseFlags(["--model", "claude-sonnet-4-6"]);
    expect(flags["auto-redist"]).toBeUndefined();
  });

  it("parses --auto-redist alongside other flags", () => {
    const flags = parseFlags(["--auto-redist", "--threshold", "8", "--models", "claude-sonnet-4-6"]);
    expect(flags["auto-redist"]).toBe(true);
    expect(flags.threshold).toBe("8");
    expect(flags.models).toBe("claude-sonnet-4-6");
  });
});

describe("handleAutoRedist", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `auto-redist-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeRegistry(toolId: string, binary: string): string {
    const registryPath = path.join(tmpDir, "registry.yaml");
    writeFileSync(registryPath, `version: 1\ntools:\n  - id: ${toolId}\n    binary: ${binary}\n`);
    return registryPath;
  }

  function makeDistillFn(captured: DistillOptions[]): (opts: DistillOptions) => Promise<DistillResult> {
    return async (opts) => {
      captured.push(opts);
      return { toolId: opts.toolId, outDir: opts.outDir };
    };
  }

  it("calls distillFn with the feedback when tool is found in registry", async () => {
    const registryPath = writeRegistry("mytool", "mytool-bin");
    const captured: DistillOptions[] = [];
    await handleAutoRedist("mytool", "agents needed --count flag", { registry: registryPath }, makeDistillFn(captured));
    expect(captured).toHaveLength(1);
    expect(captured[0].feedback).toBe("agents needed --count flag");
    expect(captured[0].toolId).toBe("mytool");
    expect(captured[0].binary).toBe("mytool-bin");
  });

  it("uses the tool binary from the registry", async () => {
    const registryPath = writeRegistry("rg", "rg-binary");
    const captured: DistillOptions[] = [];
    await handleAutoRedist("rg", "feedback text", { registry: registryPath }, makeDistillFn(captured));
    expect(captured[0].binary).toBe("rg-binary");
  });

  it("uses model from flags when provided", async () => {
    const registryPath = writeRegistry("mytool", "mytool");
    const captured: DistillOptions[] = [];
    await handleAutoRedist("mytool", "feedback", { registry: registryPath, model: "claude-opus-4-6" }, makeDistillFn(captured));
    expect(captured[0].model).toBe("claude-opus-4-6");
  });

  it("uses DEFAULT_MODEL when model flag is not provided", async () => {
    const registryPath = writeRegistry("mytool", "mytool");
    const captured: DistillOptions[] = [];
    await handleAutoRedist("mytool", "feedback", { registry: registryPath }, makeDistillFn(captured));
    expect(captured[0].model).toBe(DEFAULT_MODEL);
  });

  it("does not call distillFn when tool is not found in registry", async () => {
    const registryPath = writeRegistry("othertool", "othertool");
    const captured: DistillOptions[] = [];
    await handleAutoRedist("notexist", "feedback", { registry: registryPath }, makeDistillFn(captured));
    expect(captured).toHaveLength(0);
  });

  it("resolves without throwing when tool is not found in registry", async () => {
    const registryPath = writeRegistry("othertool", "othertool");
    await expect(
      handleAutoRedist("notexist", "feedback", { registry: registryPath }, makeDistillFn([]))
    ).resolves.toBeUndefined();
  });

  it("resolves without throwing when distillFn throws", async () => {
    const registryPath = writeRegistry("mytool", "mytool");
    const failDistill = async () => { throw new Error("LLM failed"); };
    await expect(
      handleAutoRedist("mytool", "feedback", { registry: registryPath }, failDistill)
    ).resolves.toBeUndefined();
  });

  it("logs skipped message when distillFn returns skipped result", async () => {
    const registryPath = writeRegistry("mytool", "mytool");
    const skipDistill = async (opts: DistillOptions): Promise<DistillResult> => ({
      toolId: opts.toolId,
      outDir: opts.outDir,
      skipped: true,
      skipReason: "hand-written skill",
    });
    await expect(
      handleAutoRedist("mytool", "feedback", { registry: registryPath }, skipDistill)
    ).resolves.toBeUndefined();
  });
});

describe("parseFlags --distill-config", () => {
  it("returns the specified path when --distill-config is provided", () => {
    const flags = parseFlags(["--distill-config", "/tmp/my-distill-config.yaml"]);
    expect(flags["distill-config"]).toBe("/tmp/my-distill-config.yaml");
  });

  it("returns undefined for distill-config when not provided", () => {
    const flags = parseFlags(["--model", "claude-haiku-4-5-20251001"]);
    expect(flags["distill-config"]).toBeUndefined();
  });

  it("throws when --distill-config has no value", () => {
    expect(() => parseFlags(["--distill-config"])).toThrow("Missing value for --distill-config");
  });

  it("throws when --distill-config value looks like another flag", () => {
    expect(() => parseFlags(["--distill-config", "--model"])).toThrow("Missing value for --distill-config");
  });

  it("parses --distill-config alongside other flags", () => {
    const flags = parseFlags(["--distill-config", "/tmp/cfg.yaml", "--model", "claude-haiku-4-5-20251001", "--only", "rg"]);
    expect(flags["distill-config"]).toBe("/tmp/cfg.yaml");
    expect(flags.model).toBe("claude-haiku-4-5-20251001");
    expect(flags.only).toBe("rg");
  });
});

describe("extractPositionalArgs", () => {
  it("returns empty array when no positional args", () => {
    expect(extractPositionalArgs(["--out", "/tmp"])).toEqual([]);
  });

  it("extracts a single positional arg", () => {
    expect(extractPositionalArgs(["jq"])).toEqual(["jq"]);
  });

  it("extracts positional arg before flags", () => {
    expect(extractPositionalArgs(["jq", "--out", "/tmp"])).toEqual(["jq"]);
  });

  it("extracts positional arg after flags", () => {
    expect(extractPositionalArgs(["--out", "/tmp", "jq"])).toEqual(["jq"]);
  });

  it("skips value-flag arguments (does not treat flag value as positional)", () => {
    expect(extractPositionalArgs(["--registry", "/some/path", "jq"])).toEqual(["jq"]);
  });

  it("handles boolean flags correctly", () => {
    expect(extractPositionalArgs(["--force", "jq"])).toEqual(["jq"]);
  });

  it("handles multiple value flags interleaved with positional", () => {
    expect(extractPositionalArgs(["--out", "/tmp", "jq", "--only", "rg"])).toEqual(["jq"]);
  });

  it("returns empty array for flags only", () => {
    expect(extractPositionalArgs(["--registry", "/path", "--only", "rg,git"])).toEqual([]);
  });
});

describe("handleGenerate with binary name", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `generate-binary-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates docs for a single binary without a registry", async () => {
    await handleGenerate({ out: tmpDir }, "echo");
    const toolJson = path.join(tmpDir, "echo", "tool.json");
    expect(existsSync(toolJson)).toBe(true);
    const doc = JSON.parse(readFileSync(toolJson, "utf8"));
    expect(doc.kind).toBe("tool");
    expect(doc.id).toBe("echo");
    expect(doc.binary).toBe("echo");
  });

  it("creates tool.md for an ad-hoc binary", async () => {
    await handleGenerate({ out: tmpDir }, "echo");
    const toolMd = path.join(tmpDir, "echo", "tool.md");
    expect(existsSync(toolMd)).toBe(true);
  });

  it("creates tool.yaml for an ad-hoc binary", async () => {
    await handleGenerate({ out: tmpDir }, "echo");
    const toolYaml = path.join(tmpDir, "echo", "tool.yaml");
    expect(existsSync(toolYaml)).toBe(true);
  });

  it("creates index.md listing the ad-hoc binary", async () => {
    await handleGenerate({ out: tmpDir }, "echo");
    const indexMd = path.join(tmpDir, "index.md");
    expect(existsSync(indexMd)).toBe(true);
    const content = readFileSync(indexMd, "utf8");
    expect(content).toContain("echo");
  });

  it("uses --help as default helpArgs for ad-hoc binary", async () => {
    const noRegistry = path.join(tmpDir, "no-registry.yaml");
    await handleGenerate({ out: tmpDir, registry: noRegistry }, "jq");
    const toolJson = path.join(tmpDir, "jq", "tool.json");
    const doc = JSON.parse(readFileSync(toolJson, "utf8"));
    expect(doc.helpArgs).toEqual(["--help"]);
  });

  it("sets displayName to binary name for ad-hoc binary", async () => {
    const noRegistry = path.join(tmpDir, "no-registry.yaml");
    await handleGenerate({ out: tmpDir, registry: noRegistry }, "echo");
    const toolJson = path.join(tmpDir, "echo", "tool.json");
    const doc = JSON.parse(readFileSync(toolJson, "utf8"));
    expect(doc.displayName).toBe("echo");
  });

  it("produces a complete ToolDoc with all required fields", async () => {
    const noRegistry = path.join(tmpDir, "no-registry.yaml");
    await handleGenerate({ out: tmpDir, registry: noRegistry }, "jq");
    const toolJson = path.join(tmpDir, "jq", "tool.json");
    const doc = JSON.parse(readFileSync(toolJson, "utf8"));
    expect(doc.kind).toBe("tool");
    expect(doc.id).toBe("jq");
    expect(doc.binary).toBe("jq");
    expect(doc.displayName).toBe("jq");
    expect(doc.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(doc.helpArgs).toEqual(["--help"]);
    expect(typeof doc.helpExitCode).toBe("number");
    expect(typeof doc.helpHash).toBe("string");
    expect(doc.helpHash.length).toBe(64); // sha256 hex
    expect(doc.usage).toBeDefined();
    expect(Array.isArray(doc.commands)).toBe(true);
    expect(Array.isArray(doc.options)).toBe(true);
    expect(Array.isArray(doc.examples)).toBe(true);
    expect(Array.isArray(doc.env)).toBe(true);
    expect(Array.isArray(doc.warnings)).toBe(true);
  });

  it("generates non-empty parsed content for a real binary", async () => {
    await handleGenerate({ out: tmpDir }, "jq");
    const toolJson = path.join(tmpDir, "jq", "tool.json");
    const doc = JSON.parse(readFileSync(toolJson, "utf8"));
    expect(doc.options.length).toBeGreaterThan(0);
  });

  it("produces valid YAML matching the JSON output", async () => {
    const YAML = await import("yaml");
    await handleGenerate({ out: tmpDir }, "echo");
    const jsonDoc = JSON.parse(readFileSync(path.join(tmpDir, "echo", "tool.json"), "utf8"));
    const yamlDoc = YAML.parse(readFileSync(path.join(tmpDir, "echo", "tool.yaml"), "utf8"));
    expect(yamlDoc.id).toBe(jsonDoc.id);
    expect(yamlDoc.binary).toBe(jsonDoc.binary);
    expect(yamlDoc.kind).toBe(jsonDoc.kind);
  });

  it("produces non-empty markdown for tool.md", async () => {
    await handleGenerate({ out: tmpDir }, "jq");
    const content = readFileSync(path.join(tmpDir, "jq", "tool.md"), "utf8");
    expect(content).toContain("# jq");
    expect(content.length).toBeGreaterThan(100);
  });

  it("generates only the specified tool (no extra directories)", async () => {
    await handleGenerate({ out: tmpDir }, "echo");
    const { readdirSync } = await import("node:fs");
    const entries = readdirSync(tmpDir).filter((e) => e !== "index.md");
    expect(entries).toEqual(["echo"]);
  });
});

describe("resolveBinary", () => {
  it("returns the full path for a binary on PATH", () => {
    const resolved = resolveBinary("echo");
    expect(resolved).not.toBeNull();
    expect(resolved!.length).toBeGreaterThan(0);
    expect(resolved!.startsWith("/")).toBe(true);
  });

  it("returns null for a binary not on PATH", () => {
    expect(resolveBinary("nonexistent-binary-xyz-12345")).toBeNull();
  });
});

describe("lookupRegistryTool", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `lookup-registry-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeRegistryFile(yaml: string): string {
    const registryPath = path.join(tmpDir, "registry.yaml");
    writeFileSync(registryPath, yaml);
    return registryPath;
  }

  it("returns the registry entry when tool id matches", async () => {
    const registryPath = writeRegistryFile(`version: 1\ntools:\n  - id: curl\n    binary: curl\n    helpArgs: ["--help", "all"]\n    displayName: cURL\n`);
    const tool = await lookupRegistryTool(registryPath, "curl");
    expect(tool).not.toBeNull();
    expect(tool!.helpArgs).toEqual(["--help", "all"]);
    expect(tool!.displayName).toBe("cURL");
  });

  it("returns the registry entry when binary matches but id differs", async () => {
    const registryPath = writeRegistryFile(`version: 1\ntools:\n  - id: ripgrep\n    binary: rg\n    helpArgs: ["--help"]\n`);
    const tool = await lookupRegistryTool(registryPath, "rg");
    expect(tool).not.toBeNull();
    expect(tool!.id).toBe("ripgrep");
  });

  it("returns null when no tool matches", async () => {
    const registryPath = writeRegistryFile(`version: 1\ntools:\n  - id: jq\n    binary: jq\n`);
    const tool = await lookupRegistryTool(registryPath, "curl");
    expect(tool).toBeNull();
  });

  it("returns null when registry file does not exist", async () => {
    const tool = await lookupRegistryTool(path.join(tmpDir, "nonexistent.yaml"), "curl");
    expect(tool).toBeNull();
  });
});

describe("handleGenerate registry precedence", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `generate-registry-prec-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uses registry helpArgs when positional arg matches a registry tool", async () => {
    const registryPath = path.join(tmpDir, "registry.yaml");
    writeFileSync(registryPath, `version: 1\ntools:\n  - id: git\n    binary: git\n    helpArgs: ["-h"]\n    displayName: Git\n    commandHelpArgs: ["help", "{command}"]\n`);
    const outDir = path.join(tmpDir, "out");
    mkdirSync(outDir, { recursive: true });
    await handleGenerate({ out: outDir, registry: registryPath }, "git");
    const doc = JSON.parse(readFileSync(path.join(outDir, "git", "tool.json"), "utf8"));
    expect(doc.helpArgs).toEqual(["-h"]);
    expect(doc.displayName).toBe("Git");
  });

  it("falls back to createToolEntry defaults when binary is not in registry", async () => {
    const registryPath = path.join(tmpDir, "registry.yaml");
    writeFileSync(registryPath, `version: 1\ntools:\n  - id: git\n    binary: git\n    helpArgs: ["-h"]\n`);
    const outDir = path.join(tmpDir, "out");
    mkdirSync(outDir, { recursive: true });
    await handleGenerate({ out: outDir, registry: registryPath }, "echo");
    const doc = JSON.parse(readFileSync(path.join(outDir, "echo", "tool.json"), "utf8"));
    expect(doc.helpArgs).toEqual(["--help"]);
    expect(doc.displayName).toBe("echo");
  });

  it("falls back to defaults when registry does not exist", async () => {
    const outDir = path.join(tmpDir, "out");
    mkdirSync(outDir, { recursive: true });
    await handleGenerate({ out: outDir, registry: path.join(tmpDir, "nonexistent.yaml") }, "echo");
    const doc = JSON.parse(readFileSync(path.join(outDir, "echo", "tool.json"), "utf8"));
    expect(doc.helpArgs).toEqual(["--help"]);
  });

  it("generates command docs when registry entry has commandHelpArgs", async () => {
    const registryPath = path.join(tmpDir, "registry.yaml");
    writeFileSync(registryPath, `version: 1\ntools:\n  - id: git\n    binary: git\n    helpArgs: ["-h"]\n    commandHelpArgs: ["help", "{command}"]\n`);
    const outDir = path.join(tmpDir, "out");
    mkdirSync(outDir, { recursive: true });
    await handleGenerate({ out: outDir, registry: registryPath }, "git");
    const doc = JSON.parse(readFileSync(path.join(outDir, "git", "tool.json"), "utf8"));
    // git -h lists commands, and commandHelpArgs should trigger command doc generation
    expect(existsSync(path.join(outDir, "git", "commands"))).toBe(true);
  });
});

describe("handleGenerate --only (batch registry)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `generate-only-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeRegistryFile(tools: Array<{ id: string; binary: string }>): string {
    const registryPath = path.join(tmpDir, "registry.yaml");
    const toolsYaml = tools
      .map((t) => `  - id: "${t.id}"\n    binary: "${t.binary}"`)
      .join("\n");
    writeFileSync(registryPath, `version: 1\ntools:\n${toolsYaml}\n`);
    return registryPath;
  }

  it("generates only the tool specified by --only", async () => {
    const registryPath = writeRegistryFile([
      { id: "echo", binary: "echo" },
      { id: "ls", binary: "ls" },
    ]);
    const outDir = path.join(tmpDir, "out");
    mkdirSync(outDir, { recursive: true });

    await handleGenerate({ out: outDir, registry: registryPath, only: "echo" });

    expect(existsSync(path.join(outDir, "echo", "tool.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "ls", "tool.json"))).toBe(false);
  });

  it("generates multiple comma-separated tools from --only", async () => {
    const registryPath = writeRegistryFile([
      { id: "echo", binary: "echo" },
      { id: "ls", binary: "ls" },
      { id: "pwd", binary: "pwd" },
    ]);
    const outDir = path.join(tmpDir, "out");
    mkdirSync(outDir, { recursive: true });

    await handleGenerate({ out: outDir, registry: registryPath, only: "echo,ls" });

    expect(existsSync(path.join(outDir, "echo", "tool.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "ls", "tool.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "pwd", "tool.json"))).toBe(false);
  });

  it("handles --only with spaces around commas", async () => {
    const registryPath = writeRegistryFile([
      { id: "echo", binary: "echo" },
      { id: "ls", binary: "ls" },
    ]);
    const outDir = path.join(tmpDir, "out");
    mkdirSync(outDir, { recursive: true });

    await handleGenerate({ out: outDir, registry: registryPath, only: "echo , ls" });

    expect(existsSync(path.join(outDir, "echo", "tool.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "ls", "tool.json"))).toBe(true);
  });

  it("generates all tools when --only is not provided", async () => {
    const registryPath = writeRegistryFile([
      { id: "echo", binary: "echo" },
      { id: "ls", binary: "ls" },
    ]);
    const outDir = path.join(tmpDir, "out");
    mkdirSync(outDir, { recursive: true });

    await handleGenerate({ out: outDir, registry: registryPath });

    expect(existsSync(path.join(outDir, "echo", "tool.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "ls", "tool.json"))).toBe(true);
  });

  it("generates nothing when --only specifies no matching tools", async () => {
    const registryPath = writeRegistryFile([
      { id: "echo", binary: "echo" },
    ]);
    const outDir = path.join(tmpDir, "out");
    mkdirSync(outDir, { recursive: true });

    await handleGenerate({ out: outDir, registry: registryPath, only: "nonexistent" });

    expect(existsSync(path.join(outDir, "echo", "tool.json"))).toBe(false);
    expect(existsSync(path.join(outDir, "nonexistent", "tool.json"))).toBe(false);
  });

  it("index.md only lists the filtered tools", async () => {
    const registryPath = writeRegistryFile([
      { id: "echo", binary: "echo" },
      { id: "ls", binary: "ls" },
    ]);
    const outDir = path.join(tmpDir, "out");
    mkdirSync(outDir, { recursive: true });

    await handleGenerate({ out: outDir, registry: registryPath, only: "echo" });

    const indexContent = readFileSync(path.join(outDir, "index.md"), "utf8");
    expect(indexContent).toContain("echo");
    expect(indexContent).not.toContain("| ls |");
  });
});

describe("bin/tool-docs.js generate <binary> (integration)", () => {
  const binPath = path.resolve(import.meta.dir, "../bin/tool-docs.js");
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `generate-int-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates docs for a positional binary arg via CLI", () => {
    const result = spawnSync("node", [binPath, "generate", "jq", "--out", tmpDir], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(existsSync(path.join(tmpDir, "jq", "tool.json"))).toBe(true);
    const doc = JSON.parse(readFileSync(path.join(tmpDir, "jq", "tool.json"), "utf8"));
    expect(doc.id).toBe("jq");
    expect(doc.binary).toBe("jq");
  });

  it("binary arg works when placed after flags", () => {
    const result = spawnSync("node", [binPath, "generate", "--out", tmpDir, "jq"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(existsSync(path.join(tmpDir, "jq", "tool.json"))).toBe(true);
  });

  it("exits with code 1 and prints error for nonexistent binary", () => {
    const result = spawnSync("node", [binPath, "generate", "nonexistent-binary-xyz", "--out", tmpDir], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Error: binary "nonexistent-binary-xyz" not found on PATH');
  });

  it("--only filters registry tools in batch mode via CLI", () => {
    const registryPath = path.join(tmpDir, "registry.yaml");
    writeFileSync(registryPath, `version: 1\ntools:\n  - id: echo\n    binary: echo\n  - id: ls\n    binary: ls\n`);
    const outDir = path.join(tmpDir, "out");
    mkdirSync(outDir, { recursive: true });

    const result = spawnSync("node", [binPath, "generate", "--registry", registryPath, "--out", outDir, "--only", "echo"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(existsSync(path.join(outDir, "echo", "tool.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "ls", "tool.json"))).toBe(false);
  });
});

describe("bin/tool-docs.js --help (integration)", () => {
  const binPath = path.resolve(import.meta.dir, "../bin/tool-docs.js");

  it("exits with code 0 and prints help text for --help", () => {
    const result = spawnSync("node", [binPath, "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("tool-docs");
    expect(result.stdout).toContain("generate");
    expect(result.stdout).toContain("distill");
    expect(result.stdout).toContain("--registry");
  });

  it("exits with code 0 and prints help text for -h", () => {
    const result = spawnSync("node", [binPath, "-h"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("tool-docs");
  });

  it("exits with code 0 and prints help text when called with no args", () => {
    const result = spawnSync("node", [binPath], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("tool-docs");
  });

  it("exits with code 1 for unknown command", () => {
    const result = spawnSync("node", [binPath, "not-a-command"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown command");
  });
});

describe("handleDistill with tool-id", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `distill-adhoc-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupRawDocs(toolId: string, content = "# tool\n\nSome docs"): string {
    const docsDir = path.join(tmpDir, "docs");
    const toolDir = path.join(docsDir, toolId);
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(path.join(toolDir, "tool.md"), content);
    return docsDir;
  }

  it("exits with error when raw docs don't exist for the tool-id", async () => {
    const docsDir = path.join(tmpDir, "docs");
    mkdirSync(docsDir, { recursive: true });
    // No tool.md created for "nonexistent"

    let exitCode: number | undefined;
    let errorOutput = "";
    const origExit = process.exit;
    const origError = console.error;
    process.exit = ((code: number) => { exitCode = code; throw new Error("exit"); }) as never;
    console.error = (msg: string) => { errorOutput += msg; };

    try {
      await handleDistill({ docs: docsDir, out: path.join(tmpDir, "skills") }, "nonexistent");
    } catch {
      // expected
    } finally {
      process.exit = origExit;
      console.error = origError;
    }

    expect(exitCode).toBe(1);
    expect(errorOutput).toContain('no raw docs found for "nonexistent"');
    expect(errorOutput).toContain("tool-docs generate nonexistent");
  });

  it("does not require a registry when tool-id is provided", async () => {
    const docsDir = setupRawDocs("mytool");
    const skillsDir = path.join(tmpDir, "skills");
    const captured: DistillOptions[] = [];

    const mockDistill = async (opts: DistillOptions): Promise<DistillResult> => {
      captured.push(opts);
      return { toolId: opts.toolId, outDir: opts.outDir };
    };

    // Point registry to a nonexistent file — should not matter in ad-hoc mode
    await handleDistill(
      { docs: docsDir, out: skillsDir, registry: path.join(tmpDir, "nonexistent-registry.yaml") },
      "mytool",
      mockDistill
    );

    expect(captured).toHaveLength(1);
    expect(captured[0].toolId).toBe("mytool");
  });

  it("uses toolId as both id and binary in ad-hoc mode", async () => {
    const docsDir = setupRawDocs("jq", "# jq\n\n## Usage\njq [OPTIONS] FILTER [FILE...]");
    const skillsDir = path.join(tmpDir, "skills");
    const captured: DistillOptions[] = [];

    const mockDistill = async (opts: DistillOptions): Promise<DistillResult> => {
      captured.push(opts);
      return { toolId: opts.toolId, outDir: opts.outDir };
    };

    await handleDistill({ docs: docsDir, out: skillsDir }, "jq", mockDistill);

    expect(captured).toHaveLength(1);
    expect(captured[0].toolId).toBe("jq");
    expect(captured[0].binary).toBe("jq");
  });

  it("passes correct docsDir and outDir to distillFn", async () => {
    const docsDir = setupRawDocs("mytool");
    const skillsDir = path.join(tmpDir, "skills");
    const captured: DistillOptions[] = [];

    const mockDistill = async (opts: DistillOptions): Promise<DistillResult> => {
      captured.push(opts);
      return { toolId: opts.toolId, outDir: opts.outDir };
    };

    await handleDistill({ docs: docsDir, out: skillsDir }, "mytool", mockDistill);

    expect(captured[0].docsDir).toBe(docsDir);
    expect(captured[0].outDir).toBe(path.join(skillsDir, "mytool"));
  });

  it("forwards model flag to distillFn", async () => {
    const docsDir = setupRawDocs("mytool");
    const skillsDir = path.join(tmpDir, "skills");
    const captured: DistillOptions[] = [];

    const mockDistill = async (opts: DistillOptions): Promise<DistillResult> => {
      captured.push(opts);
      return { toolId: opts.toolId, outDir: opts.outDir };
    };

    await handleDistill({ docs: docsDir, out: skillsDir, model: "claude-opus-4-6" }, "mytool", mockDistill);

    expect(captured[0].model).toBe("claude-opus-4-6");
  });

  it("uses DEFAULT_MODEL when model flag is not provided", async () => {
    const docsDir = setupRawDocs("mytool");
    const skillsDir = path.join(tmpDir, "skills");
    const captured: DistillOptions[] = [];

    const mockDistill = async (opts: DistillOptions): Promise<DistillResult> => {
      captured.push(opts);
      return { toolId: opts.toolId, outDir: opts.outDir };
    };

    await handleDistill({ docs: docsDir, out: skillsDir }, "mytool", mockDistill);

    expect(captured[0].model).toBe(DEFAULT_MODEL);
  });

  it("reports skipped when distillFn returns skipped result", async () => {
    const docsDir = setupRawDocs("mytool");
    const skillsDir = path.join(tmpDir, "skills");

    const mockDistill = async (opts: DistillOptions): Promise<DistillResult> => ({
      toolId: opts.toolId,
      outDir: opts.outDir,
      skipped: true,
      skipReason: "hand-written skill (no generated-from marker)",
    });

    // Capture console output
    let consoleOutput = "";
    const origLog = console.log;
    const origWrite = process.stdout.write;
    process.stdout.write = ((msg: string) => { consoleOutput += msg; return true; }) as typeof process.stdout.write;
    console.log = (msg: string) => { consoleOutput += msg + "\n"; };

    try {
      await handleDistill({ docs: docsDir, out: skillsDir }, "mytool", mockDistill);
    } finally {
      console.log = origLog;
      process.stdout.write = origWrite;
    }

    expect(consoleOutput).toContain("skipped");
    expect(consoleOutput).toContain("Distilled 0 tool(s), skipped 1");
  });

  it("reports size warnings from distillFn", async () => {
    const docsDir = setupRawDocs("mytool");
    const skillsDir = path.join(tmpDir, "skills");

    const mockDistill = async (opts: DistillOptions): Promise<DistillResult> => ({
      toolId: opts.toolId,
      outDir: opts.outDir,
      sizeWarnings: ["SKILL.md is 2500 bytes (limit: 2000 bytes)"],
    });

    let consoleOutput = "";
    const origLog = console.log;
    const origWrite = process.stdout.write;
    process.stdout.write = ((msg: string) => { consoleOutput += msg; return true; }) as typeof process.stdout.write;
    console.log = (msg: string) => { consoleOutput += msg + "\n"; };

    try {
      await handleDistill({ docs: docsDir, out: skillsDir }, "mytool", mockDistill);
    } finally {
      console.log = origLog;
      process.stdout.write = origWrite;
    }

    expect(consoleOutput).toContain("size warnings");
    expect(consoleOutput).toContain("Distilled 1 tool(s), skipped 0");
  });

  it("prints done for successful distill with no warnings", async () => {
    const docsDir = setupRawDocs("mytool");
    const skillsDir = path.join(tmpDir, "skills");

    const mockDistill = async (opts: DistillOptions): Promise<DistillResult> => ({
      toolId: opts.toolId,
      outDir: opts.outDir,
    });

    let consoleOutput = "";
    const origLog = console.log;
    const origWrite = process.stdout.write;
    process.stdout.write = ((msg: string) => { consoleOutput += msg; return true; }) as typeof process.stdout.write;
    console.log = (msg: string) => { consoleOutput += msg + "\n"; };

    try {
      await handleDistill({ docs: docsDir, out: skillsDir }, "mytool", mockDistill);
    } finally {
      console.log = origLog;
      process.stdout.write = origWrite;
    }

    expect(consoleOutput).toContain("distill mytool... ");
    expect(consoleOutput).toContain("done");
    expect(consoleOutput).toContain("Distilled 1 tool(s), skipped 0");
  });
});

describe("bin/tool-docs.js distill <tool-id> (integration)", () => {
  const binPath = path.resolve(import.meta.dir, "../bin/tool-docs.js");
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `distill-int-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("exits with code 1 and prints error when raw docs don't exist", () => {
    const docsDir = path.join(tmpDir, "docs");
    mkdirSync(docsDir, { recursive: true });

    const result = spawnSync("node", [binPath, "distill", "nonexistent-tool", "--docs", docsDir, "--out", path.join(tmpDir, "skills")], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no raw docs found for "nonexistent-tool"');
    expect(result.stderr).toContain("tool-docs generate nonexistent-tool");
  });

  it("tool-id positional arg works when placed after flags", () => {
    const docsDir = path.join(tmpDir, "docs");
    mkdirSync(docsDir, { recursive: true });

    const result = spawnSync("node", [binPath, "distill", "--docs", docsDir, "--out", path.join(tmpDir, "skills"), "nonexistent-tool"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no raw docs found for "nonexistent-tool"');
  });

  it("help text shows ad-hoc and registry modes for generate", () => {
    const result = spawnSync("node", [binPath, "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("tool-docs generate <tool>");
    expect(result.stdout).toContain("tool-docs generate [--registry");
  });

  it("help text shows ad-hoc and registry modes for distill", () => {
    const result = spawnSync("node", [binPath, "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("tool-docs distill <tool>");
    expect(result.stdout).toContain("tool-docs distill [--registry");
  });

  it("help text shows the run command with batch mode", () => {
    const result = spawnSync("node", [binPath, "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("tool-docs run <tool>");
    expect(result.stdout).toContain("tool-docs run [--registry");
    expect(result.stdout).toContain("run        Run full pipeline");
  });
});

describe("handleRun", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `run-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makePassingReport(toolId: string): MultiModelValidationReport {
    return {
      toolId,
      skillPath: path.join(tmpDir, "skills", toolId, "SKILL.md"),
      models: ["test-model"],
      reports: [],
      overallAverageScore: 9.5,
      passed: true,
      threshold: 9,
      generatedAt: new Date().toISOString(),
    };
  }

  function makeFailingReport(toolId: string): MultiModelValidationReport {
    return {
      toolId,
      skillPath: path.join(tmpDir, "skills", toolId, "SKILL.md"),
      models: ["test-model"],
      reports: [],
      overallAverageScore: 6.0,
      passed: false,
      threshold: 9,
      generatedAt: new Date().toISOString(),
    };
  }

  function makeDeps(overrides: Partial<RunDeps> = {}): RunDeps & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      generateFn: overrides.generateFn ?? (async () => { calls.push("generate"); }),
      distillFn: overrides.distillFn ?? (async () => { calls.push("distill"); }),
      validateFn: overrides.validateFn ?? (async ({ toolId }) => {
        calls.push("validate");
        return makePassingReport(toolId);
      }),
    };
  }

  it("calls generate, distill, validate in order", async () => {
    const deps = makeDeps();
    await handleRun("mytool", { skills: path.join(tmpDir, "skills") }, deps);
    expect(deps.calls).toEqual(["generate", "distill", "validate"]);
  });

  it("passes toolId to generateFn as binaryName", async () => {
    let capturedBinary: string | undefined;
    const deps = makeDeps({
      generateFn: async (_flags, binaryName) => { capturedBinary = binaryName; },
    });
    await handleRun("jq", { skills: path.join(tmpDir, "skills") }, deps);
    expect(capturedBinary).toBe("jq");
  });

  it("passes toolId to distillFn", async () => {
    let capturedToolId: string | undefined;
    const deps = makeDeps({
      distillFn: async (_flags, toolId) => { capturedToolId = toolId; },
    });
    await handleRun("jq", { skills: path.join(tmpDir, "skills") }, deps);
    expect(capturedToolId).toBe("jq");
  });

  it("passes toolId to validateFn", async () => {
    let capturedToolId: string | undefined;
    const deps = makeDeps({
      validateFn: async (opts) => { capturedToolId = opts.toolId; return makePassingReport(opts.toolId); },
    });
    await handleRun("jq", { skills: path.join(tmpDir, "skills") }, deps);
    expect(capturedToolId).toBe("jq");
  });

  it("forwards flags to generateFn", async () => {
    let capturedFlags: Record<string, string | boolean> = {};
    const deps = makeDeps({
      generateFn: async (flags) => { capturedFlags = flags; },
    });
    const flags = { out: "/tmp/out", model: "claude-opus-4-6", skills: path.join(tmpDir, "skills") };
    await handleRun("jq", flags, deps);
    expect(capturedFlags.out).toBe("/tmp/out");
    expect(capturedFlags.model).toBe("claude-opus-4-6");
  });

  it("forwards flags to distillFn", async () => {
    let capturedFlags: Record<string, string | boolean> = {};
    const deps = makeDeps({
      distillFn: async (flags) => { capturedFlags = flags; },
    });
    const flags = { docs: "/tmp/docs", model: "claude-opus-4-6", skills: path.join(tmpDir, "skills") };
    await handleRun("jq", flags, deps);
    expect(capturedFlags.docs).toBe("/tmp/docs");
    expect(capturedFlags.model).toBe("claude-opus-4-6");
  });

  it("passes models and threshold to validateFn", async () => {
    let capturedOpts: { models?: string[]; threshold?: number } = {};
    const deps = makeDeps({
      validateFn: async (opts) => { capturedOpts = opts; return makePassingReport(opts.toolId); },
    });
    await handleRun("jq", { models: "model-a,model-b", threshold: "7", skills: path.join(tmpDir, "skills") }, deps);
    expect(capturedOpts.models).toEqual(["model-a", "model-b"]);
    expect(capturedOpts.threshold).toBe(7);
  });

  it("returns failed result on validation failure", async () => {
    const deps = makeDeps({
      validateFn: async ({ toolId }) => makeFailingReport(toolId),
    });
    const result = await handleRun("mytool", { skills: path.join(tmpDir, "skills") }, deps);
    expect(result.passed).toBe(false);
    expect(result.score).toBe(6.0);
    expect(result.toolId).toBe("mytool");
  });

  it("returns passing result on validation success", async () => {
    const deps = makeDeps();
    const result = await handleRun("mytool", { skills: path.join(tmpDir, "skills") }, deps);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(9.5);
    expect(result.toolId).toBe("mytool");
    expect(result.skillPath).toContain("mytool/SKILL.md");
  });

  it("runs auto-redist when --auto-redist is set and validation fails", async () => {
    let validateCallCount = 0;
    const calls: string[] = [];
    const deps: RunDeps & { calls: string[] } = {
      calls,
      generateFn: async () => { calls.push("generate"); },
      distillFn: async () => { calls.push("distill"); },
      validateFn: async ({ toolId }) => {
        validateCallCount++;
        calls.push("validate");
        // Fail first time, pass second time
        if (validateCallCount === 1) return makeFailingReport(toolId);
        return makePassingReport(toolId);
      },
      distillToolFn: async () => {
        calls.push("distillTool");
        return { toolId: "mytool", outDir: path.join(tmpDir, "skills", "mytool") };
      },
    };

    const result = await handleRun("mytool", { skills: path.join(tmpDir, "skills"), "auto-redist": true }, deps);
    expect(result.passed).toBe(true);
    expect(validateCallCount).toBe(2);
    expect(deps.calls).toEqual(["generate", "distill", "validate", "distillTool", "validate"]);
  });

  it("returns failed result when auto-redist still fails", async () => {
    const deps = makeDeps({
      validateFn: async ({ toolId }) => makeFailingReport(toolId),
      distillToolFn: async () => ({ toolId: "mytool", outDir: path.join(tmpDir, "skills", "mytool") }),
    });

    const result = await handleRun("mytool", { skills: path.join(tmpDir, "skills"), "auto-redist": true }, deps);
    expect(result.passed).toBe(false);
  });

  it("does not suggest --auto-redist when already using it", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };

    const deps = makeDeps({
      validateFn: async ({ toolId }) => makeFailingReport(toolId),
      distillToolFn: async () => ({ toolId: "mytool", outDir: path.join(tmpDir, "skills", "mytool") }),
    });

    try {
      await handleRun("mytool", { skills: path.join(tmpDir, "skills"), "auto-redist": true }, deps);
    } finally {
      console.log = origLog;
    }

    expect(logs.some((l) => l.includes("--auto-redist"))).toBe(false);
  });
});

describe("bin/tool-docs.js run (integration)", () => {
  const binPath = path.resolve(import.meta.dir, "../bin/tool-docs.js");

  it("batch mode exits with code 1 when no registry exists", () => {
    const result = spawnSync("node", [binPath, "run", "--registry", "/tmp/nonexistent-registry.yaml"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("No registry found");
  });

  it("exits with code 1 for a nonexistent binary", () => {
    const result = spawnSync("node", [binPath, "run", "nonexistent-binary-xyz", "--out", os.tmpdir()], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('binary "nonexistent-binary-xyz" not found on PATH');
  });
});

describe("handleRunBatch", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `run-batch-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makePassingReport(toolId: string): MultiModelValidationReport {
    return {
      toolId,
      skillPath: path.join(tmpDir, "skills", toolId, "SKILL.md"),
      models: ["test-model"],
      reports: [],
      overallAverageScore: 9.5,
      passed: true,
      threshold: 9,
      generatedAt: new Date().toISOString(),
    };
  }

  function makeBatchDeps(overrides: Partial<RunBatchDeps> = {}): RunBatchDeps & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      generateFn: overrides.generateFn ?? (async () => { calls.push("generate"); }),
      distillFn: overrides.distillFn ?? (async () => { calls.push("distill"); }),
      validateFn: overrides.validateFn ?? (async ({ toolId }) => {
        calls.push(`validate:${toolId}`);
        return makePassingReport(toolId);
      }),
      loadRegistryFn: overrides.loadRegistryFn,
    };
  }

  it("runs the pipeline for each registry tool", async () => {
    const deps = makeBatchDeps({
      loadRegistryFn: async () => ({
        version: 1,
        tools: [
          { id: "jq", binary: "jq", enabled: true },
          { id: "curl", binary: "curl", enabled: true },
        ],
      }),
    });

    await handleRunBatch({ skills: path.join(tmpDir, "skills") }, deps);
    expect(deps.calls).toContain("validate:curl");
    expect(deps.calls).toContain("validate:jq");
  });

  it("skips disabled tools", async () => {
    const deps = makeBatchDeps({
      loadRegistryFn: async () => ({
        version: 1,
        tools: [
          { id: "jq", binary: "jq", enabled: true },
          { id: "disabled-tool", binary: "disabled-tool", enabled: false },
        ],
      }),
    });

    await handleRunBatch({ skills: path.join(tmpDir, "skills") }, deps);
    expect(deps.calls).toContain("validate:jq");
    expect(deps.calls).not.toContain("validate:disabled-tool");
  });

  it("filters by --only flag", async () => {
    const deps = makeBatchDeps({
      loadRegistryFn: async () => ({
        version: 1,
        tools: [
          { id: "jq", binary: "jq", enabled: true },
          { id: "curl", binary: "curl", enabled: true },
        ],
      }),
    });

    await handleRunBatch({ skills: path.join(tmpDir, "skills"), only: "jq" }, deps);
    expect(deps.calls).toContain("validate:jq");
    expect(deps.calls).not.toContain("validate:curl");
  });

  it("skips tools with missing binaries", async () => {
    const deps = makeBatchDeps({
      loadRegistryFn: async () => ({
        version: 1,
        tools: [
          { id: "nonexistent-xyz", binary: "nonexistent-xyz-binary", enabled: true },
        ],
      }),
    });

    const logs: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => { logs.push(args.join(" ")); };
    const origExit = process.exit;
    process.exit = ((code: number) => { throw new Error(`exit:${code}`); }) as never;

    try {
      await handleRunBatch({ skills: path.join(tmpDir, "skills") }, deps);
    } catch {
      // expected — process.exit(1) for failed tools
    } finally {
      console.error = origError;
      process.exit = origExit;
    }

    expect(deps.calls).toEqual([]);
    expect(logs.some((l) => l.includes("not found on PATH"))).toBe(true);
  });

  it("prints summary after batch", async () => {
    const deps = makeBatchDeps({
      loadRegistryFn: async () => ({
        version: 1,
        tools: [
          { id: "jq", binary: "jq", enabled: true },
        ],
      }),
    });

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };

    try {
      await handleRunBatch({ skills: path.join(tmpDir, "skills") }, deps);
    } finally {
      console.log = origLog;
    }

    expect(logs.some((l) => l.includes("Summary"))).toBe(true);
    expect(logs.some((l) => l.includes("1/1 tools passed"))).toBe(true);
  });

  it("exits with code 1 when registry loading fails", async () => {
    const deps = makeBatchDeps({
      loadRegistryFn: async () => { throw new Error("file not found"); },
    });

    let exitCode: number | undefined;
    const origExit = process.exit;
    process.exit = ((code: number) => { exitCode = code; throw new Error("exit"); }) as never;

    try {
      await handleRunBatch({ skills: path.join(tmpDir, "skills") }, deps);
    } catch {
      // expected
    } finally {
      process.exit = origExit;
    }

    expect(exitCode).toBe(1);
  });

  it("prints nothing-to-do message for empty registry", async () => {
    const deps = makeBatchDeps({
      loadRegistryFn: async () => ({ version: 1, tools: [] }),
    });

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };

    try {
      await handleRunBatch({ skills: path.join(tmpDir, "skills") }, deps);
    } finally {
      console.log = origLog;
    }

    expect(logs.some((l) => l.includes("No tools to process"))).toBe(true);
  });
});
