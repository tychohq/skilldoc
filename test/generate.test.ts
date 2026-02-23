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

describe("skilldoc generate — new registry entries", () => {
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

  it("index.md rows point to generated tool docs", async () => {
    const indexPath = path.join(DOCS_DIR, "index.md");
    const content = await readFile(indexPath, "utf8");
    const rows = content
      .split("\n")
      .filter((line) => line.startsWith("| ") && !line.includes("| --- |") && !line.includes("| Tool | Binary |"));

    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const cells = row.split("|").map((cell) => cell.trim()).filter((cell) => cell.length > 0);
      expect(cells.length).toBe(2);

      const [id, binary] = cells;
      const raw = await readFile(path.join(DOCS_DIR, id, "tool.json"), "utf8");
      const doc = JSON.parse(raw) as { id: string; binary: string };
      expect(doc.id).toBe(id);
      expect(doc.binary).toBe(binary);
    }
  });
});

// These 8 tools were previously broken by the parser and produced empty raw docs.
// agentmail is excluded — binary not installed.
const PREVIOUSLY_FAILING_TOOL_IDS = ["curl", "ffmpeg", "gh", "jq", "remindctl", "rg", "uvx", "vercel"];

type ToolDocShape = {
  kind: string;
  id: string;
  usage: { requiredArgs: string[]; optionalArgs: string[] } | null;
  commands: Array<{ name: string; summary: string }>;
  options: Array<{ flags: string; description: string }>;
  warnings: string[];
};

describe("skilldoc generate — previously-failing tools produce non-empty docs", () => {
  it("tool.json has non-empty content for each previously-failing tool", async () => {
    for (const id of PREVIOUSLY_FAILING_TOOL_IDS) {
      const toolJson = path.join(DOCS_DIR, id, "tool.json");
      const raw = await readFile(toolJson, "utf8");
      const doc = JSON.parse(raw) as ToolDocShape;

      const hasUsage =
        doc.usage !== null &&
        (doc.usage.requiredArgs.length > 0 || doc.usage.optionalArgs.length > 0);
      const hasContent = hasUsage || doc.commands.length > 0 || doc.options.length > 0;

      expect(hasContent, `${id}: expected usage, commands, or options — got none`).toBe(true);
    }
  });

  it("tool.md is non-trivially long for each previously-failing tool", async () => {
    for (const id of PREVIOUSLY_FAILING_TOOL_IDS) {
      const toolMd = path.join(DOCS_DIR, id, "tool.md");
      const content = await readFile(toolMd, "utf8");
      const lines = content.split("\n").filter((l: string) => l.trim().length > 0);
      expect(lines.length, `${id}: tool.md has only ${lines.length} non-empty lines`).toBeGreaterThan(5);
    }
  });

  it("curl has options parsed (no subcommands tool)", async () => {
    const raw = await readFile(path.join(DOCS_DIR, "curl", "tool.json"), "utf8");
    const doc = JSON.parse(raw) as ToolDocShape;
    expect(doc.options.length, "curl should have many options").toBeGreaterThan(50);
  });

  it("gh has commands parsed", async () => {
    const raw = await readFile(path.join(DOCS_DIR, "gh", "tool.json"), "utf8");
    const doc = JSON.parse(raw) as ToolDocShape;
    const names = doc.commands.map((c) => c.name);
    expect(doc.commands.length, "gh should have commands").toBeGreaterThan(0);
    expect(names.some((n) => n.startsWith("auth")), "gh should include auth command").toBe(true);
  });

  it("vercel has commands parsed", async () => {
    const raw = await readFile(path.join(DOCS_DIR, "vercel", "tool.json"), "utf8");
    const doc = JSON.parse(raw) as ToolDocShape;
    expect(doc.commands.length, "vercel should have commands").toBeGreaterThan(0);
    const names = doc.commands.map((c) => c.name);
    expect(names.some((n) => n.includes("deploy")), "vercel should include deploy command").toBe(true);
  });

  it("ffmpeg has usage line", async () => {
    const raw = await readFile(path.join(DOCS_DIR, "ffmpeg", "tool.json"), "utf8");
    const doc = JSON.parse(raw) as ToolDocShape;
    const hasUsage =
      doc.usage !== null &&
      (doc.usage.requiredArgs.length > 0 || doc.usage.optionalArgs.length > 0);
    expect(hasUsage, "ffmpeg should have a parsed usage line").toBe(true);
  });

  it("remindctl has commands parsed (tab-separated format)", async () => {
    const raw = await readFile(path.join(DOCS_DIR, "remindctl", "tool.json"), "utf8");
    const doc = JSON.parse(raw) as ToolDocShape;
    expect(doc.commands.length, "remindctl should have commands").toBeGreaterThan(0);
    const names = doc.commands.map((c) => c.name);
    expect(names).toContain("show");
    expect(names).toContain("add");
  });

  it("rg has options parsed (no subcommands tool)", async () => {
    const raw = await readFile(path.join(DOCS_DIR, "rg", "tool.json"), "utf8");
    const doc = JSON.parse(raw) as ToolDocShape;
    expect(doc.options.length, "rg should have many options").toBeGreaterThan(20);
  });

  it("uvx has options parsed", async () => {
    const raw = await readFile(path.join(DOCS_DIR, "uvx", "tool.json"), "utf8");
    const doc = JSON.parse(raw) as ToolDocShape;
    expect(doc.options.length, "uvx should have options").toBeGreaterThan(0);
  });

  it("jq has options parsed (filter language tool)", async () => {
    const raw = await readFile(path.join(DOCS_DIR, "jq", "tool.json"), "utf8");
    const doc = JSON.parse(raw) as ToolDocShape;
    expect(doc.options.length, "jq should have options").toBeGreaterThan(0);
  });
});
