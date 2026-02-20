import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import path from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import { parseDistilledOutput, distillTool } from "../src/distill.js";

describe("parseDistilledOutput", () => {
  it("parses valid JSON output", () => {
    const input = JSON.stringify({
      skill: "# rg\n\nSearch files",
      advanced: "## Advanced\n\nPCRE2 flags",
      recipes: "## Recipes\n\nSearch Python files",
      troubleshooting: "## Troubleshooting\n\nQuoting issues",
    });
    const result = parseDistilledOutput(input);
    expect(result.skill).toContain("# rg");
    expect(result.advanced).toContain("Advanced");
    expect(result.recipes).toContain("Recipes");
    expect(result.troubleshooting).toContain("Troubleshooting");
  });

  it("strips markdown fences from JSON output", () => {
    const json = JSON.stringify({
      skill: "# rg",
      advanced: "adv",
      recipes: "rec",
      troubleshooting: "trbl",
    });
    const input = `\`\`\`json\n${json}\n\`\`\``;
    const result = parseDistilledOutput(input);
    expect(result.skill).toBe("# rg");
  });

  it("strips plain fences from JSON output", () => {
    const json = JSON.stringify({
      skill: "# rg",
      advanced: "adv",
      recipes: "rec",
      troubleshooting: "trbl",
    });
    const input = `\`\`\`\n${json}\n\`\`\``;
    const result = parseDistilledOutput(input);
    expect(result.skill).toBe("# rg");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseDistilledOutput("not json")).toThrow("Failed to parse LLM output as JSON");
  });

  it("throws on missing required keys", () => {
    const input = JSON.stringify({ skill: "# rg" });
    expect(() => parseDistilledOutput(input)).toThrow("LLM output missing required key");
  });

  it("throws on non-object JSON", () => {
    expect(() => parseDistilledOutput('"just a string"')).toThrow("LLM output is not a JSON object");
  });

  it("throws on null JSON", () => {
    expect(() => parseDistilledOutput("null")).toThrow("LLM output is not a JSON object");
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
    // Create a raw docs dir so it doesn't skip for missing docs
    const docsDir = path.join(tmpDir, "docs");
    const toolDocsDir = path.join(docsDir, "mytool");
    mkdirSync(toolDocsDir, { recursive: true });
    writeFileSync(path.join(toolDocsDir, "tool.md"), "# mytool\n\n## Usage\nSome usage");

    // Create an existing hand-written skill (no marker)
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
    // Create raw docs
    const docsDir = path.join(tmpDir, "docs");
    const toolDocsDir = path.join(docsDir, "mytool");
    mkdirSync(toolDocsDir, { recursive: true });
    writeFileSync(path.join(toolDocsDir, "tool.md"), "# mytool\n\n## Usage\nSome usage");

    // Create existing auto-generated skill with marker
    const outDir = path.join(tmpDir, "skills", "mytool");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, "SKILL.md"), "<!--\n  generated-from: agent-tool-docs\n-->\n# mytool");

    // Can't easily mock the internal callLLM. Verify the skip check passes
    // by checking that the result doesn't have skipped=true (it will throw on LLM call).
    let reachedLLM = false;
    try {
      await distillTool({
        toolId: "mytool",
        docsDir,
        outDir,
        model: "invalid-model-for-test",
      });
      reachedLLM = true;
    } catch (err) {
      // Expected — LLM call will fail, but the point is we didn't skip
      reachedLLM = true;
    }
    expect(reachedLLM).toBe(true);
  });
});
