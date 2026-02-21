import { describe, expect, it } from "bun:test";
import path from "node:path";
import { readFileSync } from "node:fs";

describe("distill-config.yaml docs", () => {
  it("documents sizeLimits values as token budgets in distill.ts comments", () => {
    const source = readFileSync(path.join(process.cwd(), "src", "distill.ts"), "utf8");
    expect(source).toContain("Tighter token budgets");
    expect(source).toContain("skill: 1500          # tokens");
    expect(source).toContain("troubleshooting: 800 # tokens");
    expect(source).toContain("sizeLimits (skill/advanced/recipes/troubleshooting, in tokens)");
  });
});
