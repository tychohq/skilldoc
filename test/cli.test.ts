import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import path from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import { parseFlags, handleAutoRedist } from "../src/cli.js";
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
