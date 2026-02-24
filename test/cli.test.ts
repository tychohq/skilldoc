import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import path from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { parseFlags, extractPositionalArgs, handleAutoRedist, handleGenerate, handleDistill, handleInit, handleRun, handleRunBatch, resolveBinary, lookupRegistryTool, generateCommandDocs, DEFAULT_MAX_DEPTH, applyComplexity, COMPLEXITY_SKILL_LIMITS, hasSubcommandKeyword, identifySubcommandCandidates, detectCommandHelpArgs, type RunFn, type RunDeps, type RunBatchDeps, type RunResult } from "../src/cli.js";
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
    const flags = parseFlags(["--out", "~/.skills"]);
    expect(flags.out).toBe("~/.skills");
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

  it("DEFAULT_SKILLS_DIR is ~/.skills", () => {
    expect(DEFAULT_SKILLS_DIR).toBe("~/.skills");
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

  it("preserves prior index entries when generating another ad-hoc binary", async () => {
    await handleGenerate({ out: tmpDir }, "echo");
    await handleGenerate({ out: tmpDir }, "ls");
    const indexMd = path.join(tmpDir, "index.md");
    const content = readFileSync(indexMd, "utf8");
    expect(content).toContain("| echo | echo |");
    expect(content).toContain("| ls | ls |");
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
    expect(Array.isArray(doc.subcommandCandidates)).toBe(true);
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
    writeFileSync(registryPath, `version: 1\ntools:\n  - id: git\n    binary: git\n    helpArgs: ["-h"]\n    displayName: Git\n`);
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
    // Use echo with commandHelpArgs — echo has no subcommands but commandHelpArgs
    // still triggers the commands/ dir to be created
    writeFileSync(registryPath, `version: 1\ntools:\n  - id: echo\n    binary: echo\n    commandHelpArgs: ["--help"]\n`);
    const outDir = path.join(tmpDir, "out");
    mkdirSync(outDir, { recursive: true });
    await handleGenerate({ out: outDir, registry: registryPath }, "echo");
    // commandHelpArgs presence should trigger command doc generation infrastructure
    expect(existsSync(path.join(outDir, "echo", "commands"))).toBe(true);
  });
});

