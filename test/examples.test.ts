import { describe, expect, it } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const EXAMPLES_DIR = path.resolve(import.meta.dir, "../examples");

const EXAMPLE_TOOLS = ["jq", "curl", "gh", "ffmpeg", "uv"];
const DOCS = ["advanced.md", "recipes.md", "troubleshooting.md"];

describe("examples/", () => {
  it("README.md exists", () => {
    const p = path.join(EXAMPLES_DIR, "README.md");
    expect(() => statSync(p)).not.toThrow();
  });

  for (const tool of EXAMPLE_TOOLS) {
    describe(tool, () => {
      it("SKILL.md exists and is non-empty", () => {
        const p = path.join(EXAMPLES_DIR, tool, "SKILL.md");
        const stat = statSync(p);
        expect(stat.size).toBeGreaterThan(0);
      });

      it("SKILL.md has generated-from marker", () => {
        const p = path.join(EXAMPLES_DIR, tool, "SKILL.md");
        const content = readFileSync(p, "utf8");
        expect(content).toContain("generated-from: agent-tool-docs");
      });

      for (const doc of DOCS) {
        it(`docs/${doc} exists and is non-empty`, () => {
          const p = path.join(EXAMPLES_DIR, tool, "docs", doc);
          const stat = statSync(p);
          expect(stat.size).toBeGreaterThan(0);
        });
      }
    });
  }
});
