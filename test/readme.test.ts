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
    expect(quickStart).toContain("skilldoc run railway");
    // run should appear before individual commands
    const runIndex = quickStart.indexOf("skilldoc run railway");
    const generateIndex = quickStart.indexOf("skilldoc generate railway");
    expect(runIndex).toBeLessThan(generateIndex);
  });

  it("shows ad-hoc positional arg commands", () => {
    expect(quickStart).toContain("skilldoc generate railway");
    expect(quickStart).toContain("skilldoc distill railway");
    expect(quickStart).toContain("skilldoc validate railway");
  });

  it("does not contain init or --only flags", () => {
    expect(quickStart).not.toContain("skilldoc init");
    expect(quickStart).not.toContain("--only");
  });

  it("does not mention registry", () => {
    expect(quickStart).not.toContain("registry");
  });
});

describe("Configuration section has batch/registry flow", () => {
  const config = getSection(content, "## Configuration");

  it("shows batch commands", () => {
    expect(config).toContain("skilldoc init");
    expect(config).toContain("skilldoc generate");
    expect(config).toContain("skilldoc distill");
  });

  it("explains registry purpose", () => {
    expect(config).toContain("registry");
  });
});
