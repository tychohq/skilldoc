import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import path from "node:path";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import { parseDistilledOutput, callLLM, distillTool, LLMCaller } from "../src/distill.js";

// Minimal valid LLM output
const validJson = JSON.stringify({
  skill: "# rg\n\nSearch files",
  advanced: "## Advanced\n\nPCRE2 flags",
  recipes: "## Recipes\n\nSearch Python files",
  troubleshooting: "## Troubleshooting\n\nQuoting issues",
});

const mockOk = () => ({ stdout: validJson, stderr: "", status: 0 });

describe("parseDistilledOutput", () => {
  it("parses valid JSON output", () => {
    const result = parseDistilledOutput(validJson);
    expect(result.skill).toContain("# rg");
    expect(result.advanced).toContain("Advanced");
    expect(result.recipes).toContain("Recipes");
    expect(result.troubleshooting).toContain("Troubleshooting");
  });

  it("strips markdown fences from JSON output", () => {
    const input = `\`\`\`json\n${validJson}\n\`\`\``;
    const result = parseDistilledOutput(input);
    expect(result.skill).toContain("# rg");
  });

  it("strips plain fences from JSON output", () => {
    const input = `\`\`\`\n${validJson}\n\`\`\``;
    const result = parseDistilledOutput(input);
    expect(result.skill).toContain("# rg");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseDistilledOutput("not json")).toThrow("Failed to parse LLM output as JSON");
  });

  it("throws on missing required keys", () => {
    expect(() => parseDistilledOutput(JSON.stringify({ skill: "# rg" }))).toThrow(
      "LLM output missing required key"
    );
  });

  it("throws on non-object JSON", () => {
    expect(() => parseDistilledOutput('"just a string"')).toThrow("LLM output is not a JSON object");
  });

  it("throws on null JSON", () => {
    expect(() => parseDistilledOutput("null")).toThrow("LLM output is not a JSON object");
  });
});

