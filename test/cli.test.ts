import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import path from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { parseFlags, extractPositionalArgs, handleAutoRedist, handleGenerate, resolveBinary, lookupRegistryTool } from "../src/cli.js";
import { DEFAULT_MODEL, DEFAULT_SKILLS_DIR, DistillOptions, DistillResult } from "../src/distill.js";
import { DEFAULT_VALIDATION_MODELS } from "../src/validate.js";

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
