import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { parseHelp } from "../src/parser.js";

const gitHelp = readFileSync(new URL("./fixtures/git-help.txt", import.meta.url), "utf8");
const rgHelp = readFileSync(new URL("./fixtures/rg-help.txt", import.meta.url), "utf8");
const ghHelp = readFileSync(new URL("./fixtures/gh-help.txt", import.meta.url), "utf8");

describe("parseHelp", () => {
  it("extracts usage from git help", () => {
    const parsed = parseHelp(gitHelp);
    expect(parsed.usageLines.length).toBeGreaterThan(0);
  });

  it("extracts commands from git help", () => {
    const parsed = parseHelp(gitHelp);
    const names = parsed.commands.map((command) => command.name);
    expect(names).toContain("clone");
  });

  it("extracts options from rg help", () => {
    const parsed = parseHelp(rgHelp);
    expect(parsed.options.length).toBeGreaterThan(0);
  });
});

describe("parseHelp — all-caps headers (gh style)", () => {
  it("extracts usage from USAGE section", () => {
    const parsed = parseHelp(ghHelp);
    expect(parsed.usageLines.length).toBeGreaterThan(0);
    expect(parsed.usageLines[0]).toContain("gh");
  });

  it("parses CORE COMMANDS section as a section", () => {
    const parsed = parseHelp(ghHelp);
    // Commands fall through to section scan when no named commands section found
    const names = parsed.commands.map((c) => c.name);
    expect(names.some((n) => n.startsWith("auth"))).toBe(true);
  });

  it("extracts options from FLAGS section", () => {
    const parsed = parseHelp(ghHelp);
    expect(parsed.options.length).toBeGreaterThan(0);
    const flags = parsed.options.map((o) => o.flags);
    expect(flags.some((f) => f.includes("--help"))).toBe(true);
  });

  it("extracts examples from EXAMPLES section", () => {
    const parsed = parseHelp(ghHelp);
    expect(parsed.examples.length).toBeGreaterThan(0);
    expect(parsed.examples.some((e) => e.includes("gh"))).toBe(true);
  });

  it("does not produce no-commands warning", () => {
    const parsed = parseHelp(ghHelp);
    expect(parsed.warnings).not.toContain("No commands detected.");
  });
});

describe("parseHelp — inline all-caps header fixture", () => {
  const input = `
USAGE
  mytool [flags] <arg>

COMMANDS
  run   Execute a task
  list  List available tasks

FLAGS
  --verbose   Enable verbose output
  --dry-run   Print actions without executing
`.trim();

  it("extracts usage from all-caps USAGE section", () => {
    const parsed = parseHelp(input);
    expect(parsed.usageLines.some((l) => l.includes("mytool [flags] <arg>"))).toBe(true);
  });

  it("extracts options from all-caps FLAGS section", () => {
    const parsed = parseHelp(input);
    expect(parsed.options.length).toBe(2);
    expect(parsed.options[0].flags).toBe("--verbose");
    expect(parsed.options[1].flags).toBe("--dry-run");
  });
});