describe("callLLM", () => {
  it("returns parsed content on success", () => {
    const result = callLLM("raw docs", "rg", "model", mockOk);
    expect(result.skill).toContain("# rg");
    expect(result.advanced).toContain("PCRE2");
    expect(result.recipes).toContain("Python");
    expect(result.troubleshooting).toContain("Quoting");
  });

  it("passes the model to claude args", () => {
    let capturedArgs: ReadonlyArray<string> = [];
    const exec = (_cmd: string, args: ReadonlyArray<string>) => {
      capturedArgs = args;
      return { stdout: validJson, stderr: "", status: 0 };
    };
    callLLM("docs", "tool", "my-test-model", exec);
    expect(capturedArgs).toContain("--model");
    expect(capturedArgs).toContain("my-test-model");
  });

  it("passes prompt via stdin input option", () => {
    let capturedInput = "";
    const exec = (_cmd: string, _args: ReadonlyArray<string>, opts: { input: string }) => {
      capturedInput = opts.input;
      return { stdout: validJson, stderr: "", status: 0 };
    };
    callLLM("my raw docs content", "tool", "model", exec);
    expect(capturedInput).toContain("my raw docs content");
  });

  it("includes the toolId in the prompt sent to claude", () => {
    let capturedInput = "";
    const exec = (_cmd: string, _args: ReadonlyArray<string>, opts: { input: string }) => {
      capturedInput = opts.input;
      return { stdout: validJson, stderr: "", status: 0 };
    };
    callLLM("docs", "my-special-tool", "model", exec);
    expect(capturedInput).toContain("my-special-tool");
  });

  it("prompt includes SKILL.md format spec with Quick Reference, Key Commands, Common Patterns", () => {
    let capturedInput = "";
    const exec = (_cmd: string, _args: ReadonlyArray<string>, opts: { input: string }) => {
      capturedInput = opts.input;
      return { stdout: validJson, stderr: "", status: 0 };
    };
    callLLM("docs", "tool", "model", exec);
    expect(capturedInput).toContain("## Quick Reference");
    expect(capturedInput).toContain("## Key Commands / Flags");
    expect(capturedInput).toContain("## Common Patterns");
  });

  it("prompt includes advanced.md format spec with Power-User Flags and Edge Cases", () => {
    let capturedInput = "";
    const exec = (_cmd: string, _args: ReadonlyArray<string>, opts: { input: string }) => {
      capturedInput = opts.input;
      return { stdout: validJson, stderr: "", status: 0 };
    };
    callLLM("docs", "tool", "model", exec);
    expect(capturedInput).toContain("docs/advanced.md format");
    expect(capturedInput).toContain("## Power-User Flags");
    expect(capturedInput).toContain("## Edge Cases");
  });

  it("prompt includes recipes.md format spec with task-oriented structure", () => {
    let capturedInput = "";
    const exec = (_cmd: string, _args: ReadonlyArray<string>, opts: { input: string }) => {
      capturedInput = opts.input;
      return { stdout: validJson, stderr: "", status: 0 };
    };
    callLLM("docs", "tool", "model", exec);
    expect(capturedInput).toContain("docs/recipes.md format");
    expect(capturedInput).toContain("task-oriented recipes");
  });

  it("prompt includes troubleshooting.md format spec with Symptom/Fix structure and LLM Mistakes", () => {
    let capturedInput = "";
    const exec = (_cmd: string, _args: ReadonlyArray<string>, opts: { input: string }) => {
      capturedInput = opts.input;
      return { stdout: validJson, stderr: "", status: 0 };
    };
    callLLM("docs", "tool", "model", exec);
    expect(capturedInput).toContain("docs/troubleshooting.md format");
    expect(capturedInput).toContain("**Symptom:**");
    expect(capturedInput).toContain("**Fix:**");
    expect(capturedInput).toContain("## Common LLM Mistakes");
  });

  it("prompt identifies SKILL.md as the most important file", () => {
    let capturedInput = "";
    const exec = (_cmd: string, _args: ReadonlyArray<string>, opts: { input: string }) => {
      capturedInput = opts.input;
      return { stdout: validJson, stderr: "", status: 0 };
    };
    callLLM("docs", "tool", "model", exec);
    expect(capturedInput).toContain("SKILL.md is the most important");
  });

  it("prompt includes per-file byte limits including 1000-byte limit for troubleshooting", () => {
    let capturedInput = "";
    const exec = (_cmd: string, _args: ReadonlyArray<string>, opts: { input: string }) => {
      capturedInput = opts.input;
      return { stdout: validJson, stderr: "", status: 0 };
    };
    callLLM("docs", "tool", "model", exec);
    expect(capturedInput).toContain("≤ 2000 bytes");
    expect(capturedInput).toContain("≤ 1000 bytes");
  });

  it("prompt instructs to prioritize most-used flags first with 80/20 rule", () => {
    let capturedInput = "";
    const exec = (_cmd: string, _args: ReadonlyArray<string>, opts: { input: string }) => {
      capturedInput = opts.input;
      return { stdout: validJson, stderr: "", status: 0 };
    };
    callLLM("docs", "tool", "model", exec);
    expect(capturedInput).toContain("Most-used flags/commands first");
    expect(capturedInput).toContain("20%");
    expect(capturedInput).toContain("80%");
  });

  it("prompt instructs to include agent-specific gotchas", () => {
    let capturedInput = "";
    const exec = (_cmd: string, _args: ReadonlyArray<string>, opts: { input: string }) => {
      capturedInput = opts.input;
      return { stdout: validJson, stderr: "", status: 0 };
    };
    callLLM("docs", "tool", "model", exec);
    expect(capturedInput).toContain("Agent-specific gotchas");
    expect(capturedInput).toContain("quoting");
  });

  it("uses -p and --output-format text flags", () => {
    let capturedArgs: ReadonlyArray<string> = [];
    const exec = (_cmd: string, args: ReadonlyArray<string>) => {
      capturedArgs = args;
      return { stdout: validJson, stderr: "", status: 0 };
    };
    callLLM("docs", "tool", "model", exec);
    expect(capturedArgs).toContain("-p");
    expect(capturedArgs).toContain("--output-format");
    expect(capturedArgs).toContain("text");
  });

  it("throws when binary not found (exec error)", () => {
    const exec = () => ({ error: new Error("spawn ENOENT"), stdout: null, stderr: null, status: null });
    expect(() => callLLM("docs", "tool", "model", exec)).toThrow("Failed to run claude");
    expect(() => callLLM("docs", "tool", "model", exec)).toThrow("spawn ENOENT");
  });

  it("throws when claude exits with non-zero status", () => {
    const exec = () => ({ stdout: "", stderr: "Error: model not found", status: 1 });
    expect(() => callLLM("docs", "tool", "model", exec)).toThrow("claude exited with code 1");
    expect(() => callLLM("docs", "tool", "model", exec)).toThrow("model not found");
  });

  it("throws when claude returns empty output", () => {
    const exec = () => ({ stdout: "   ", stderr: "", status: 0 });
    expect(() => callLLM("docs", "tool", "model", exec)).toThrow("claude returned empty output");
  });

  it("includes stderr in empty output error when present", () => {
    const exec = () => ({ stdout: "", stderr: "some warning", status: 0 });
    expect(() => callLLM("docs", "tool", "model", exec)).toThrow("some warning");
  });
});

