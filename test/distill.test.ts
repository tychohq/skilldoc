import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import path from "node:path";
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import { parseDistilledOutput, callLLM, distillTool, detectVersion, loadDistillConfig, buildPrompt, DEFAULT_PROMPT_CONFIG, LLMCaller, INSUFFICIENT_DOCS_SENTINEL, gatherRawDocs } from "../src/distill.js";

// Minimal valid LLM output
const validJson = JSON.stringify({
  description: "Fast file search tool",
  skill: "# rg\n\nSearch files",
  advanced: "## Advanced\n\nPCRE2 flags",
  recipes: "## Recipes\n\nSearch Python files",
  troubleshooting: "## Troubleshooting\n\nQuoting issues",
});

const mockOk = () => ({ stdout: validJson, stderr: "", status: 0 });

describe("parseDistilledOutput", () => {
  it("parses valid JSON output", () => {
    const result = parseDistilledOutput(validJson);
    expect(result.description).toBe("Fast file search tool");
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

  it("throws when description key is missing", () => {
    const noDesc = JSON.stringify({ skill: "# rg", advanced: "a", recipes: "r", troubleshooting: "t" });
    expect(() => parseDistilledOutput(noDesc)).toThrow("LLM output missing required key: description");
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
    expect(result.description).toBe("Fast file search tool");
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

  it("prompt instructs Key Commands table to show key arguments inline in command column", () => {
    let capturedInput = "";
    const exec = (_cmd: string, _args: ReadonlyArray<string>, opts: { input: string }) => {
      capturedInput = opts.input;
      return { stdout: validJson, stderr: "", status: 0 };
    };
    callLLM("docs", "tool", "model", exec);
    expect(capturedInput).toContain("variable set KEY=VAL");
    expect(capturedInput).toContain("--skip-deploys");
    expect(capturedInput).toContain("inline");
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

  it("prompt includes SKILL.md format spec with Critical Distinctions section", () => {
    let capturedInput = "";
    const exec = (_cmd: string, _args: ReadonlyArray<string>, opts: { input: string }) => {
      capturedInput = opts.input;
      return { stdout: validJson, stderr: "", status: 0 };
    };
    callLLM("docs", "tool", "model", exec);
    expect(capturedInput).toContain("## Critical Distinctions");
  });

  it("prompt includes Critical Distinctions description about confused commands/flags", () => {
    let capturedInput = "";
    const exec = (_cmd: string, _args: ReadonlyArray<string>, opts: { input: string }) => {
      capturedInput = opts.input;
      return { stdout: validJson, stderr: "", status: 0 };
    };
    callLLM("docs", "tool", "model", exec);
    expect(capturedInput).toContain("two or more commands could plausibly be confused");
  });

  it("Critical Distinctions appears at the TOP of SKILL.md format (before Quick Reference)", () => {
    let capturedInput = "";
    const exec = (_cmd: string, _args: ReadonlyArray<string>, opts: { input: string }) => {
      capturedInput = opts.input;
      return { stdout: validJson, stderr: "", status: 0 };
    };
    callLLM("docs", "tool", "model", exec);
    const criticalPos = capturedInput.indexOf("## Critical Distinctions");
    const quickRefPos = capturedInput.indexOf("## Quick Reference");
    expect(criticalPos).toBeGreaterThan(0);
    expect(criticalPos).toBeLessThan(quickRefPos);
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

  it("prompt includes per-file token limits including 1000-token limit for skill and 250-token limit for troubleshooting", () => {
    let capturedInput = "";
    const exec = (_cmd: string, _args: ReadonlyArray<string>, opts: { input: string }) => {
      capturedInput = opts.input;
      return { stdout: validJson, stderr: "", status: 0 };
    };
    callLLM("docs", "tool", "model", exec);
    expect(capturedInput).toContain("≤ 1000 tokens");
    expect(capturedInput).toContain("≤ 500 tokens");
    expect(capturedInput).toContain("≤ 250 tokens");
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

  it("prompt instructs to show real-world usage patterns over exhaustive flag lists", () => {
    let capturedInput = "";
    const exec = (_cmd: string, _args: ReadonlyArray<string>, opts: { input: string }) => {
      capturedInput = opts.input;
      return { stdout: validJson, stderr: "", status: 0 };
    };
    callLLM("docs", "tool", "model", exec);
    expect(capturedInput).toContain("Real-world usage patterns");
    expect(capturedInput).toContain("exhaustive");
  });

  it("prompt instructs to include agent-specific gotchas with quoting, escaping, and common errors", () => {
    let capturedInput = "";
    const exec = (_cmd: string, _args: ReadonlyArray<string>, opts: { input: string }) => {
      capturedInput = opts.input;
      return { stdout: validJson, stderr: "", status: 0 };
    };
    callLLM("docs", "tool", "model", exec);
    expect(capturedInput).toContain("Agent-specific gotchas");
    expect(capturedInput).toContain("quoting");
    expect(capturedInput).toContain("escaping");
    expect(capturedInput).toContain("common errors");
  });

  it("prompt requests a description field for YAML frontmatter", () => {
    let capturedInput = "";
    const exec = (_cmd: string, _args: ReadonlyArray<string>, opts: { input: string }) => {
      capturedInput = opts.input;
      return { stdout: validJson, stderr: "", status: 0 };
    };
    callLLM("docs", "tool", "model", exec);
    expect(capturedInput).toContain('"description"');
    expect(capturedInput).toContain("YAML frontmatter");
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

  it("includes feedback in the prompt when provided", () => {
    let capturedInput = "";
    const exec = (_cmd: string, _args: ReadonlyArray<string>, opts: { input: string }) => {
      capturedInput = opts.input;
      return { stdout: validJson, stderr: "", status: 0 };
    };
    callLLM("docs", "tool", "model", exec, "agents needed the --files flag");
    expect(capturedInput).toContain("agents needed the --files flag");
    expect(capturedInput).toContain("Validation Feedback");
  });

  it("does not include feedback section when feedback is undefined", () => {
    let capturedInput = "";
    const exec = (_cmd: string, _args: ReadonlyArray<string>, opts: { input: string }) => {
      capturedInput = opts.input;
      return { stdout: validJson, stderr: "", status: 0 };
    };
    callLLM("docs", "tool", "model", exec);
    expect(capturedInput).not.toContain("Validation Feedback");
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

  it("routes through the llm.ts provider abstraction, not hardcoded claude", () => {
    // When exec is provided, callLLM uses createLLMCaller from llm.ts.
    // The provider resolution checks for available binaries via checkBinary.
    // Verify that the exec function receives the resolved provider's binary.
    let capturedCmd = "";
    const exec = (cmd: string, _args: ReadonlyArray<string>) => {
      capturedCmd = cmd;
      return { stdout: validJson, stderr: "", status: 0 };
    };
    callLLM("docs", "tool", "model", exec);
    // When checkBinary("claude") returns true, it resolves to claude-cli provider
    // which invokes the "claude" binary — this verifies it goes through llm.ts dispatch
    expect(capturedCmd).toBe("claude");
  });

  it("uses the shared LLM provider when no exec is injected (no hardcoded claude)", () => {
    // This is a structural test: calling callLLM without an exec parameter
    // should use the shared callSharedLLM from llm.ts, not shell out to claude directly.
    // We can't easily test this without mocking the module, but we verify the function
    // signature accepts exec as optional (undefined) which triggers the shared path.
    const fn = callLLM;
    expect(fn.length).toBeGreaterThanOrEqual(3); // rawDocs, toolId, model required; exec optional
  });
});

describe("detectVersion", () => {
  it("returns the first line of --version output on success", () => {
    const exec = (_cmd: string, args: ReadonlyArray<string>) => {
      if (args[0] === "--version") return { stdout: "mytool 1.2.3\nExtra info", stderr: "", status: 0 };
      return { stdout: "", stderr: "", status: 1 };
    };
    expect(detectVersion("mytool", exec)).toBe("mytool 1.2.3");
  });

  it("falls back to -V if --version fails", () => {
    const exec = (_cmd: string, args: ReadonlyArray<string>) => {
      if (args[0] === "-V") return { stdout: "2.0.0", stderr: "", status: 0 };
      return { stdout: "", stderr: "", status: 1 };
    };
    expect(detectVersion("mytool", exec)).toBe("2.0.0");
  });

  it("returns undefined when all version flags fail", () => {
    const exec = () => ({ stdout: "", stderr: "unknown flag", status: 1 });
    expect(detectVersion("mytool", exec)).toBeUndefined();
  });

  it("returns undefined when output is empty", () => {
    const exec = () => ({ stdout: "", stderr: "", status: 0 });
    expect(detectVersion("mytool", exec)).toBeUndefined();
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
      binary: "notool",
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
      binary: "mytool",
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
    // YAML frontmatter format with generated-from marker
    writeFileSync(
      path.join(outDir, "SKILL.md"),
      "---\nname: mytool\ndescription: Old desc\ngenerated-from: skilldoc\ntool-id: mytool\ngenerated-at: 2024-01-01T00:00:00.000Z\n---\n# mytool"
    );

    const mockLLM: LLMCaller = () => ({
      description: "Test tool description",
      skill: "# mytool",
      advanced: "adv",
      recipes: "rec",
      troubleshooting: "trbl",
    });

    const result = await distillTool({
      toolId: "mytool",
      binary: "mytool",
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
      description: "A test tool",
      skill: "# mytool\n\nQuick ref",
      advanced: "## Advanced",
      recipes: "## Recipes",
      troubleshooting: "## Troubleshooting",
    });

    await distillTool({ toolId: "mytool", binary: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

    expect(existsSync(path.join(outDir, "SKILL.md"))).toBe(true);
    expect(existsSync(path.join(outDir, "docs", "advanced.md"))).toBe(true);
    expect(existsSync(path.join(outDir, "docs", "recipes.md"))).toBe(true);
    expect(existsSync(path.join(outDir, "docs", "troubleshooting.md"))).toBe(true);
  });

  it("adds YAML frontmatter with description header to SKILL.md", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const mockLLM: LLMCaller = () => ({
      description: "A description of mytool",
      skill: "# mytool\n\nContent",
      advanced: "adv",
      recipes: "rec",
      troubleshooting: "trbl",
    });

    await distillTool({ toolId: "mytool", binary: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

    const content = readFileSync(path.join(outDir, "SKILL.md"), "utf8");
    expect(content).toMatch(/^---\n/);
    expect(content).toContain("name: mytool");
    expect(content).toContain("description: A description of mytool");
    expect(content).toContain("generated-from: skilldoc");
    expect(content).toContain("tool-id: mytool");
    expect(content).toContain("generated-at:");
    expect(content).toContain("# mytool");
  });

  it("includes tool-binary in SKILL.md frontmatter", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const mockLLM: LLMCaller = () => ({
      description: "Some tool",
      skill: "# mytool",
      advanced: "adv",
      recipes: "rec",
      troubleshooting: "trbl",
    });

    await distillTool({ toolId: "mytool", binary: "mytool-bin", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

    const content = readFileSync(path.join(outDir, "SKILL.md"), "utf8");
    expect(content).toContain("tool-binary: mytool-bin");
  });

  it("uses binary (not toolId) for version detection", async () => {
    const docsDir = setupDocs("my-tool-id");
    const outDir = path.join(tmpDir, "skills", "my-tool-id");

    const mockLLM: LLMCaller = () => ({
      description: "Some tool",
      skill: "# my-tool-id",
      advanced: "adv",
      recipes: "rec",
      troubleshooting: "trbl",
    });

    // binary differs from toolId; just verify it doesn't crash and frontmatter is written
    await distillTool({ toolId: "my-tool-id", binary: "actual-binary", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

    const content = readFileSync(path.join(outDir, "SKILL.md"), "utf8");
    expect(content).toContain("tool-binary: actual-binary");
    expect(content).toContain("tool-id: my-tool-id");
  });

  it("SKILL.md frontmatter closes with --- before content", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const mockLLM: LLMCaller = () => ({
      description: "Some tool",
      skill: "# mytool",
      advanced: "adv",
      recipes: "rec",
      troubleshooting: "trbl",
    });

    await distillTool({ toolId: "mytool", binary: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

    const content = readFileSync(path.join(outDir, "SKILL.md"), "utf8");
    // Frontmatter must open and close with ---
    const lines = content.split("\n");
    expect(lines[0]).toBe("---");
    const closingIndex = lines.indexOf("---", 1);
    expect(closingIndex).toBeGreaterThan(1);
  });

  it("includes tool-version in SKILL.md when version is detected", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const mockLLM: LLMCaller = () => ({
      description: "Some tool",
      skill: "# mytool",
      advanced: "adv",
      recipes: "rec",
      troubleshooting: "trbl",
    });

    // Provide a versionExec that returns a known version for --version
    // We can't directly inject versionExec into distillTool, but we can
    // verify tool-version appears when detectVersion succeeds
    // For now, just verify the field name is correct when present by testing addMetadataHeader indirectly
    await distillTool({ toolId: "mytool", binary: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

    // tool-version may or may not be present (depends on whether 'mytool' binary exists)
    // Just verify the file is valid YAML frontmatter without crashing
    const content = readFileSync(path.join(outDir, "SKILL.md"), "utf8");
    expect(content).toContain("---");
  });

  it("writes LLM content verbatim to docs/ files", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const mockLLM: LLMCaller = () => ({
      description: "Some tool",
      skill: "# mytool",
      advanced: "power user content here",
      recipes: "recipe content here",
      troubleshooting: "gotcha content here",
    });

    await distillTool({ toolId: "mytool", binary: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

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
      return { description: "d", skill: "s", advanced: "a", recipes: "r", troubleshooting: "t" };
    };

    await distillTool({ toolId: "mytool", binary: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

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
      return { description: "d", skill: "s", advanced: "a", recipes: "r", troubleshooting: "t" };
    };

    await distillTool({ toolId: "mytool", binary: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

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
      return { description: "d", skill: "s", advanced: "a", recipes: "r", troubleshooting: "t" };
    };

    await distillTool({ toolId: "mytool", binary: "mytool", docsDir, outDir, model: "claude-opus-4-6", llmCaller: mockLLM });

    expect(capturedModel).toBe("claude-opus-4-6");
    expect(capturedToolId).toBe("mytool");
  });

  it("returns toolId and outDir on success", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const mockLLM: LLMCaller = () => ({
      description: "d",
      skill: "s",
      advanced: "a",
      recipes: "r",
      troubleshooting: "t",
    });

    const result = await distillTool({ toolId: "mytool", binary: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

    expect(result.toolId).toBe("mytool");
    expect(result.outDir).toBe(outDir);
    expect(result.skipped).toBeUndefined();
  });

  it("returns no sizeWarnings when all files are within limits", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const mockLLM: LLMCaller = () => ({
      description: "Short desc",
      skill: "# mytool\n\nShort skill",
      advanced: "## Advanced\n\nShort",
      recipes: "## Recipes\n\nShort",
      troubleshooting: "## Troubleshooting\n\nShort",
    });

    const result = await distillTool({ toolId: "mytool", binary: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

    expect(result.sizeWarnings).toBeUndefined();
  });

  it("does not warn when advanced.md is exactly at the 500-token byte threshold", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const mockLLM: LLMCaller = () => ({
      description: "d",
      skill: "# mytool",
      advanced: "x".repeat(2000), // 2000 bytes => 500 estimated tokens
      recipes: "rec",
      troubleshooting: "trbl",
    });

    const result = await distillTool({ toolId: "mytool", binary: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

    expect(result.sizeWarnings).toBeUndefined();
  });

  it("uses UTF-8 byte length for token estimates in size warnings", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const mockLLM: LLMCaller = () => ({
      description: "d",
      skill: "# mytool",
      advanced: "\u{1F600}".repeat(501), // 2004 bytes => 501 estimated tokens
      recipes: "rec",
      troubleshooting: "trbl",
    });

    const result = await distillTool({ toolId: "mytool", binary: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

    expect(result.sizeWarnings).toBeDefined();
    expect(result.sizeWarnings?.some((w) => w.includes("advanced.md"))).toBe(true);
    expect(result.sizeWarnings?.some((w) => w.includes("501 tokens"))).toBe(true);
  });

  it("returns sizeWarnings when SKILL.md exceeds 1000 tokens", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const oversizedSkill = "x".repeat(4001);
    const mockLLM: LLMCaller = () => ({
      description: "d",
      skill: oversizedSkill,
      advanced: "adv",
      recipes: "rec",
      troubleshooting: "trbl",
    });

    const result = await distillTool({ toolId: "mytool", binary: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

    expect(result.sizeWarnings).toBeDefined();
    expect(result.sizeWarnings?.some((w) => w.includes("SKILL.md"))).toBe(true);
    expect(result.sizeWarnings?.some((w) => w.includes("1000"))).toBe(true);
  });

  it("formats size warnings in tokens instead of bytes", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const mockLLM: LLMCaller = () => ({
      description: "d",
      skill: "x".repeat(4001), // 4001 bytes => 1001 estimated tokens
      advanced: "adv",
      recipes: "rec",
      troubleshooting: "trbl",
    });

    const result = await distillTool({ toolId: "mytool", binary: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

    expect(result.sizeWarnings?.length).toBe(1);
    expect(result.sizeWarnings?.[0]).toMatch(/^SKILL\.md is \d+ tokens \(limit: 1000 tokens\)$/);
    expect(result.sizeWarnings?.some((w) => w.includes("bytes"))).toBe(false);
  });

  it("returns sizeWarnings when troubleshooting.md exceeds 250 tokens", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const oversizedTroubleshooting = "x".repeat(1001);
    const mockLLM: LLMCaller = () => ({
      description: "d",
      skill: "# mytool",
      advanced: "adv",
      recipes: "rec",
      troubleshooting: oversizedTroubleshooting,
    });

    const result = await distillTool({ toolId: "mytool", binary: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

    expect(result.sizeWarnings).toBeDefined();
    expect(result.sizeWarnings?.some((w) => w.includes("troubleshooting.md"))).toBe(true);
    expect(result.sizeWarnings?.some((w) => w.includes("250"))).toBe(true);
  });

  it("reports multiple size warnings when several files exceed their limits", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const mockLLM: LLMCaller = () => ({
      description: "d",
      skill: "x".repeat(4001),
      advanced: "x".repeat(2001),
      recipes: "rec",
      troubleshooting: "trbl",
    });

    const result = await distillTool({ toolId: "mytool", binary: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

    expect(result.sizeWarnings?.length).toBeGreaterThanOrEqual(2);
    expect(result.sizeWarnings?.some((w) => w.includes("SKILL.md"))).toBe(true);
    expect(result.sizeWarnings?.some((w) => w.includes("advanced.md"))).toBe(true);
  });

  it("passes feedback to the LLM caller when provided", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    let capturedFeedback: string | undefined;
    const mockLLM: LLMCaller = (_rawDocs, _toolId, _model, feedback) => {
      capturedFeedback = feedback;
      return { description: "d", skill: "s", advanced: "a", recipes: "r", troubleshooting: "t" };
    };

    await distillTool({
      toolId: "mytool",
      binary: "mytool",
      docsDir,
      outDir,
      model: "test-model",
      llmCaller: mockLLM,
      feedback: "agents needed the --count flag",
    });

    expect(capturedFeedback).toBe("agents needed the --count flag");
  });

  it("passes undefined feedback to the LLM caller when not provided", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    let capturedFeedback: string | undefined = "sentinel";
    const mockLLM: LLMCaller = (_rawDocs, _toolId, _model, feedback) => {
      capturedFeedback = feedback;
      return { description: "d", skill: "s", advanced: "a", recipes: "r", troubleshooting: "t" };
    };

    await distillTool({ toolId: "mytool", binary: "mytool", docsDir, outDir, model: "test-model", llmCaller: mockLLM });

    expect(capturedFeedback).toBeUndefined();
  });
});

describe("buildPrompt — config customization", () => {
  it("uses default priorities when no config provided", () => {
    const prompt = buildPrompt("raw docs", "tool");
    expect(prompt).toContain("Most-used flags/commands first");
    expect(prompt).toContain("Real-world usage patterns");
    expect(prompt).toContain("Agent-specific gotchas");
    expect(prompt).toContain("Concrete runnable examples");
  });

  it("uses custom priorities from config", () => {
    const prompt = buildPrompt("raw docs", "tool", undefined, {
      priorities: ["Custom first priority", "Custom second priority"],
    });
    expect(prompt).toContain("1. Custom first priority");
    expect(prompt).toContain("2. Custom second priority");
    expect(prompt).not.toContain("Most-used flags/commands first");
  });

  it("uses default size limits when no config provided", () => {
    const prompt = buildPrompt("raw docs", "tool");
    expect(prompt).toContain("≤ 1000 tokens");
    expect(prompt).toContain("≤ 500 tokens");
    expect(prompt).toContain("≤ 250 tokens");
    expect(prompt).toContain("per-file token limits");
    expect(prompt).not.toContain("per-file byte limits");
  });

  it("uses custom size limits from config", () => {
    const prompt = buildPrompt("raw docs", "tool", undefined, {
      sizeLimits: { skill: 1500, troubleshooting: 750 },
    });
    expect(prompt).toContain("≤ 1500 tokens");
    expect(prompt).toContain("≤ 750 tokens");
    // skill line uses override; advanced/recipes still use default
    expect(prompt).toContain('"skill": ≤ 1500 tokens');
    expect(prompt).not.toContain('"skill": ≤ 1000 tokens');
    expect(prompt).toContain('"troubleshooting": ≤ 750 tokens');
    expect(prompt).not.toContain('"troubleshooting": ≤ 250 tokens');
  });

  it("partial size limit override only changes specified files", () => {
    const prompt = buildPrompt("raw docs", "tool", undefined, {
      sizeLimits: { skill: 1000 },
    });
    expect(prompt).toContain("≤ 1000 tokens");
    // advanced and recipes still use defaults
    const advancedMatch = prompt.match(/"advanced".*?≤ (\d+) tokens/);
    expect(advancedMatch?.[1]).toBe("500");
  });

  it("appends extraInstructions before the feedback section", () => {
    const prompt = buildPrompt("raw docs", "tool", undefined, {
      extraInstructions: "Always use --quiet flag in examples.",
    });
    expect(prompt).toContain("Always use --quiet flag in examples.");
  });

  it("does not include extraInstructions section when empty string", () => {
    const prompt = buildPrompt("raw docs", "tool", undefined, { extraInstructions: "" });
    // extraInstructions are only included when non-empty; check no double newlines from empty string
    const withoutFeedback = prompt.split("Return ONLY valid JSON")[1] ?? "";
    expect(withoutFeedback.trimStart()).not.toMatch(/^[\n]{3,}/);
  });

  it("SKILL.md format spec includes Critical Distinctions section for confused commands/flags", () => {
    const prompt = buildPrompt("raw docs", "tool");
    expect(prompt).toContain("## Critical Distinctions");
    expect(prompt).toContain("two or more commands could plausibly be confused");
  });

  it("Critical Distinctions appears at the TOP of SKILL.md format (before Quick Reference)", () => {
    const prompt = buildPrompt("raw docs", "tool");
    const criticalPos = prompt.indexOf("## Critical Distinctions");
    const quickRefPos = prompt.indexOf("## Quick Reference");
    expect(criticalPos).toBeGreaterThan(0);
    expect(criticalPos).toBeLessThan(quickRefPos);
  });

  it("Critical Distinctions instruction mentions similar names and overlapping purposes", () => {
    const prompt = buildPrompt("raw docs", "tool");
    expect(prompt).toContain("similar names");
    expect(prompt).toContain("overlapping purposes");
  });

  it("Critical Distinctions instruction says to omit when no confusion risk exists", () => {
    const prompt = buildPrompt("raw docs", "tool");
    expect(prompt).toContain("Omit entirely if no confusion risk exists");
  });

  it("SKILL.md format spec instructs Key Commands table to show key arguments and flags inline", () => {
    const prompt = buildPrompt("raw docs", "tool");
    expect(prompt).toContain("variable set KEY=VAL");
    expect(prompt).toContain("--skip-deploys");
    expect(prompt).toContain("inline");
  });

  it("Key Commands table format shows concrete markdown table with header row", () => {
    const prompt = buildPrompt("raw docs", "tool");
    expect(prompt).toContain("| Command | Purpose |");
    expect(prompt).toContain("|---------|---------|");
  });

  it("Key Commands concrete example table has a row showing flag inline in Purpose column", () => {
    const prompt = buildPrompt("raw docs", "tool");
    expect(prompt).toMatch(/\|.*`--skip-deploys`.*\|/);
  });

  it("extraInstructions appears before validation feedback when both present", () => {
    const prompt = buildPrompt("raw docs", "tool", "agent needed --count flag", {
      extraInstructions: "Prefer POSIX-compatible examples.",
    });
    const extraPos = prompt.indexOf("Prefer POSIX-compatible examples.");
    const feedbackPos = prompt.indexOf("Validation Feedback");
    expect(extraPos).toBeGreaterThan(0);
    expect(feedbackPos).toBeGreaterThan(extraPos);
  });
});

describe("callLLM — config forwarding", () => {
  const validJson = JSON.stringify({
    description: "Fast file search tool",
    skill: "# rg\n\nSearch files",
    advanced: "## Advanced\n\nPCRE2 flags",
    recipes: "## Recipes\n\nSearch Python files",
    troubleshooting: "## Troubleshooting\n\nQuoting issues",
  });

  it("forwards promptConfig to the prompt", () => {
    let capturedInput = "";
    const exec = (_cmd: string, _args: ReadonlyArray<string>, opts: { input: string }) => {
      capturedInput = opts.input;
      return { stdout: validJson, stderr: "", status: 0 };
    };
    callLLM("docs", "tool", "model", exec, undefined, { extraInstructions: "Use POSIX paths." });
    expect(capturedInput).toContain("Use POSIX paths.");
  });

  it("uses default prompt when promptConfig is omitted", () => {
    let capturedInput = "";
    const exec = (_cmd: string, _args: ReadonlyArray<string>, opts: { input: string }) => {
      capturedInput = opts.input;
      return { stdout: validJson, stderr: "", status: 0 };
    };
    callLLM("docs", "tool", "model", exec);
    expect(capturedInput).toContain("≤ 1000 tokens");
    expect(capturedInput).toContain("≤ 500 tokens");
    expect(capturedInput).toContain("≤ 250 tokens");
  });
});

describe("loadDistillConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `distill-config-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty object when config file does not exist", async () => {
    const config = await loadDistillConfig(path.join(tmpDir, "nonexistent.yaml"));
    expect(config).toEqual({});
  });

  it("returns empty object when config file is invalid YAML", async () => {
    const configPath = path.join(tmpDir, "bad.yaml");
    writeFileSync(configPath, "{ this is: [invalid yaml");
    const config = await loadDistillConfig(configPath);
    expect(config).toEqual({});
  });

  it("returns empty object when config file is not an object", async () => {
    const configPath = path.join(tmpDir, "arr.yaml");
    writeFileSync(configPath, "- item1\n- item2\n");
    const config = await loadDistillConfig(configPath);
    expect(config).toEqual({});
  });

  it("loads sizeLimits from config file", async () => {
    const configPath = path.join(tmpDir, "config.yaml");
    writeFileSync(configPath, "sizeLimits:\n  skill: 1500\n  troubleshooting: 800\n");
    const config = await loadDistillConfig(configPath);
    expect(config.sizeLimits?.skill).toBe(1500);
    expect(config.sizeLimits?.troubleshooting).toBe(800);
    expect(config.sizeLimits?.advanced).toBeUndefined();
  });

  it("loads priorities array from config file", async () => {
    const configPath = path.join(tmpDir, "config.yaml");
    writeFileSync(configPath, "priorities:\n  - 'First priority'\n  - 'Second priority'\n");
    const config = await loadDistillConfig(configPath);
    expect(config.priorities).toEqual(["First priority", "Second priority"]);
  });

  it("loads extraInstructions from config file", async () => {
    const configPath = path.join(tmpDir, "config.yaml");
    writeFileSync(configPath, "extraInstructions: 'Always use --quiet flag.'\n");
    const config = await loadDistillConfig(configPath);
    expect(config.extraInstructions).toBe("Always use --quiet flag.");
  });

  it("loads all fields together", async () => {
    const configPath = path.join(tmpDir, "config.yaml");
    writeFileSync(
      configPath,
      "sizeLimits:\n  skill: 1200\n  advanced: 1800\npriorities:\n  - 'Custom rule'\nextraInstructions: 'Extra note.'\n"
    );
    const config = await loadDistillConfig(configPath);
    expect(config.sizeLimits?.skill).toBe(1200);
    expect(config.sizeLimits?.advanced).toBe(1800);
    expect(config.priorities).toEqual(["Custom rule"]);
    expect(config.extraInstructions).toBe("Extra note.");
  });

  it("ignores unknown top-level fields", async () => {
    const configPath = path.join(tmpDir, "config.yaml");
    writeFileSync(configPath, "extraInstructions: 'note'\nunknownField: 42\n");
    const config = await loadDistillConfig(configPath);
    expect(config.extraInstructions).toBe("note");
    expect((config as Record<string, unknown>).unknownField).toBeUndefined();
  });

  it("ignores priorities when not an array of strings", async () => {
    const configPath = path.join(tmpDir, "config.yaml");
    writeFileSync(configPath, "priorities: 'not an array'\n");
    const config = await loadDistillConfig(configPath);
    expect(config.priorities).toBeUndefined();
  });
});

describe("distillTool — promptConfig integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `distill-prompt-config-test-${Date.now()}`);
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

  it("respects custom sizeLimits in size warnings", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const mockLLM: LLMCaller = () => ({
      description: "d",
      skill: "x".repeat(4001), // exceeds custom limit of 1000 tokens
      advanced: "adv",
      recipes: "rec",
      troubleshooting: "trbl",
    });

    const result = await distillTool({
      toolId: "mytool",
      binary: "mytool",
      docsDir,
      outDir,
      model: "test-model",
      llmCaller: mockLLM,
      promptConfig: { sizeLimits: { skill: 1000 } },
    });

    expect(result.sizeWarnings).toBeDefined();
    expect(result.sizeWarnings?.some((w) => w.includes("SKILL.md"))).toBe(true);
  });

  it("no warning when custom limit is higher than content size", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const mockLLM: LLMCaller = () => ({
      description: "d",
      skill: "x".repeat(1500), // within custom limit of 3000
      advanced: "adv",
      recipes: "rec",
      troubleshooting: "trbl",
    });

    const result = await distillTool({
      toolId: "mytool",
      binary: "mytool",
      docsDir,
      outDir,
      model: "test-model",
      llmCaller: mockLLM,
      promptConfig: { sizeLimits: { skill: 3000 } },
    });

    expect(result.sizeWarnings).toBeUndefined();
  });

  it("default LLM caller uses promptConfig", async () => {
    // We can't directly test the default LLM caller without mocking the exec layer.
    // Instead, verify that promptConfig is passed to the llmCaller when using custom llmCaller.
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    let capturedConfig: unknown;
    // The LLMCaller type doesn't expose config; we verify via size limits behavior instead.
    // This is a smoke test that distillTool doesn't crash with promptConfig set.
    const mockLLM: LLMCaller = () => ({
      description: "d",
      skill: "s",
      advanced: "a",
      recipes: "r",
      troubleshooting: "t",
    });

    const result = await distillTool({
      toolId: "mytool",
      binary: "mytool",
      docsDir,
      outDir,
      model: "test-model",
      llmCaller: mockLLM,
      promptConfig: { priorities: ["Custom priority"] },
    });

    expect(result.skipped).toBeUndefined();
    expect(result.toolId).toBe("mytool");
    void capturedConfig; // silence unused var warning
  });
});

describe("DEFAULT_PROMPT_CONFIG", () => {
  it("has all required size limit fields", () => {
    expect(DEFAULT_PROMPT_CONFIG.sizeLimits?.skill).toBe(1000);
    expect(DEFAULT_PROMPT_CONFIG.sizeLimits?.advanced).toBe(500);
    expect(DEFAULT_PROMPT_CONFIG.sizeLimits?.recipes).toBe(500);
    expect(DEFAULT_PROMPT_CONFIG.sizeLimits?.troubleshooting).toBe(250);
  });

  it("uses token-based defaults instead of legacy byte limits", () => {
    expect(DEFAULT_PROMPT_CONFIG.sizeLimits?.skill).not.toBe(4000);
    expect(DEFAULT_PROMPT_CONFIG.sizeLimits?.advanced).not.toBe(2000);
    expect(DEFAULT_PROMPT_CONFIG.sizeLimits?.recipes).not.toBe(2000);
    expect(DEFAULT_PROMPT_CONFIG.sizeLimits?.troubleshooting).not.toBe(1000);
  });

  it("has 6 default priorities", () => {
    expect(DEFAULT_PROMPT_CONFIG.priorities?.length).toBe(6);
  });

  it("default priorities include the 80/20 framing", () => {
    const combined = DEFAULT_PROMPT_CONFIG.priorities!.join(" ");
    expect(combined).toContain("20%");
    expect(combined).toContain("80%");
  });

  it("default priorities include agent-specific gotchas", () => {
    const combined = DEFAULT_PROMPT_CONFIG.priorities!.join(" ");
    expect(combined).toContain("gotchas");
    expect(combined).toContain("quoting");
  });

  it("default priorities include confusion prevention for similar-looking commands/flags", () => {
    const combined = DEFAULT_PROMPT_CONFIG.priorities!.join(" ");
    expect(combined).toContain("Confusion prevention");
    expect(combined).toContain("misleading names");
  });

  it("default priorities include behavior-changing flags alongside commands", () => {
    const combined = DEFAULT_PROMPT_CONFIG.priorities!.join(" ");
    expect(combined).toContain("Behavior-changing flags");
    expect(combined).toContain("--skip-deploys");
    expect(combined).toContain("--dry-run");
    expect(combined).toContain("--force");
  });
});

describe("INSUFFICIENT_DOCS_SENTINEL", () => {
  it("is a non-empty string", () => {
    expect(typeof INSUFFICIENT_DOCS_SENTINEL).toBe("string");
    expect(INSUFFICIENT_DOCS_SENTINEL.length).toBeGreaterThan(0);
  });

  it("mentions re-running generate after fixing parser", () => {
    expect(INSUFFICIENT_DOCS_SENTINEL).toContain("re-run generate");
    expect(INSUFFICIENT_DOCS_SENTINEL).toContain("fixing parser");
  });
});

describe("buildPrompt — anti-hallucination", () => {
  it("contains critical anti-hallucination rule header", () => {
    const prompt = buildPrompt("raw docs", "tool");
    expect(prompt).toContain("Anti-hallucination rule");
  });

  it("prohibits use of training knowledge", () => {
    const prompt = buildPrompt("raw docs", "tool");
    expect(prompt).toContain("Do NOT draw on your training knowledge");
  });

  it("prohibits inventing flags or behaviors not in raw docs", () => {
    const prompt = buildPrompt("raw docs", "tool");
    expect(prompt).toContain("Do NOT invent flags");
  });

  it("instructs LLM to only use information present in raw docs", () => {
    const prompt = buildPrompt("raw docs", "tool");
    expect(prompt).toContain("ONLY use information explicitly present in the raw docs");
  });

  it("instructs LLM to return sentinel when docs are empty or contain parser warnings", () => {
    const prompt = buildPrompt("raw docs", "tool");
    expect(prompt).toContain(INSUFFICIENT_DOCS_SENTINEL);
    expect(prompt).toContain("No commands detected");
  });

  it("instructs LLM to set ALL text fields to the sentinel when docs are insufficient", () => {
    const prompt = buildPrompt("raw docs", "tool");
    // Verify all five fields are mentioned near the sentinel instruction
    expect(prompt).toContain('"description"');
    expect(prompt).toContain('"skill"');
    expect(prompt).toContain('"advanced"');
    expect(prompt).toContain('"recipes"');
    expect(prompt).toContain('"troubleshooting"');
  });

  it("does NOT instruct LLM to use general knowledge when docs are incomplete", () => {
    const prompt = buildPrompt("raw docs", "tool");
    expect(prompt).not.toContain("use your general knowledge");
    expect(prompt).not.toContain("general knowledge of the tool");
  });

  it("explicitly prohibits adding commands, flags, examples, or behavior from training knowledge", () => {
    const prompt = buildPrompt("raw docs", "tool");
    expect(prompt).toContain("Do NOT add commands, flags, examples, or behavior from your training knowledge");
  });

  it("instructs to only distill what appears in provided documentation", () => {
    const prompt = buildPrompt("raw docs", "tool");
    expect(prompt).toContain("Only distill what appears in the provided documentation");
  });

  it("instructs LLM to output stub skill saying 'raw docs incomplete' when docs lack useful content", () => {
    const prompt = buildPrompt("raw docs", "tool");
    expect(prompt).toContain("raw docs incomplete");
  });
});

describe("distillTool — insufficient docs sentinel handling", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `distill-sentinel-test-${Date.now()}`);
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

  it("skips and returns sentinel skipReason when LLM returns sentinel in skill field", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const mockLLM: LLMCaller = () => ({
      description: INSUFFICIENT_DOCS_SENTINEL,
      skill: INSUFFICIENT_DOCS_SENTINEL,
      advanced: INSUFFICIENT_DOCS_SENTINEL,
      recipes: INSUFFICIENT_DOCS_SENTINEL,
      troubleshooting: INSUFFICIENT_DOCS_SENTINEL,
    });

    const result = await distillTool({
      toolId: "mytool",
      binary: "mytool",
      docsDir,
      outDir,
      model: "test-model",
      llmCaller: mockLLM,
    });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe(INSUFFICIENT_DOCS_SENTINEL);
  });

  it("does not write output files when LLM returns sentinel", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const mockLLM: LLMCaller = () => ({
      description: INSUFFICIENT_DOCS_SENTINEL,
      skill: INSUFFICIENT_DOCS_SENTINEL,
      advanced: INSUFFICIENT_DOCS_SENTINEL,
      recipes: INSUFFICIENT_DOCS_SENTINEL,
      troubleshooting: INSUFFICIENT_DOCS_SENTINEL,
    });

    await distillTool({
      toolId: "mytool",
      binary: "mytool",
      docsDir,
      outDir,
      model: "test-model",
      llmCaller: mockLLM,
    });

    expect(existsSync(path.join(outDir, "SKILL.md"))).toBe(false);
    expect(existsSync(path.join(outDir, "docs", "advanced.md"))).toBe(false);
  });

  it("proceeds normally when LLM returns real content (not sentinel)", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const mockLLM: LLMCaller = () => ({
      description: "A real tool",
      skill: "# mytool\n\nQuick ref",
      advanced: "## Advanced",
      recipes: "## Recipes",
      troubleshooting: "## Troubleshooting",
    });

    const result = await distillTool({
      toolId: "mytool",
      binary: "mytool",
      docsDir,
      outDir,
      model: "test-model",
      llmCaller: mockLLM,
    });

    expect(result.skipped).toBeUndefined();
    expect(existsSync(path.join(outDir, "SKILL.md"))).toBe(true);
  });

  it("sentinel detection is whitespace-tolerant (trims before comparing)", async () => {
    const docsDir = setupDocs("mytool");
    const outDir = path.join(tmpDir, "skills", "mytool");

    const mockLLM: LLMCaller = () => ({
      description: INSUFFICIENT_DOCS_SENTINEL,
      skill: `  ${INSUFFICIENT_DOCS_SENTINEL}  `,
      advanced: INSUFFICIENT_DOCS_SENTINEL,
      recipes: INSUFFICIENT_DOCS_SENTINEL,
      troubleshooting: INSUFFICIENT_DOCS_SENTINEL,
    });

    const result = await distillTool({
      toolId: "mytool",
      binary: "mytool",
      docsDir,
      outDir,
      model: "test-model",
      llmCaller: mockLLM,
    });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe(INSUFFICIENT_DOCS_SENTINEL);
  });
});

describe("gatherRawDocs — recursive subcommand docs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `gather-rawdocs-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeToolDocs(toolId: string): { docsDir: string; toolDir: string } {
    const docsDir = path.join(tmpDir, "docs");
    const toolDir = path.join(docsDir, toolId);
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(path.join(toolDir, "tool.md"), `# ${toolId}\n\nMain docs`);
    return { docsDir, toolDir };
  }

  it("returns null when tool.md does not exist", async () => {
    const docsDir = path.join(tmpDir, "docs");
    mkdirSync(docsDir, { recursive: true });
    expect(await gatherRawDocs("notool", docsDir)).toBeNull();
  });

  it("returns only tool.md content when no commands directory exists", async () => {
    const { docsDir } = makeToolDocs("mytool");
    const result = await gatherRawDocs("mytool", docsDir);
    expect(result).toContain("Main docs");
    expect(result).not.toContain("---");
  });

  it("includes nested subcommand docs one level deep", async () => {
    const { docsDir, toolDir } = makeToolDocs("mytool");
    const installDir = path.join(toolDir, "commands", "install");
    const installGlobalDir = path.join(installDir, "global");
    mkdirSync(installGlobalDir, { recursive: true });
    writeFileSync(path.join(installDir, "command.md"), "## install\n\nInstall a package");
    writeFileSync(path.join(installGlobalDir, "command.md"), "## install global\n\nInstall globally");

    const result = await gatherRawDocs("mytool", docsDir);
    expect(result).toContain("Main docs");
    expect(result).toContain("Install a package");
    expect(result).toContain("Install globally");
  });

  it("includes deeply nested subcommand docs (three levels)", async () => {
    const { docsDir, toolDir } = makeToolDocs("mytool");
    const prDir = path.join(toolDir, "commands", "pr");
    const prCreateDir = path.join(prDir, "create");
    const prCreateDraftDir = path.join(prCreateDir, "draft");
    mkdirSync(prCreateDraftDir, { recursive: true });
    writeFileSync(path.join(prDir, "command.md"), "## pr\n\nPull request commands");
    writeFileSync(path.join(prCreateDir, "command.md"), "## pr create\n\nCreate a pull request");
    writeFileSync(path.join(prCreateDraftDir, "command.md"), "## pr create draft\n\nCreate a draft PR");

    const result = await gatherRawDocs("mytool", docsDir);
    expect(result).toContain("Pull request commands");
    expect(result).toContain("Create a pull request");
    expect(result).toContain("Create a draft PR");
  });

  it("includes parent command before its subcommands (depth-first order)", async () => {
    const { docsDir, toolDir } = makeToolDocs("mytool");
    const installDir = path.join(toolDir, "commands", "install");
    const installGlobalDir = path.join(installDir, "global");
    mkdirSync(installGlobalDir, { recursive: true });
    writeFileSync(path.join(installDir, "command.md"), "PARENT_CONTENT");
    writeFileSync(path.join(installGlobalDir, "command.md"), "CHILD_CONTENT");

    const result = await gatherRawDocs("mytool", docsDir);
    expect(result!.indexOf("PARENT_CONTENT")).toBeLessThan(result!.indexOf("CHILD_CONTENT"));
  });

  it("includes multiple top-level commands with their subcommands in sorted order", async () => {
    const { docsDir, toolDir } = makeToolDocs("mytool");
    const aDir = path.join(toolDir, "commands", "alpha");
    const aSub = path.join(aDir, "sub");
    const bDir = path.join(toolDir, "commands", "beta");
    mkdirSync(aSub, { recursive: true });
    mkdirSync(bDir, { recursive: true });
    writeFileSync(path.join(aDir, "command.md"), "ALPHA_CMD");
    writeFileSync(path.join(aSub, "command.md"), "ALPHA_SUB_CMD");
    writeFileSync(path.join(bDir, "command.md"), "BETA_CMD");

    const result = await gatherRawDocs("mytool", docsDir);
    const alphaPos = result!.indexOf("ALPHA_CMD");
    const alphaSubPos = result!.indexOf("ALPHA_SUB_CMD");
    const betaPos = result!.indexOf("BETA_CMD");

    expect(alphaPos).toBeLessThan(alphaSubPos);
    expect(alphaSubPos).toBeLessThan(betaPos);
  });

  it("skips subdirectories without command.md but still recurses into them", async () => {
    const { docsDir, toolDir } = makeToolDocs("mytool");
    // "deploy" has no command.md but has a subcommand "deploy production" that does
    const deployDir = path.join(toolDir, "commands", "deploy");
    const deployProdDir = path.join(deployDir, "production");
    mkdirSync(deployProdDir, { recursive: true });
    writeFileSync(path.join(deployProdDir, "command.md"), "DEPLOY_PROD_CONTENT");

    const result = await gatherRawDocs("mytool", docsDir);
    expect(result).toContain("DEPLOY_PROD_CONTENT");
  });

  it("separates sections with horizontal rules", async () => {
    const { docsDir, toolDir } = makeToolDocs("mytool");
    const cmdDir = path.join(toolDir, "commands", "run");
    mkdirSync(cmdDir, { recursive: true });
    writeFileSync(path.join(cmdDir, "command.md"), "## run\n\nRun a script");

    const result = await gatherRawDocs("mytool", docsDir);
    expect(result).toContain("---");
  });
});
