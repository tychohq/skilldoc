import { describe, expect, it } from "bun:test";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const DOCS_DIR = path.join(os.homedir(), ".agents/docs/tool-docs");

const NEW_TOOL_IDS = [
  "openclaw",
  "gh",
  "bird",
  "gog",
  "agentmail",
  "claude",
  "ralphy",
  "agent-browser",
  "memo",
  "remindctl",
  "gifgrep",
  "vercel",
  "supabase",
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

describe("tool-docs generate — new registry entries", () => {
  it("tool.json exists for every new tool", async () => {
    for (const id of NEW_TOOL_IDS) {
      const toolJson = path.join(DOCS_DIR, id, "tool.json");
      const exists = await fileExists(toolJson);
      expect(exists, `missing tool.json for ${id}`).toBe(true);
    }
  });

  it("tool.md exists for every new tool", async () => {
    for (const id of NEW_TOOL_IDS) {
      const toolMd = path.join(DOCS_DIR, id, "tool.md");
      const exists = await fileExists(toolMd);
      expect(exists, `missing tool.md for ${id}`).toBe(true);
    }
  });

  it("tool.json has correct structure for every new tool", async () => {
    for (const id of NEW_TOOL_IDS) {
      const toolJson = path.join(DOCS_DIR, id, "tool.json");
      const raw = await readFile(toolJson, "utf8");
      const doc = JSON.parse(raw) as Record<string, unknown>;
      expect(doc.kind, `${id} kind`).toBe("tool");
      expect(doc.id, `${id} id`).toBe(id);
      expect(typeof doc.binary, `${id} binary`).toBe("string");
      expect(Array.isArray(doc.commands), `${id} commands`).toBe(true);
      expect(Array.isArray(doc.options), `${id} options`).toBe(true);
    }
  });

  it("index.md lists all new tools", async () => {
    const indexPath = path.join(DOCS_DIR, "index.md");
    const content = await readFile(indexPath, "utf8");
    for (const id of NEW_TOOL_IDS) {
      expect(content, `index.md missing ${id}`).toContain(id);
    }
  });
});
