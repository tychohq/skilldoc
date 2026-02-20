import { describe, expect, it } from "bun:test";
import YAML from "yaml";
import { loadRegistry } from "../src/config.js";
import { writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

async function withTmpRegistry(content: string, fn: (p: string) => Promise<void>): Promise<void> {
  const dir = tmpdir();
  const tmpPath = path.join(dir, `registry-test-${Date.now()}.yaml`);
  await writeFile(tmpPath, content, "utf8");
  try {
    await fn(tmpPath);
  } finally {
    await rm(tmpPath, { force: true });
  }
}

describe("loadRegistry — category field", () => {
  it("accepts category: cli", async () => {
    const yaml = YAML.stringify({
      version: 1,
      tools: [{ id: "git", binary: "git", category: "cli" }],
    });
    await withTmpRegistry(yaml, async (p) => {
      const registry = await loadRegistry(p);
      expect(registry.tools[0].category).toBe("cli");
    });
  });

  it("accepts category: sdk", async () => {
    const yaml = YAML.stringify({
      version: 1,
      tools: [{ id: "sdk-tool", binary: "sdk", category: "sdk" }],
    });
    await withTmpRegistry(yaml, async (p) => {
      const registry = await loadRegistry(p);
      expect(registry.tools[0].category).toBe("sdk");
    });
  });

  it("accepts category: api", async () => {
    const yaml = YAML.stringify({
      version: 1,
      tools: [{ id: "api-tool", binary: "api", category: "api" }],
    });
    await withTmpRegistry(yaml, async (p) => {
      const registry = await loadRegistry(p);
      expect(registry.tools[0].category).toBe("api");
    });
  });

  it("allows category to be omitted", async () => {
    const yaml = YAML.stringify({
      version: 1,
      tools: [{ id: "rg", binary: "rg" }],
    });
    await withTmpRegistry(yaml, async (p) => {
      const registry = await loadRegistry(p);
      expect(registry.tools[0].category).toBeUndefined();
    });
  });

  it("throws on invalid category value", async () => {
    const yaml = YAML.stringify({
      version: 1,
      tools: [{ id: "rg", binary: "rg", category: "plugin" }],
    });
    await withTmpRegistry(yaml, async (p) => {
      await expect(loadRegistry(p)).rejects.toThrow('invalid category "plugin"');
    });
  });
});

describe("loadRegistry — homepage field", () => {
  it("accepts a homepage URL", async () => {
    const yaml = YAML.stringify({
      version: 1,
      tools: [{ id: "rg", binary: "rg", homepage: "https://github.com/BurntSushi/ripgrep" }],
    });
    await withTmpRegistry(yaml, async (p) => {
      const registry = await loadRegistry(p);
      expect(registry.tools[0].homepage).toBe("https://github.com/BurntSushi/ripgrep");
    });
  });

  it("allows homepage to be omitted", async () => {
    const yaml = YAML.stringify({
      version: 1,
      tools: [{ id: "rg", binary: "rg" }],
    });
    await withTmpRegistry(yaml, async (p) => {
      const registry = await loadRegistry(p);
      expect(registry.tools[0].homepage).toBeUndefined();
    });
  });
});

describe("loadRegistry — useCases field", () => {
  it("accepts an array of use case strings", async () => {
    const yaml = YAML.stringify({
      version: 1,
      tools: [{ id: "rg", binary: "rg", useCases: ["fast search", "grep with gitignore"] }],
    });
    await withTmpRegistry(yaml, async (p) => {
      const registry = await loadRegistry(p);
      expect(registry.tools[0].useCases).toEqual(["fast search", "grep with gitignore"]);
    });
  });

  it("allows useCases to be omitted", async () => {
    const yaml = YAML.stringify({
      version: 1,
      tools: [{ id: "rg", binary: "rg" }],
    });
    await withTmpRegistry(yaml, async (p) => {
      const registry = await loadRegistry(p);
      expect(registry.tools[0].useCases).toBeUndefined();
    });
  });

  it("throws when useCases is not an array", async () => {
    const raw = `version: 1\ntools:\n  - id: rg\n    binary: rg\n    useCases: "not an array"\n`;
    await withTmpRegistry(raw, async (p) => {
      await expect(loadRegistry(p)).rejects.toThrow("useCases must be an array of strings");
    });
  });
});

describe("loadRegistry — all metadata fields together", () => {
  it("parses all new fields on a single tool entry", async () => {
    const yaml = YAML.stringify({
      version: 1,
      tools: [
        {
          id: "gh",
          binary: "gh",
          displayName: "GitHub CLI",
          category: "cli",
          homepage: "https://cli.github.com",
          useCases: ["create PRs", "manage issues", "check CI status"],
        },
      ],
    });
    await withTmpRegistry(yaml, async (p) => {
      const registry = await loadRegistry(p);
      const tool = registry.tools[0];
      expect(tool.id).toBe("gh");
      expect(tool.category).toBe("cli");
      expect(tool.homepage).toBe("https://cli.github.com");
      expect(tool.useCases).toEqual(["create PRs", "manage issues", "check CI status"]);
    });
  });
});
