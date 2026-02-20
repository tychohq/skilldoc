import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const README_MAX_LINES = 400;
const readmePath = path.resolve(import.meta.dir, "../README.md");
const content = readFileSync(readmePath, "utf8");

function getQuickStart(text: string): string {
  const start = text.indexOf("## Quick Start");
  const end = text.indexOf("\n---", start);
  return text.slice(start, end);
}

describe("README", () => {
  it(`is under ${README_MAX_LINES} lines`, () => {
    const lines = content.split("\n").length;
    expect(lines).toBeLessThanOrEqual(README_MAX_LINES);
  });
});

describe("Quick Start uses ad-hoc flow", () => {
  const quickStart = getQuickStart(content);

  it("shows ad-hoc positional arg commands", () => {
    expect(quickStart).toContain("tool-docs generate jq");
    expect(quickStart).toContain("tool-docs distill jq");
    expect(quickStart).toContain("tool-docs validate jq");
  });

  it("does not lead with init or --only flags", () => {
    // init and --only belong in the batch/registry section, not the primary Quick Start
    const primaryBlock = quickStart.split("```")[1] ?? "";
    expect(primaryBlock).not.toContain("tool-docs init");
    expect(primaryBlock).not.toContain("--only");
  });

  it("mentions registry batch flow separately", () => {
    expect(quickStart).toContain("registry");
    expect(quickStart).toContain("tool-docs init");
  });
});
