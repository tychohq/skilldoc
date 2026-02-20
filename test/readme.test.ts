import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const README_MAX_LINES = 400;
const readmePath = path.resolve(import.meta.dir, "../README.md");
const content = readFileSync(readmePath, "utf8");

function getSection(text: string, heading: string): string {
  const start = text.indexOf(heading);
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
  const quickStart = getSection(content, "## Quick Start");

  it("shows run as the recommended first command", () => {
    expect(quickStart).toContain("tool-docs run jq");
    // run should appear before individual commands
    const runIndex = quickStart.indexOf("tool-docs run jq");
    const generateIndex = quickStart.indexOf("tool-docs generate jq");
    expect(runIndex).toBeLessThan(generateIndex);
  });

  it("shows ad-hoc positional arg commands", () => {
    expect(quickStart).toContain("tool-docs generate jq");
    expect(quickStart).toContain("tool-docs distill jq");
    expect(quickStart).toContain("tool-docs validate jq");
  });

  it("does not contain init or --only flags", () => {
    expect(quickStart).not.toContain("tool-docs init");
    expect(quickStart).not.toContain("--only");
  });

  it("does not mention registry", () => {
    expect(quickStart).not.toContain("registry");
  });
});

describe("Configuration section has batch/registry flow", () => {
  const config = getSection(content, "## Configuration");

  it("shows batch commands", () => {
    expect(config).toContain("tool-docs init");
    expect(config).toContain("tool-docs generate");
    expect(config).toContain("tool-docs distill");
  });

  it("explains registry purpose", () => {
    expect(config).toContain("registry");
  });
});
