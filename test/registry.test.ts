import { describe, expect, it } from "bun:test";
import { loadRegistry } from "../src/config.js";
import path from "node:path";
import os from "node:os";

const REGISTRY_PATH = path.join(os.homedir(), ".agents/tool-docs/registry.yaml");

const EXPECTED_TOOL_IDS = [
  "git",
  "rg",
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

describe("registry.yaml — content validation", () => {
  it("loads without errors", async () => {
    const registry = await loadRegistry(REGISTRY_PATH);
    expect(registry.version).toBe(1);
    expect(Array.isArray(registry.tools)).toBe(true);
  });

  it("contains all expected tools", async () => {
    const registry = await loadRegistry(REGISTRY_PATH);
    const ids = registry.tools.map((t) => t.id);
    for (const expected of EXPECTED_TOOL_IDS) {
      expect(ids).toContain(expected);
    }
  });

  it("every tool has a non-empty binary", async () => {
    const registry = await loadRegistry(REGISTRY_PATH);
    for (const tool of registry.tools) {
      expect(typeof tool.binary).toBe("string");
      expect(tool.binary.length).toBeGreaterThan(0);
    }
  });

  it("every tool category is cli, sdk, or api when set", async () => {
    const registry = await loadRegistry(REGISTRY_PATH);
    const valid = new Set(["cli", "sdk", "api"]);
    for (const tool of registry.tools) {
      if (tool.category !== undefined) {
        expect(valid.has(tool.category)).toBe(true);
      }
    }
  });

  it("every tool useCases is an array of strings when set", async () => {
    const registry = await loadRegistry(REGISTRY_PATH);
    for (const tool of registry.tools) {
      if (tool.useCases !== undefined) {
        expect(Array.isArray(tool.useCases)).toBe(true);
        for (const uc of tool.useCases) {
          expect(typeof uc).toBe("string");
        }
      }
    }
  });

  it("tool ids are unique", async () => {
    const registry = await loadRegistry(REGISTRY_PATH);
    const ids = registry.tools.map((t) => t.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });
});