describe("handleGenerate subcommand candidate detection", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `generate-subcommand-candidates-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("captures candidates from keyword and command-help heuristics", async () => {
    const binaryPath = path.join(tmpDir, "fakecli");
    writeFileSync(
      binaryPath,
      `#!/bin/sh
if [ "$1" = "--help" ]; then
  cat <<'EOF'
Usage: fakecli [command]

Commands:
  remote   Manage remotes
  plugins  Plugin operations
  status   Show status
EOF
  exit 0
fi

if [ "$1" = "plugins" ] && [ "$2" = "--help" ]; then
  cat <<'EOF'
Usage: fakecli plugins [command]

Commands:
  add  Add plugin
EOF
  exit 0
fi

echo "Usage: fakecli"
`,
      { mode: 0o755 }
    );

    const registryPath = path.join(tmpDir, "registry.yaml");
    writeFileSync(registryPath, `version: 1\ntools:\n  - id: fakecli\n    binary: "${binaryPath}"\n`);

    const outDir = path.join(tmpDir, "out");
    await handleGenerate({ out: outDir, registry: registryPath });

    const doc = JSON.parse(readFileSync(path.join(outDir, "fakecli", "tool.json"), "utf8"));
    const names = doc.subcommandCandidates.map((c: { name: string }) => c.name);
    expect(names).toContain("remote");
    expect(names).toContain("plugins");
    expect(names).not.toContain("status");
  });

  it("stores an empty candidate list when no commands look hierarchical", async () => {
    const binaryPath = path.join(tmpDir, "flatcli");
    writeFileSync(
      binaryPath,
      `#!/bin/sh
if [ "$1" = "--help" ]; then
  cat <<'EOF'
Usage: flatcli [command]

Commands:
  push  Push changes
  pull  Pull changes
EOF
  exit 0
fi

echo "Usage: flatcli"
`,
      { mode: 0o755 }
    );

    const registryPath = path.join(tmpDir, "registry.yaml");
    writeFileSync(registryPath, `version: 1\ntools:\n  - id: flatcli\n    binary: "${binaryPath}"\n`);

    const outDir = path.join(tmpDir, "out");
    await handleGenerate({ out: outDir, registry: registryPath });

    const doc = JSON.parse(readFileSync(path.join(outDir, "flatcli", "tool.json"), "utf8"));
    expect(doc.subcommandCandidates).toEqual([]);
  });

  it("auto-detects commandHelpArgs with ordered probing and stores it in tool.json", async () => {
    const binaryPath = path.join(tmpDir, "orderedcli");
    const callsPath = path.join(tmpDir, "orderedcli-calls.log");
    writeFileSync(
      binaryPath,
      `#!/bin/sh
printf '%s\n' "$*" >> "${callsPath}"
if [ "$1" = "--help" ]; then
  cat <<'EOF'
Usage: orderedcli [command]

Commands:
  remote  Manage remotes
  status  Show status
EOF
  exit 0
fi

if [ "$1" = "remote" ] && [ "$2" = "--help" ]; then
  echo "Usage: orderedcli remote"
  exit 0
fi

if [ "$1" = "remote" ] && [ "$2" = "-h" ]; then
  cat <<'EOF'
Usage: orderedcli remote [command]

Commands:
  add  Add remote
EOF
  exit 0
fi

if [ "$1" = "remote" ] && [ "$2" = "add" ] && [ "$3" = "--help" ]; then
  echo "Usage: orderedcli remote add <name>"
  exit 0
fi

if [ "$1" = "status" ] && [ "$2" = "-h" ]; then
  echo "Usage: orderedcli status"
  exit 0
fi

if [ "$1" = "help" ] && [ "$2" = "remote" ]; then
  cat <<'EOF'
Usage: orderedcli remote [command]

Commands:
  add  Add remote
EOF
  exit 0
fi

echo "Usage: orderedcli"
`,
      { mode: 0o755 }
    );

    const registryPath = path.join(tmpDir, "registry.yaml");
    writeFileSync(registryPath, `version: 1\ntools:\n  - id: orderedcli\n    binary: "${binaryPath}"\n`);

    const outDir = path.join(tmpDir, "out");
    await handleGenerate({ out: outDir, registry: registryPath });

    const doc = JSON.parse(readFileSync(path.join(outDir, "orderedcli", "tool.json"), "utf8"));
    expect(doc.commandHelpArgs).toEqual(["{command}", "-h"]);
    expect(existsSync(path.join(outDir, "orderedcli", "commands", "remote", "command.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "orderedcli", "commands", "status", "command.json"))).toBe(true);

    const calls = readFileSync(callsPath, "utf8").trim().split("\n");
    expect(calls).toContain("remote --help");
    expect(calls).toContain("remote -h");
    expect(calls).toContain("status -h");
    expect(calls).not.toContain("help remote");
  });

  it("reuses stored commandHelpArgs from tool.json on subsequent runs", async () => {
    const binaryPath = path.join(tmpDir, "cachedpatterncli");
    const callsPath = path.join(tmpDir, "cachedpatterncli-calls.log");
    writeFileSync(
      binaryPath,
      `#!/bin/sh
printf '%s\n' "$*" >> "${callsPath}"
if [ "$1" = "--help" ]; then
  cat <<'EOF'
Usage: cachedpatterncli [command]

Commands:
  remote  Manage remotes
EOF
  exit 0
fi

if [ "$1" = "remote" ] && [ "$2" = "--help" ]; then
  echo "Usage: cachedpatterncli remote"
  exit 0
fi

if [ "$1" = "remote" ] && [ "$2" = "-h" ]; then
  cat <<'EOF'
Usage: cachedpatterncli remote [command]

Commands:
  add  Add remote
EOF
  exit 0
fi

if [ "$1" = "remote" ] && [ "$2" = "add" ] && [ "$3" = "--help" ]; then
  echo "Usage: cachedpatterncli remote add <name>"
  exit 0
fi

echo "Usage: cachedpatterncli"
`,
      { mode: 0o755 }
    );

    const registryPath = path.join(tmpDir, "registry.yaml");
    writeFileSync(registryPath, `version: 1\ntools:\n  - id: cachedpatterncli\n    binary: "${binaryPath}"\n`);

    const outDir = path.join(tmpDir, "out");
    await handleGenerate({ out: outDir, registry: registryPath });

    const firstDoc = JSON.parse(readFileSync(path.join(outDir, "cachedpatterncli", "tool.json"), "utf8"));
    expect(firstDoc.commandHelpArgs).toEqual(["{command}", "-h"]);

    writeFileSync(callsPath, "", "utf8");
    await handleGenerate({ out: outDir, registry: registryPath });

    const calls = readFileSync(callsPath, "utf8").trim().split("\n").filter(Boolean);
    expect(calls).not.toContain("remote --help");
    expect(calls).toContain("remote -h");
  });

  it("uses stored commandHelpArgs to generate docs for all top-level commands when heuristics find no candidates", async () => {
    const binaryPath = path.join(tmpDir, "storedpatternallcmds");
    const modePath = path.join(tmpDir, "storedpatternallcmds-mode.txt");
    writeFileSync(
      binaryPath,
      `#!/bin/sh
MODE="$(cat "${modePath}" 2>/dev/null)"
if [ "$1" = "--help" ]; then
  if [ "$MODE" = "neutral" ]; then
    cat <<'EOF'
Usage: storedpatternallcmds [command]

Commands:
  remote  Remote operations
  status  Show status
EOF
  else
    cat <<'EOF'
Usage: storedpatternallcmds [command]

Commands:
  remote  Manage remotes
  status  Show status
EOF
  fi
  exit 0
fi

if [ "$1" = "remote" ] && [ "$2" = "--help" ]; then
  echo "Usage: storedpatternallcmds remote"
  exit 0
fi

if [ "$1" = "status" ] && [ "$2" = "--help" ]; then
  echo "Usage: storedpatternallcmds status"
  exit 0
fi

if [ "$1" = "remote" ] && [ "$2" = "-h" ]; then
  cat <<'EOF'
Usage: storedpatternallcmds remote [command]

Commands:
  add  Add remote
EOF
  exit 0
fi

if [ "$1" = "status" ] && [ "$2" = "-h" ]; then
  echo "Usage: storedpatternallcmds status"
  exit 0
fi

if [ "$1" = "remote" ] && [ "$2" = "add" ] && [ "$3" = "--help" ]; then
  echo "Usage: storedpatternallcmds remote add <name>"
  exit 0
fi

echo "Usage: storedpatternallcmds"
`,
      { mode: 0o755 }
    );

    const registryPath = path.join(tmpDir, "registry.yaml");
    writeFileSync(registryPath, `version: 1\ntools:\n  - id: storedpatternallcmds\n    binary: "${binaryPath}"\n`);

    const outDir = path.join(tmpDir, "out");
    await handleGenerate({ out: outDir, registry: registryPath });

    const firstDoc = JSON.parse(readFileSync(path.join(outDir, "storedpatternallcmds", "tool.json"), "utf8"));
    expect(firstDoc.commandHelpArgs).toEqual(["{command}", "-h"]);
    expect(existsSync(path.join(outDir, "storedpatternallcmds", "commands", "remote", "command.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "storedpatternallcmds", "commands", "status", "command.json"))).toBe(true);

    writeFileSync(modePath, "neutral\n", "utf8");
    await handleGenerate({ out: outDir, registry: registryPath });

    const secondDoc = JSON.parse(readFileSync(path.join(outDir, "storedpatternallcmds", "tool.json"), "utf8"));
    expect(secondDoc.subcommandCandidates).toEqual([]);
    expect(secondDoc.commandHelpArgs).toEqual(["{command}", "-h"]);
    expect(existsSync(path.join(outDir, "storedpatternallcmds", "commands", "remote", "command.json"))).toBe(true);
    expect(existsSync(path.join(outDir, "storedpatternallcmds", "commands", "status", "command.json"))).toBe(true);
  });

  it("falls back to top-level help when stored commandHelpArgs no longer work", async () => {
    const binaryPath = path.join(tmpDir, "stalepatterncli");
    const modePath = path.join(tmpDir, "stalepatterncli-mode.txt");
    writeFileSync(
      binaryPath,
      `#!/bin/sh
MODE="$(cat "${modePath}" 2>/dev/null)"
if [ "$1" = "--help" ]; then
  cat <<'EOF'
Usage: stalepatterncli [command]

Commands:
  remote  Manage remotes
EOF
  exit 0
fi

if [ "$1" = "remote" ] && [ "$2" = "--help" ]; then
  echo "Usage: stalepatterncli remote"
  exit 0
fi

if [ "$1" = "remote" ] && [ "$2" = "-h" ]; then
  if [ "$MODE" = "flat" ]; then
    echo "Usage: stalepatterncli remote"
  else
    cat <<'EOF'
Usage: stalepatterncli remote [command]

Commands:
  add  Add remote
EOF
  fi
  exit 0
fi

if [ "$1" = "help" ] && [ "$2" = "remote" ]; then
  echo "Usage: stalepatterncli remote"
  exit 0
fi

if [ "$1" = "remote" ] && [ "$2" = "add" ] && [ "$3" = "--help" ]; then
  echo "Usage: stalepatterncli remote add <name>"
  exit 0
fi

echo "Usage: stalepatterncli"
`,
      { mode: 0o755 }
    );

    const registryPath = path.join(tmpDir, "registry.yaml");
    writeFileSync(registryPath, `version: 1\ntools:\n  - id: stalepatterncli\n    binary: "${binaryPath}"\n`);

    const outDir = path.join(tmpDir, "out");
    await handleGenerate({ out: outDir, registry: registryPath });

    const firstDoc = JSON.parse(readFileSync(path.join(outDir, "stalepatterncli", "tool.json"), "utf8"));
    expect(firstDoc.commandHelpArgs).toEqual(["{command}", "-h"]);
    expect(existsSync(path.join(outDir, "stalepatterncli", "commands", "remote", "command.json"))).toBe(true);

    writeFileSync(modePath, "flat\n", "utf8");
    await handleGenerate({ out: outDir, registry: registryPath });

    const secondDoc = JSON.parse(readFileSync(path.join(outDir, "stalepatterncli", "tool.json"), "utf8"));
    expect(secondDoc.commandHelpArgs).toBeUndefined();
    expect(secondDoc.commands[0].docPath).toBeUndefined();
    expect(existsSync(path.join(outDir, "stalepatterncli", "commands"))).toBe(false);
  });

  it("falls back gracefully when no command-help pattern works", async () => {
    const binaryPath = path.join(tmpDir, "nopatterncli");
    writeFileSync(
      binaryPath,
      `#!/bin/sh
if [ "$1" = "--help" ]; then
  cat <<'EOF'
Usage: nopatterncli [command]

Commands:
  push  Manage pushes
EOF
  exit 0
fi

if [ "$1" = "push" ] && [ "$2" = "--help" ]; then
  echo "Usage: nopatterncli push"
  exit 0
fi

if [ "$1" = "push" ] && [ "$2" = "-h" ]; then
  echo "Usage: nopatterncli push"
  exit 0
fi

if [ "$1" = "help" ] && [ "$2" = "push" ]; then
  echo "Usage: nopatterncli push"
  exit 0
fi

echo "Usage: nopatterncli"
`,
      { mode: 0o755 }
    );

    const registryPath = path.join(tmpDir, "registry.yaml");
    writeFileSync(registryPath, `version: 1\ntools:\n  - id: nopatterncli\n    binary: "${binaryPath}"\n`);

    const outDir = path.join(tmpDir, "out");
    await handleGenerate({ out: outDir, registry: registryPath });

    const doc = JSON.parse(readFileSync(path.join(outDir, "nopatterncli", "tool.json"), "utf8"));
    expect(doc.commandHelpArgs).toBeUndefined();
    expect(existsSync(path.join(outDir, "nopatterncli", "commands"))).toBe(false);
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

describe("bin/skilldoc.js generate <binary> (integration)", () => {
  const binPath = path.resolve(import.meta.dir, "../bin/skilldoc.js");
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

describe("bin/skilldoc.js --help (integration)", () => {
  const binPath = path.resolve(import.meta.dir, "../bin/skilldoc.js");

  it("exits with code 0 and prints help text for --help", () => {
    const result = spawnSync("node", [binPath, "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("skilldoc");
    expect(result.stdout).toContain("generate");
    expect(result.stdout).toContain("distill");
    expect(result.stdout).toContain("--registry");
  });

  it("exits with code 0 and prints help text for -h", () => {
    const result = spawnSync("node", [binPath, "-h"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("skilldoc");
  });

  it("exits with code 0 and prints help text when called with no args", () => {
    const result = spawnSync("node", [binPath], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("skilldoc");
  });

  it("exits with code 1 for unknown command", () => {
    const result = spawnSync("node", [binPath, "not-a-command"], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown command");
  });
});

describe("COMPLEXITY_SKILL_LIMITS", () => {
  it("maps simple to 500 tokens", () => {
    expect(COMPLEXITY_SKILL_LIMITS.simple).toBe(500);
  });

  it("maps complex to 1000 tokens", () => {
    expect(COMPLEXITY_SKILL_LIMITS.complex).toBe(1000);
  });
});

describe("applyComplexity", () => {
  it("returns base config unchanged when complexity is undefined", () => {
    const base = { priorities: ["first"] };
    const result = applyComplexity(base, undefined);
    expect(result).toBe(base);
  });

  it("sets sizeLimits.skill to 500 for simple complexity", () => {
    const result = applyComplexity({}, "simple");
    expect(result.sizeLimits?.skill).toBe(500);
  });

  it("sets sizeLimits.skill to 1000 for complex complexity", () => {
    const result = applyComplexity({}, "complex");
    expect(result.sizeLimits?.skill).toBe(1000);
  });

  it("preserves other sizeLimits fields when applying complexity", () => {
    const base = { sizeLimits: { advanced: 1500, recipes: 1200, troubleshooting: 800 } };
    const result = applyComplexity(base, "simple");
    expect(result.sizeLimits?.skill).toBe(500);
    expect(result.sizeLimits?.advanced).toBe(1500);
    expect(result.sizeLimits?.recipes).toBe(1200);
    expect(result.sizeLimits?.troubleshooting).toBe(800);
  });

  it("preserves other config fields when applying complexity", () => {
    const base = { priorities: ["p1", "p2"], extraInstructions: "custom" };
    const result = applyComplexity(base, "simple");
    expect(result.priorities).toEqual(["p1", "p2"]);
    expect(result.extraInstructions).toBe("custom");
  });

  it("explicit sizeLimits.skill in base config takes priority over complexity", () => {
    const base = { sizeLimits: { skill: 3000 } };
    const result = applyComplexity(base, "simple");
    // explicit 3000 wins over complexity-derived 500
    expect(result.sizeLimits?.skill).toBe(3000);
    expect(result).toBe(base);
  });

  it("returns base unchanged when complexity is undefined and sizeLimits.skill is set", () => {
    const base = { sizeLimits: { skill: 1500 } };
    const result = applyComplexity(base, undefined);
    expect(result).toBe(base);
  });
});

describe("handleDistill — complexity integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `distill-complexity-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupRegistry(id: string, binary: string, complexity?: string): string {
    const regPath = path.join(tmpDir, "registry.yaml");
    const complexityLine = complexity ? `    complexity: ${complexity}\n` : "";
    writeFileSync(regPath, `version: 1\ntools:\n  - id: ${id}\n    binary: ${binary}\n${complexityLine}`);
    return regPath;
  }

  function setupRawDocs(toolId: string): string {
    const docsDir = path.join(tmpDir, "docs");
    mkdirSync(path.join(docsDir, toolId), { recursive: true });
    writeFileSync(path.join(docsDir, toolId, "tool.md"), `# ${toolId}\n\nDocs for ${toolId}`);
    return docsDir;
  }

  it("passes skill limit 500 to distillFn for simple tools", async () => {
    const docsDir = setupRawDocs("jq");
    const regPath = setupRegistry("jq", "jq", "simple");
    const captured: DistillOptions[] = [];

    const mockDistill = async (opts: DistillOptions): Promise<DistillResult> => {
      captured.push(opts);
      return { toolId: opts.toolId, outDir: opts.outDir };
    };

    await handleDistill({ docs: docsDir, out: path.join(tmpDir, "skills"), registry: regPath }, undefined, mockDistill);

    expect(captured).toHaveLength(1);
    expect(captured[0].promptConfig?.sizeLimits?.skill).toBe(500);
  });

  it("passes skill limit 1000 to distillFn for complex tools", async () => {
    const docsDir = setupRawDocs("gh");
    const regPath = setupRegistry("gh", "gh", "complex");
    const captured: DistillOptions[] = [];

    const mockDistill = async (opts: DistillOptions): Promise<DistillResult> => {
      captured.push(opts);
      return { toolId: opts.toolId, outDir: opts.outDir };
    };

    await handleDistill({ docs: docsDir, out: path.join(tmpDir, "skills"), registry: regPath }, undefined, mockDistill);

    expect(captured).toHaveLength(1);
    expect(captured[0].promptConfig?.sizeLimits?.skill).toBe(1000);
  });

  it("passes no explicit skill limit to distillFn when complexity is omitted", async () => {
    const docsDir = setupRawDocs("rg");
    const regPath = setupRegistry("rg", "rg");
    const captured: DistillOptions[] = [];

    const mockDistill = async (opts: DistillOptions): Promise<DistillResult> => {
      captured.push(opts);
      return { toolId: opts.toolId, outDir: opts.outDir };
    };

    await handleDistill({ docs: docsDir, out: path.join(tmpDir, "skills"), registry: regPath }, undefined, mockDistill);

    expect(captured).toHaveLength(1);
    expect(captured[0].promptConfig?.sizeLimits?.skill).toBeUndefined();
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
    expect(errorOutput).toContain("skilldoc generate nonexistent");
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
      sizeWarnings: ["SKILL.md is 1100 tokens (limit: 1000 tokens)"],
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

describe("bin/skilldoc.js distill <tool-id> (integration)", () => {
  const binPath = path.resolve(import.meta.dir, "../bin/skilldoc.js");
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
    expect(result.stderr).toContain("skilldoc generate nonexistent-tool");
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
    expect(result.stdout).toContain("skilldoc generate <tool>");
    expect(result.stdout).toContain("skilldoc generate [--registry");
  });

  it("help text shows ad-hoc and registry modes for distill", () => {
    const result = spawnSync("node", [binPath, "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("skilldoc distill <tool>");
    expect(result.stdout).toContain("skilldoc distill [--registry");
  });

  it("help text shows the run command with batch mode", () => {
    const result = spawnSync("node", [binPath, "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("skilldoc run <tool>");
    expect(result.stdout).toContain("skilldoc run [--registry");
    expect(result.stdout).toContain("run        Run full pipeline");
  });

  it("help text shows run as the recommended starting point", () => {
    const result = spawnSync("node", [binPath, "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("generate + distill + validate in one shot");
    expect(result.stdout).toContain("recommended start here");
  });

  it("help text describes init with registry path and example tools", () => {
    const result = spawnSync("node", [binPath, "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("~/.skilldoc/registry.yaml");
    expect(result.stdout).toContain("git, ripgrep");
    expect(result.stdout).toContain("batch generation for multiple tools");
  });
});

describe("handleInit", () => {
  const binPath = path.resolve(import.meta.dir, "../bin/skilldoc.js");
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `init-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("prints what was created and next steps", () => {
    const registryPath = path.join(tmpDir, "registry.yaml");
    const result = spawnSync("node", [binPath, "init", "--registry", registryPath], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Created: ${registryPath}`);
    expect(result.stdout).toContain("git, rg (2 example entries)");
    expect(result.stdout).toContain("Next steps:");
    expect(result.stdout).toContain("Edit the registry to add your tools");
    expect(result.stdout).toContain(`skilldoc run --registry ${registryPath}`);
  });

  it("creates the registry file on disk", () => {
    const registryPath = path.join(tmpDir, "registry.yaml");
    spawnSync("node", [binPath, "init", "--registry", registryPath], { encoding: "utf8" });
    expect(existsSync(registryPath)).toBe(true);
    const content = readFileSync(registryPath, "utf8");
    expect(content).toContain("id: git");
    expect(content).toContain("id: rg");
  });

  it("uses default path in output when --registry is not specified", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    try {
      await handleInit({ registry: path.join(tmpDir, "default.yaml") });
      const output = logs.join("\n");
      expect(output).toContain("Created:");
      expect(output).toContain("Next steps:");
      expect(output).toContain("skilldoc run --registry");
    } finally {
      console.log = origLog;
    }
  });

  it("exits with error if registry already exists", () => {
    const registryPath = path.join(tmpDir, "registry.yaml");
    writeFileSync(registryPath, "existing");
    const result = spawnSync("node", [binPath, "init", "--registry", registryPath], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Registry already exists:");
  });

  it("overwrites existing registry with --force", () => {
    const registryPath = path.join(tmpDir, "registry.yaml");
    writeFileSync(registryPath, "old content");
    const result = spawnSync("node", [binPath, "init", "--registry", registryPath, "--force"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Created: ${registryPath}`);
    const content = readFileSync(registryPath, "utf8");
    expect(content).toContain("id: git");
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

  it("prints score and suggests --auto-redist on validation failure", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };

    const deps = makeDeps({
      validateFn: async ({ toolId }) => makeFailingReport(toolId),
    });

    try {
      await handleRun("mytool", { skills: path.join(tmpDir, "skills") }, deps);
    } finally {
      console.log = origLog;
    }

    expect(logs.some((l) => l.includes("Validation failed") && l.includes("6.0"))).toBe(true);
    expect(logs.some((l) => l.includes("--auto-redist"))).toBe(true);
  });
});

describe("bin/skilldoc.js run (integration)", () => {
  const binPath = path.resolve(import.meta.dir, "../bin/skilldoc.js");

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

describe("generateCommandDocs - recursive subcommand detection", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `subcommand-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  type RunFnResult = { output: string; exitCode: number | null };

  function makeRunFn(responses: Record<string, string>): (binary: string, args: string[]) => RunFnResult {
    return (_binary, args) => ({
      output: responses[args.join(" ")] ?? "",
      exitCode: 0,
    });
  }

  it("generates subcommand docs when a command has subcommands", async () => {
    const toolDir = path.join(tmpDir, "mytool");
    mkdirSync(toolDir, { recursive: true });

    const runFn = makeRunFn({
      "--help remote": "Commands:\n  add     Add a remote\n  remove  Remove a remote\n",
      "remote add --help": "Usage: mytool remote add <name> <url>\n",
      "remote remove --help": "Usage: mytool remote remove <name>\n",
    });

    await generateCommandDocs(
      "mytool", "mytool-bin",
      ["--help", "{command}"],
      [{ name: "remote", summary: "Manage remotes" }],
      toolDir, runFn
    );

    const remoteDir = path.join(toolDir, "commands", "remote");
    expect(existsSync(remoteDir)).toBe(true);
    expect(existsSync(path.join(remoteDir, "command.json"))).toBe(true);

    expect(existsSync(path.join(remoteDir, "add", "command.json"))).toBe(true);
    expect(existsSync(path.join(remoteDir, "remove", "command.json"))).toBe(true);
  });

  it("parent command doc has subcommands field with docPaths", async () => {
    const toolDir = path.join(tmpDir, "mytool");
    mkdirSync(toolDir, { recursive: true });

    const runFn = makeRunFn({
      "--help remote": "Commands:\n  add  Add a remote\n",
      "remote add --help": "Usage: mytool remote add <name>\n",
    });

    await generateCommandDocs(
      "mytool", "mytool-bin",
      ["--help", "{command}"],
      [{ name: "remote", summary: "Manage remotes" }],
      toolDir, runFn
    );

    const doc = JSON.parse(readFileSync(path.join(toolDir, "commands", "remote", "command.json"), "utf8"));
    expect(doc.subcommands).toBeDefined();
    expect(doc.subcommands).toHaveLength(1);
    expect(doc.subcommands[0].name).toBe("add");
    expect(doc.subcommands[0].docPath).toBe("add/command.md");
  });

  it("subcommand doc has full command path in command field", async () => {
    const toolDir = path.join(tmpDir, "mytool");
    mkdirSync(toolDir, { recursive: true });

    const runFn = makeRunFn({
      "--help remote": "Commands:\n  add  Add a remote\n",
      "remote add --help": "Usage: mytool remote add\n",
    });

    await generateCommandDocs(
      "mytool", "mytool-bin",
      ["--help", "{command}"],
      [{ name: "remote", summary: "Manage remotes" }],
      toolDir, runFn
    );

    const subDoc = JSON.parse(readFileSync(
      path.join(toolDir, "commands", "remote", "add", "command.json"),
      "utf8"
    ));
    expect(subDoc.command).toBe("remote add");
  });

  it("command without subcommands has no subcommands field", async () => {
    const toolDir = path.join(tmpDir, "mytool");
    mkdirSync(toolDir, { recursive: true });

    const runFn = makeRunFn({
      "--help push": "Usage: mytool push [options]\n",
    });

    await generateCommandDocs(
      "mytool", "mytool-bin",
      ["--help", "{command}"],
      [{ name: "push", summary: "Push changes" }],
      toolDir, runFn
    );

    const doc = JSON.parse(readFileSync(path.join(toolDir, "commands", "push", "command.json"), "utf8"));
    expect(doc.subcommands).toBeUndefined();
  });

  it("subcommand help is invoked as [parentCmd, subCmd, --help]", async () => {
    const toolDir = path.join(tmpDir, "mytool");
    mkdirSync(toolDir, { recursive: true });

    const capturedCalls: Array<string[]> = [];
    const runFn = (_binary: string, args: string[]): RunFnResult => {
      capturedCalls.push(args);
      if (args.join(" ") === "--help remote") {
        return { output: "Commands:\n  add  Add a remote\n", exitCode: 0 };
      }
      return { output: "", exitCode: 0 };
    };

    await generateCommandDocs(
      "mytool", "mytool-bin",
      ["--help", "{command}"],
      [{ name: "remote", summary: "Manage remotes" }],
      toolDir, runFn
    );

    const subCmdCall = capturedCalls.find((args) => args.includes("add"));
    expect(subCmdCall).toBeDefined();
    expect(subCmdCall).toEqual(["remote", "add", "--help"]);
  });

  it("recursively generates sub-subcommand docs", async () => {
    const toolDir = path.join(tmpDir, "mytool");
    mkdirSync(toolDir, { recursive: true });

    const runFn = makeRunFn({
      "--help remote": "Commands:\n  add  Add a remote\n",
      "remote add --help": "Commands:\n  branch  Add with branch tracking\n",
      "remote add branch --help": "Usage: mytool remote add branch\n",
    });

    await generateCommandDocs(
      "mytool", "mytool-bin",
      ["--help", "{command}"],
      [{ name: "remote", summary: "Manage remotes" }],
      toolDir, runFn
    );

    // Check sub-subcommand doc exists
    const subSubDir = path.join(
      toolDir, "commands", "remote", "add", "branch"
    );
    expect(existsSync(path.join(subSubDir, "command.json"))).toBe(true);

    const subSubDoc = JSON.parse(readFileSync(path.join(subSubDir, "command.json"), "utf8"));
    expect(subSubDoc.command).toBe("remote add branch");
  });

  it("sub-subcommand help is invoked as [grandparent, parent, subCmd, --help]", async () => {
    const toolDir = path.join(tmpDir, "mytool");
    mkdirSync(toolDir, { recursive: true });

    const capturedCalls: Array<string[]> = [];
    const runFn = (_binary: string, args: string[]): RunFnResult => {
      capturedCalls.push(args);
      if (args.join(" ") === "--help remote") {
        return { output: "Commands:\n  add  Add a remote\n", exitCode: 0 };
      }
      if (args.join(" ") === "remote add --help") {
        return { output: "Commands:\n  branch  With branch\n", exitCode: 0 };
      }
      return { output: "", exitCode: 0 };
    };

    await generateCommandDocs(
      "mytool", "mytool-bin",
      ["--help", "{command}"],
      [{ name: "remote", summary: "Manage remotes" }],
      toolDir, runFn
    );

    const subSubCall = capturedCalls.find((args) => args.includes("branch"));
    expect(subSubCall).toBeDefined();
    expect(subSubCall).toEqual(["remote", "add", "branch", "--help"]);
  });

  it("top-level command doc has single-word command field", async () => {
    const toolDir = path.join(tmpDir, "mytool");
    mkdirSync(toolDir, { recursive: true });

    const runFn = makeRunFn({ "--help push": "Usage: mytool push\n" });

    await generateCommandDocs(
      "mytool", "mytool-bin",
      ["--help", "{command}"],
      [{ name: "push", summary: "Push" }],
      toolDir, runFn
    );

    const doc = JSON.parse(readFileSync(path.join(toolDir, "commands", "push", "command.json"), "utf8"));
    expect(doc.command).toBe("push");
  });

  it("command.md includes Subcommands section when subcommands are present", async () => {
    const toolDir = path.join(tmpDir, "mytool");
    mkdirSync(toolDir, { recursive: true });

    const runFn = makeRunFn({
      "--help remote": "Commands:\n  add  Add a remote\n",
      "remote add --help": "",
    });

    await generateCommandDocs(
      "mytool", "mytool-bin",
      ["--help", "{command}"],
      [{ name: "remote", summary: "Manage remotes" }],
      toolDir, runFn
    );

    const md = readFileSync(path.join(toolDir, "commands", "remote", "command.md"), "utf8");
    expect(md).toContain("## Subcommands");
    expect(md).toContain("add");
  });

  it("does not recurse beyond DEFAULT_MAX_DEPTH", async () => {
    const toolDir = path.join(tmpDir, "mytool");
    mkdirSync(toolDir, { recursive: true });

    // Build a deeply nested command chain that would infinitely recurse
    const capturedCalls: Array<string[]> = [];
    const runFn = (_binary: string, args: string[]): RunFnResult => {
      capturedCalls.push(args);
      // Always return a subcommand named "deep" to trigger recursion
      return { output: "Commands:\n  deep  Go deeper\n", exitCode: 0 };
    };

    await generateCommandDocs(
      "mytool", "mytool-bin",
      ["--help", "{command}"],
      [{ name: "cmd", summary: "A command" }],
      toolDir, runFn
    );

    // With DEFAULT_MAX_DEPTH = 2, we should have exactly 3 calls:
    // depth 0: "--help cmd"
    // depth 1: "cmd deep --help"
    // depth 2: "cmd deep deep --help"  (depth 2 = last level, no further recursion)
    expect(capturedCalls.length).toBe(DEFAULT_MAX_DEPTH + 1);
  });

  it("respects a custom maxDepth from the registry entry", async () => {
    const toolDir = path.join(tmpDir, "mytool");
    mkdirSync(toolDir, { recursive: true });

    const capturedCalls: Array<string[]> = [];
    const runFn = (_binary: string, args: string[]): RunFnResult => {
      capturedCalls.push(args);
      return { output: "Commands:\n  deep  Go deeper\n", exitCode: 0 };
    };

    // maxDepth = 1: depth 0 recurses (0 < 1), depth 1 stops (1 >= 1)
    // Total calls: 2 (level 0 + level 1 generated, no deeper)
    await generateCommandDocs(
      "mytool", "mytool-bin",
      ["--help", "{command}"],
      [{ name: "cmd", summary: "A command" }],
      toolDir, runFn, 1
    );

    expect(capturedCalls.length).toBe(2);
  });

  it("allows deeper recursion with maxDepth = 4", async () => {
    const toolDir = path.join(tmpDir, "mytool-deep");
    mkdirSync(toolDir, { recursive: true });

    const capturedCalls: Array<string[]> = [];
    const runFn = (_binary: string, args: string[]): RunFnResult => {
      capturedCalls.push(args);
      return { output: "Commands:\n  deep  Go deeper\n", exitCode: 0 };
    };

    await generateCommandDocs(
      "mytool", "mytool-bin",
      ["--help", "{command}"],
      [{ name: "cmd", summary: "A command" }],
      toolDir, runFn, 4
    );

    // depth 0 through depth 4 = 5 calls total
    expect(capturedCalls.length).toBe(5);
  });
});

describe("generateCommandDocs - 2-level nested subcommand docs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `nested2-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  type RunFnResult = { output: string; exitCode: number | null };

  function makeRunFn(responses: Record<string, string>): (binary: string, args: string[]) => RunFnResult {
    return (_binary, args) => ({
      output: responses[args.join(" ")] ?? "",
      exitCode: 0,
    });
  }

  it("creates command.json, command.yaml, and command.md for both depth-1 and depth-2 subcommands", async () => {
    const toolDir = path.join(tmpDir, "mytool");
    mkdirSync(toolDir, { recursive: true });

    const runFn = makeRunFn({
      "--help remote": "Commands:\n  add     Add a remote\n  remove  Remove a remote\n",
      "remote add --help": "Usage: mytool remote add <name> <url>\n",
      "remote remove --help": "Usage: mytool remote remove <name>\n",
    });

    await generateCommandDocs(
      "mytool", "mytool-bin",
      ["--help", "{command}"],
      [{ name: "remote", summary: "Manage remotes" }],
      toolDir, runFn
    );

    const remoteDir = path.join(toolDir, "commands", "remote");
    expect(existsSync(path.join(remoteDir, "command.json"))).toBe(true);
    expect(existsSync(path.join(remoteDir, "command.yaml"))).toBe(true);
    expect(existsSync(path.join(remoteDir, "command.md"))).toBe(true);

    const addDir = path.join(remoteDir, "add");
    expect(existsSync(path.join(addDir, "command.json"))).toBe(true);
    expect(existsSync(path.join(addDir, "command.yaml"))).toBe(true);
    expect(existsSync(path.join(addDir, "command.md"))).toBe(true);

    const removeDir = path.join(remoteDir, "remove");
    expect(existsSync(path.join(removeDir, "command.json"))).toBe(true);
    expect(existsSync(path.join(removeDir, "command.yaml"))).toBe(true);
    expect(existsSync(path.join(removeDir, "command.md"))).toBe(true);
  });

  it("depth-1 command doc lists both depth-2 subcommands with correct docPaths", async () => {
    const toolDir = path.join(tmpDir, "mytool");
    mkdirSync(toolDir, { recursive: true });

    const runFn = makeRunFn({
      "--help remote": "Commands:\n  add     Add a remote\n  remove  Remove a remote\n",
      "remote add --help": "Usage: mytool remote add <name>\n",
      "remote remove --help": "Usage: mytool remote remove <name>\n",
    });

    await generateCommandDocs(
      "mytool", "mytool-bin",
      ["--help", "{command}"],
      [{ name: "remote", summary: "Manage remotes" }],
      toolDir, runFn
    );

    const remoteDoc = JSON.parse(
      readFileSync(path.join(toolDir, "commands", "remote", "command.json"), "utf8")
    );
    expect(remoteDoc.subcommands).toHaveLength(2);

    const names = remoteDoc.subcommands.map((s: { name: string }) => s.name);
    expect(names).toContain("add");
    expect(names).toContain("remove");

    const addEntry = remoteDoc.subcommands.find((s: { name: string }) => s.name === "add");
    expect(addEntry.docPath).toBe("add/command.md");
    const removeEntry = remoteDoc.subcommands.find((s: { name: string }) => s.name === "remove");
    expect(removeEntry.docPath).toBe("remove/command.md");
  });

  it("depth-2 command docs have the full 2-word command path", async () => {
    const toolDir = path.join(tmpDir, "mytool");
    mkdirSync(toolDir, { recursive: true });

    const runFn = makeRunFn({
      "--help remote": "Commands:\n  add  Add a remote\n  remove  Remove a remote\n",
      "remote add --help": "Usage: mytool remote add\n",
      "remote remove --help": "Usage: mytool remote remove\n",
    });

    await generateCommandDocs(
      "mytool", "mytool-bin",
      ["--help", "{command}"],
      [{ name: "remote", summary: "Manage remotes" }],
      toolDir, runFn
    );

    const addDoc = JSON.parse(
      readFileSync(path.join(toolDir, "commands", "remote", "add", "command.json"), "utf8")
    );
    expect(addDoc.command).toBe("remote add");

    const removeDoc = JSON.parse(
      readFileSync(path.join(toolDir, "commands", "remote", "remove", "command.json"), "utf8")
    );
    expect(removeDoc.command).toBe("remote remove");
  });

  it("depth-2 command docs have no subcommands field when they are leaf commands", async () => {
    const toolDir = path.join(tmpDir, "mytool");
    mkdirSync(toolDir, { recursive: true });

    const runFn = makeRunFn({
      "--help remote": "Commands:\n  add  Add a remote\n",
      "remote add --help": "Usage: mytool remote add <name>\n",
    });

    await generateCommandDocs(
      "mytool", "mytool-bin",
      ["--help", "{command}"],
      [{ name: "remote", summary: "Manage remotes" }],
      toolDir, runFn
    );

    const addDoc = JSON.parse(
      readFileSync(path.join(toolDir, "commands", "remote", "add", "command.json"), "utf8")
    );
    expect(addDoc.subcommands).toBeUndefined();
  });

  it("depth-2 command docs record correct toolId, binary, and kind", async () => {
    const toolDir = path.join(tmpDir, "gh");
    mkdirSync(toolDir, { recursive: true });

    const runFn = makeRunFn({
      "--help auth": "Commands:\n  login  Log in\n",
      "auth login --help": "Usage: gh auth login\n",
    });

    await generateCommandDocs(
      "gh", "gh",
      ["--help", "{command}"],
      [{ name: "auth", summary: "Authenticate" }],
      toolDir, runFn
    );

    const loginDoc = JSON.parse(
      readFileSync(path.join(toolDir, "commands", "auth", "login", "command.json"), "utf8")
    );
    expect(loginDoc.kind).toBe("command");
    expect(loginDoc.toolId).toBe("gh");
    expect(loginDoc.binary).toBe("gh");
  });

  it("depth-2 command.md is non-empty and contains the command path", async () => {
    const toolDir = path.join(tmpDir, "mytool");
    mkdirSync(toolDir, { recursive: true });

    const runFn = makeRunFn({
      "--help remote": "Commands:\n  add  Add a remote\n",
      "remote add --help": "Usage: mytool remote add <name> <url>\n  -v, --verbose  Verbose output\n",
    });

    await generateCommandDocs(
      "mytool", "mytool-bin",
      ["--help", "{command}"],
      [{ name: "remote", summary: "Manage remotes" }],
      toolDir, runFn
    );

    const md = readFileSync(path.join(toolDir, "commands", "remote", "add", "command.md"), "utf8");
    expect(md.length).toBeGreaterThan(0);
    expect(md).toContain("remote add");
  });
});

describe("hasSubcommandKeyword", () => {
  it("returns true for descriptions containing 'Manage'", () => {
    expect(hasSubcommandKeyword("Manage repositories")).toBe(true);
  });

  it("returns true for descriptions containing 'manage' (lowercase)", () => {
    expect(hasSubcommandKeyword("manage authentication")).toBe(true);
  });

  it("returns true for descriptions containing 'MANAGE' (uppercase)", () => {
    expect(hasSubcommandKeyword("MANAGE repositories")).toBe(true);
  });

  it("returns true for descriptions containing 'Control'", () => {
    expect(hasSubcommandKeyword("Control access settings")).toBe(true);
  });

  it("returns true for descriptions containing 'control' (lowercase)", () => {
    expect(hasSubcommandKeyword("control deployments")).toBe(true);
  });

  it("returns false for unrelated descriptions", () => {
    expect(hasSubcommandKeyword("Push changes to remote")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(hasSubcommandKeyword("")).toBe(false);
  });

  it("returns false for 'management' (word boundary — 'manage' not standalone)", () => {
    expect(hasSubcommandKeyword("management tools")).toBe(false);
  });

  it("returns false for 'uncontrolled' (word boundary — 'control' not standalone)", () => {
    expect(hasSubcommandKeyword("uncontrolled input")).toBe(false);
  });

  it("returns false for descriptions with neither keyword", () => {
    expect(hasSubcommandKeyword("Clone a repository")).toBe(false);
    expect(hasSubcommandKeyword("Show current status")).toBe(false);
  });
});

describe("identifySubcommandCandidates — text heuristic only", () => {
  it("returns commands with 'Manage' in description", () => {
    const commands = [
      { name: "auth", summary: "Manage authentication" },
      { name: "push", summary: "Push to remote" },
    ];
    const result = identifySubcommandCandidates(commands);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("auth");
  });

  it("returns commands with 'Control' in description", () => {
    const commands = [
      { name: "access", summary: "Control access settings" },
      { name: "pull", summary: "Pull changes" },
    ];
    const result = identifySubcommandCandidates(commands);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("access");
  });

  it("returns all commands matching the text heuristic", () => {
    const commands = [
      { name: "auth", summary: "Manage authentication" },
      { name: "repo", summary: "Manage repositories" },
      { name: "push", summary: "Push to remote" },
    ];
    const result = identifySubcommandCandidates(commands);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.name)).toContain("auth");
    expect(result.map((c) => c.name)).toContain("repo");
  });

  it("returns empty array when no commands match", () => {
    const commands = [
      { name: "push", summary: "Push changes" },
      { name: "pull", summary: "Pull changes" },
    ];
    expect(identifySubcommandCandidates(commands)).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(identifySubcommandCandidates([])).toHaveLength(0);
  });
});

describe("identifySubcommandCandidates — runtime heuristic", () => {
  type RunFnResult = { output: string; exitCode: number | null };

  it("returns commands whose --help output lists subcommands", () => {
    const commands = [
      { name: "auth", summary: "Authentication commands" },
      { name: "push", summary: "Push to remote" },
    ];
    const runFn: RunFn = (_binary, args) => {
      if (args[0] === "auth") {
        return { output: "Commands:\n  login   Log in\n  logout  Log out\n", exitCode: 0 };
      }
      return { output: "", exitCode: 0 };
    };
    const result = identifySubcommandCandidates(commands, "mytool", runFn);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("auth");
  });

  it("combines text and runtime heuristics without duplicates", () => {
    const commands = [
      { name: "auth", summary: "Manage authentication" },  // text match
      { name: "remote", summary: "Remote operations" },    // runtime match
      { name: "push", summary: "Push changes" },           // no match
    ];
    const runFn: RunFn = (_binary, args) => {
      if (args[0] === "remote") {
        return { output: "Commands:\n  add  Add a remote\n", exitCode: 0 };
      }
      return { output: "", exitCode: 0 };
    };
    const result = identifySubcommandCandidates(commands, "mytool", runFn);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.name)).toContain("auth");
    expect(result.map((c) => c.name)).toContain("remote");
  });

  it("does not call runFn for commands already matched by text heuristic", () => {
    const commands = [{ name: "auth", summary: "Manage authentication" }];
    const calls: string[] = [];
    const runFn: RunFn = (_binary, args) => {
      calls.push(args[0]);
      return { output: "", exitCode: 0 };
    };
    identifySubcommandCandidates(commands, "mytool", runFn);
    // "auth" matched by text heuristic — runFn should not be called for it
    expect(calls).not.toContain("auth");
  });

  it("returns empty array when no commands match either heuristic", () => {
    const commands = [
      { name: "push", summary: "Push changes" },
      { name: "pull", summary: "Pull changes" },
    ];
    const runFn: RunFn = (_binary, _args) => ({ output: "", exitCode: 0 });
    expect(identifySubcommandCandidates(commands, "mytool", runFn)).toHaveLength(0);
  });

  it("invokes runFn with binary and [cmd.name, '--help']", () => {
    const commands = [{ name: "auth", summary: "Authentication" }];
    const capturedCalls: Array<{ binary: string; args: string[] }> = [];
    const runFn: RunFn = (binary, args) => {
      capturedCalls.push({ binary, args });
      return { output: "Commands:\n  login  Log in\n", exitCode: 0 };
    };
    identifySubcommandCandidates(commands, "mycli", runFn);
    expect(capturedCalls).toHaveLength(1);
    expect(capturedCalls[0].binary).toBe("mycli");
    expect(capturedCalls[0].args).toEqual(["auth", "--help"]);
  });

  it("falls back gracefully when runFn returns empty output", () => {
    const commands = [{ name: "push", summary: "Push changes" }];
    const runFn: RunFn = (_binary, _args) => ({ output: "", exitCode: 1 });
    const result = identifySubcommandCandidates(commands, "mytool", runFn);
    expect(result).toHaveLength(0);
  });

  it("ignores command-like lines when no Commands/Subcommands section exists", () => {
    const commands = [{ name: "auth", summary: "Authentication" }];
    const runFn: RunFn = (_binary, _args) => ({
      output: "Usage: mytool auth\n  login  Log in\n  logout  Log out\n",
      exitCode: 0,
    });
    expect(identifySubcommandCandidates(commands, "mytool", runFn)).toHaveLength(0);
  });

  it("accepts Subcommands section in runtime help output", () => {
    const commands = [{ name: "auth", summary: "Authentication" }];
    const runFn: RunFn = (_binary, _args) => ({
      output: "Subcommands:\n  login  Log in\n  logout  Log out\n",
      exitCode: 0,
    });
    const result = identifySubcommandCandidates(commands, "mytool", runFn);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("auth");
  });
});

describe("detectCommandHelpArgs", () => {
  it("probes patterns in order and returns the first matching pattern", () => {
    const calls: string[] = [];
    const runFn: RunFn = (_binary, args) => {
      const key = args.join(" ");
      calls.push(key);
      if (key === "remote -h") {
        return { output: "Commands:\n  add  Add remote\n", exitCode: 0 };
      }
      return { output: "Usage: mycli", exitCode: 0 };
    };

    const result = detectCommandHelpArgs("mycli", [{ name: "remote", summary: "Manage remotes" }], runFn);
    expect(result).toEqual(["{command}", "-h"]);
    expect(calls).toEqual(["remote --help", "remote -h"]);
  });

  it("returns undefined when no pattern yields subcommands", () => {
    const calls: string[] = [];
    const runFn: RunFn = (_binary, args) => {
      calls.push(args.join(" "));
      return { output: "Usage: mycli", exitCode: 0 };
    };

    const result = detectCommandHelpArgs("mycli", [{ name: "push", summary: "Manage pushes" }], runFn);
    expect(result).toBeUndefined();
    expect(calls).toEqual(["push --help", "push -h", "help push"]);
  });

  it("selects the first pattern with Commands/Subcommands section", () => {
    const calls: string[] = [];
    const runFn: RunFn = (_binary, args) => {
      const key = args.join(" ");
      calls.push(key);
      if (key === "remote --help") {
        return { output: "Usage: mycli remote\n  add  Add remote\n", exitCode: 0 };
      }
      if (key === "remote -h") {
        return { output: "Subcommands:\n  add  Add remote\n", exitCode: 0 };
      }
      return { output: "Usage: mycli", exitCode: 0 };
    };

    const result = detectCommandHelpArgs("mycli", [{ name: "remote", summary: "Manage remotes" }], runFn);
    expect(result).toEqual(["{command}", "-h"]);
    expect(calls).toEqual(["remote --help", "remote -h"]);
  });
});
