import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { parseHelp } from "../src/parser.js";

const gitHelp = readFileSync(new URL("./fixtures/git-help.txt", import.meta.url), "utf8");
const rgHelp = readFileSync(new URL("./fixtures/rg-help.txt", import.meta.url), "utf8");

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