describe("distillTool - skip logic", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `distill-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("skips when no raw docs found", async () => {
    const outDir = path.join(tmpDir, "skills", "notool");
    const result = await distillTool({
      toolId: "notool",
      docsDir: path.join(tmpDir, "docs"),
      outDir,
      model: "claude-haiku-4-5-20251001",
    });
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toMatch(/no raw docs found/);
  });

  it("skips hand-written skill (no generated-from marker)", async () => {
    const docsDir = path.join(tmpDir, "docs");
    const toolDocsDir = path.join(docsDir, "mytool");
    mkdirSync(toolDocsDir, { recursive: true });
    writeFileSync(path.join(toolDocsDir, "tool.md"), "# mytool\n\n## Usage\nSome usage");

    const outDir = path.join(tmpDir, "skills", "mytool");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, "SKILL.md"), "# mytool\n\nHand-written skill");

    const result = await distillTool({
      toolId: "mytool",
      docsDir,
      outDir,
      model: "claude-haiku-4-5-20251001",
    });
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toMatch(/hand-written skill/);
  });

  it("proceeds when existing skill has generated-from marker", async () => {
    const docsDir = path.join(tmpDir, "docs");
    const toolDocsDir = path.join(docsDir, "mytool");
    mkdirSync(toolDocsDir, { recursive: true });
    writeFileSync(path.join(toolDocsDir, "tool.md"), "# mytool\n\n## Usage\nSome usage");

    const outDir = path.join(tmpDir, "skills", "mytool");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, "SKILL.md"), "<!--\n  generated-from: agent-tool-docs\n-->\n# mytool");

    const mockLLM: LLMCaller = () => ({
      skill: "# mytool",
      advanced: "adv",
      recipes: "rec",
      troubleshooting: "trbl",
    });

    const result = await distillTool({
      toolId: "mytool",
      docsDir,
      outDir,
      model: "test-model",
      llmCaller: mockLLM,
    });

    expect(result.skipped).toBeUndefined();
    expect(result.toolId).toBe("mytool");
  });
});

describe("distillTool - full flow", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `distill-flow-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupDocs(toolId: string, content = "# tool\n\nSome docs") {
    const docsDir = path.join(tmpDir, "docs");
    const toolDir = path.join(docsDir, toolId);
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(path.join(toolDir, "tool.md"), content);
    return docsDir;
  }

  it("writes all four output files", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const mockLLM: LLMCaller = () => ({
      skill: "# mytool\n\nQuick ref",
      advanced: "## Advanced",
      recipes: "## Recipes",
      troubleshooting: "## Troubleshooting",
    });

    await distillTool({ toolId: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

    expect(existsSync(path.join(outDir, "SKILL.md"))).toBe(true);
    expect(existsSync(path.join(outDir, "docs", "advanced.md"))).toBe(true);
    expect(existsSync(path.join(outDir, "docs", "recipes.md"))).toBe(true);
    expect(existsSync(path.join(outDir, "docs", "troubleshooting.md"))).toBe(true);
  });

  it("adds generated-from metadata header to SKILL.md", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const mockLLM: LLMCaller = () => ({
      skill: "# mytool\n\nDescription",
      advanced: "adv",
      recipes: "rec",
      troubleshooting: "trbl",
    });

    await distillTool({ toolId: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

    const content = readFileSync(path.join(outDir, "SKILL.md"), "utf8");
    expect(content).toContain("generated-from: agent-tool-docs");
    expect(content).toContain("tool-id: mytool");
    expect(content).toContain("generated-at:");
    expect(content).toContain("# mytool");
  });

  it("writes LLM content verbatim to docs/ files", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const mockLLM: LLMCaller = () => ({
      skill: "# mytool",
      advanced: "power user content here",
      recipes: "recipe content here",
      troubleshooting: "gotcha content here",
    });

    await distillTool({ toolId: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

    expect(readFileSync(path.join(outDir, "docs", "advanced.md"), "utf8")).toBe("power user content here");
    expect(readFileSync(path.join(outDir, "docs", "recipes.md"), "utf8")).toBe("recipe content here");
    expect(readFileSync(path.join(outDir, "docs", "troubleshooting.md"), "utf8")).toBe("gotcha content here");
  });

  it("passes raw tool.md content to the LLM caller", async () => {
    const docsDir = setupDocs("mytool", "# mytool\n\nThis is the raw documentation");
    const outDir = path.join(tmpDir, "skills", "mytool");

    let capturedDocs = "";
    const mockLLM: LLMCaller = (rawDocs) => {
      capturedDocs = rawDocs;
      return { skill: "s", advanced: "a", recipes: "r", troubleshooting: "t" };
    };

    await distillTool({ toolId: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

    expect(capturedDocs).toContain("This is the raw documentation");
  });

  it("includes command docs in gathered raw docs", async () => {
    const docsDir = path.join(tmpDir, "docs");
    const toolDir = path.join(docsDir, "mytool");
    const commandDir = path.join(toolDir, "commands", "install");
    mkdirSync(commandDir, { recursive: true });
    writeFileSync(path.join(toolDir, "tool.md"), "# mytool\n\nMain docs");
    writeFileSync(path.join(commandDir, "command.md"), "## install\n\nInstall a package");

    const outDir = path.join(tmpDir, "skills", "mytool");
    let capturedDocs = "";
    const mockLLM: LLMCaller = (rawDocs) => {
      capturedDocs = rawDocs;
      return { skill: "s", advanced: "a", recipes: "r", troubleshooting: "t" };
    };

    await distillTool({ toolId: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

    expect(capturedDocs).toContain("Main docs");
    expect(capturedDocs).toContain("Install a package");
  });

  it("passes the model and toolId to the LLM caller", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    let capturedModel = "";
    let capturedToolId = "";
    const mockLLM: LLMCaller = (_rawDocs, toolId, model) => {
      capturedModel = model;
      capturedToolId = toolId;
      return { skill: "s", advanced: "a", recipes: "r", troubleshooting: "t" };
    };

    await distillTool({ toolId: "mytool", docsDir, outDir, model: "claude-opus-4-6", llmCaller: mockLLM });

    expect(capturedModel).toBe("claude-opus-4-6");
    expect(capturedToolId).toBe("mytool");
  });

  it("returns toolId and outDir on success", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const mockLLM: LLMCaller = () => ({ skill: "s", advanced: "a", recipes: "r", troubleshooting: "t" });

    const result = await distillTool({ toolId: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

    expect(result.toolId).toBe("mytool");
    expect(result.outDir).toBe(outDir);
    expect(result.skipped).toBeUndefined();
  });

  it("returns no sizeWarnings when all files are within limits", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const mockLLM: LLMCaller = () => ({
      skill: "# mytool\n\nShort skill",
      advanced: "## Advanced\n\nShort",
      recipes: "## Recipes\n\nShort",
      troubleshooting: "## Troubleshooting\n\nShort",
    });

    const result = await distillTool({ toolId: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

    expect(result.sizeWarnings).toBeUndefined();
  });

  it("returns sizeWarnings when SKILL.md exceeds 2000 bytes", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const oversizedSkill = "x".repeat(2001);
    const mockLLM: LLMCaller = () => ({
      skill: oversizedSkill,
      advanced: "adv",
      recipes: "rec",
      troubleshooting: "trbl",
    });

    const result = await distillTool({ toolId: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

    expect(result.sizeWarnings).toBeDefined();
    expect(result.sizeWarnings?.some((w) => w.includes("SKILL.md"))).toBe(true);
    expect(result.sizeWarnings?.some((w) => w.includes("2000"))).toBe(true);
  });

  it("returns sizeWarnings when troubleshooting.md exceeds 1000 bytes", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const oversizedTroubleshooting = "x".repeat(1001);
    const mockLLM: LLMCaller = () => ({
      skill: "# mytool",
      advanced: "adv",
      recipes: "rec",
      troubleshooting: oversizedTroubleshooting,
    });

    const result = await distillTool({ toolId: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

    expect(result.sizeWarnings).toBeDefined();
    expect(result.sizeWarnings?.some((w) => w.includes("troubleshooting.md"))).toBe(true);
    expect(result.sizeWarnings?.some((w) => w.includes("1000"))).toBe(true);
  });

  it("reports multiple size warnings when several files exceed their limits", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const mockLLM: LLMCaller = () => ({
      skill: "x".repeat(2001),
      advanced: "x".repeat(2001),
      recipes: "rec",
      troubleshooting: "trbl",
    });

    const result = await distillTool({ toolId: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

    expect(result.sizeWarnings?.length).toBeGreaterThanOrEqual(2);
    expect(result.sizeWarnings?.some((w) => w.includes("SKILL.md"))).toBe(true);
    expect(result.sizeWarnings?.some((w) => w.includes("advanced.md"))).toBe(true);
  });
});
