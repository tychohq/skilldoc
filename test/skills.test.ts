import { describe, expect, it } from "bun:test";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const SKILLS_DIR = path.join(os.homedir(), ".agents/skills");

// New Phase 3 tools that should have auto-generated skills.
// Excludes agent-browser, supabase, vercel which have hand-written skills.
const DISTILLED_TOOL_IDS = [
  "openclaw",
  "gh",
  "bird",
  "gog",
  "agentmail",
  "claude",
  "ralphy",
  "memo",
  "remindctl",
  "gifgrep",
  "ffmpeg",
  "jq",
  "curl",
  "uv",
  "uvx",
];

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe("skilldoc distill — new registry entries", () => {
  it("SKILL.md exists for every new tool", async () => {
    for (const id of DISTILLED_TOOL_IDS) {
      const skillMd = path.join(SKILLS_DIR, id, "SKILL.md");
      const exists = await fileExists(skillMd);
      expect(exists, `missing SKILL.md for ${id}`).toBe(true);
    }
  });

  it("SKILL.md has generated-from marker for every new tool", async () => {
    for (const id of DISTILLED_TOOL_IDS) {
      const skillMd = path.join(SKILLS_DIR, id, "SKILL.md");
      const content = await readFile(skillMd, "utf8");
      expect(content, `${id} SKILL.md missing generated-from marker`).toContain(
        "generated-from: skilldoc"
      );
    }
  });

  it("SKILL.md has YAML frontmatter with name and description for every new tool", async () => {
    for (const id of DISTILLED_TOOL_IDS) {
      const skillMd = path.join(SKILLS_DIR, id, "SKILL.md");
      const content = await readFile(skillMd, "utf8");
      const lines = content.split("\n");
      expect(lines[0], `${id} SKILL.md must start with ---`).toBe("---");
      expect(content, `${id} SKILL.md missing name field`).toContain(`name: ${id}`);
      expect(content, `${id} SKILL.md missing description`).toMatch(/description: .+/);
    }
  });

  it("docs/advanced.md exists for every new tool", async () => {
    for (const id of DISTILLED_TOOL_IDS) {
      const advancedMd = path.join(SKILLS_DIR, id, "docs", "advanced.md");
      const exists = await fileExists(advancedMd);
      expect(exists, `missing docs/advanced.md for ${id}`).toBe(true);
    }
  });

  it("docs/recipes.md exists for every new tool", async () => {
    for (const id of DISTILLED_TOOL_IDS) {
      const recipesMd = path.join(SKILLS_DIR, id, "docs", "recipes.md");
      const exists = await fileExists(recipesMd);
      expect(exists, `missing docs/recipes.md for ${id}`).toBe(true);
    }
  });

  it("docs/troubleshooting.md exists for every new tool", async () => {
    for (const id of DISTILLED_TOOL_IDS) {
      const troubleshootingMd = path.join(SKILLS_DIR, id, "docs", "troubleshooting.md");
      const exists = await fileExists(troubleshootingMd);
      expect(exists, `missing docs/troubleshooting.md for ${id}`).toBe(true);
    }
  });
});
