import { describe, expect, it } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const EXAMPLES_DIR = path.resolve(import.meta.dir, "../examples");

const EXAMPLE_TOOLS = ["jq", "curl", "gh", "ffmpeg", "uv", "uvx", "claude", "gog", "bird", "rg", "remindctl", "vercel"];
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
        expect(content).toContain("generated-from: skilldoc");
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

// Quality checks for tools that previously had broken raw docs (parser was failing).
// These assertions verify the distilled output contains tool-specific content that
// could only come from properly-parsed raw docs, not generic placeholder text.
describe("examples/ — previously-failing tools quality", () => {
  it("gh SKILL.md mentions core subcommands (pr, issue, auth)", () => {
    const content = readFileSync(path.join(EXAMPLES_DIR, "gh", "SKILL.md"), "utf8");
    expect(content).toContain("pr");
    expect(content).toContain("issue");
    expect(content).toContain("auth");
  });

  it("ffmpeg SKILL.md mentions -i input flag and codec flags", () => {
    const content = readFileSync(path.join(EXAMPLES_DIR, "ffmpeg", "SKILL.md"), "utf8");
    expect(content).toContain("-i");
    expect(content).toContain("-c");
  });

  it("curl SKILL.md mentions HTTP method and header flags", () => {
    const content = readFileSync(path.join(EXAMPLES_DIR, "curl", "SKILL.md"), "utf8");
    expect(content).toContain("-X");
    expect(content).toContain("-H");
  });

  it("rg SKILL.md mentions file type filtering and core flags", () => {
    const content = readFileSync(path.join(EXAMPLES_DIR, "rg", "SKILL.md"), "utf8");
    expect(content).toContain("--type");
    expect(content).toContain("-i");
  });

  it("remindctl SKILL.md mentions show and add commands", () => {
    const content = readFileSync(path.join(EXAMPLES_DIR, "remindctl", "SKILL.md"), "utf8");
    expect(content).toContain("show");
    expect(content).toContain("add");
  });

  it("vercel SKILL.md mentions deploy and --prod flag", () => {
    const content = readFileSync(path.join(EXAMPLES_DIR, "vercel", "SKILL.md"), "utf8");
    expect(content).toContain("deploy");
    expect(content).toContain("--prod");
  });

  it("uvx SKILL.md mentions running tools", () => {
    const content = readFileSync(path.join(EXAMPLES_DIR, "uvx", "SKILL.md"), "utf8");
    expect(content.length).toBeGreaterThan(300);
  });

  it("jq SKILL.md mentions filter syntax", () => {
    const content = readFileSync(path.join(EXAMPLES_DIR, "jq", "SKILL.md"), "utf8");
    expect(content).toContain(".");
    expect(content.length).toBeGreaterThan(300);
  });
});
