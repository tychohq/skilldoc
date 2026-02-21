import { describe, expect, it } from "bun:test";
import YAML from "yaml";
import { createToolEntry, loadRegistry } from "../src/config.js";
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

describe("createToolEntry", () => {
  it("sets id to the binary name", () => {
    const entry = createToolEntry("jq");
    expect(entry.id).toBe("jq");
  });

  it("sets binary to the binary name", () => {
    const entry = createToolEntry("jq");
    expect(entry.binary).toBe("jq");
  });

  it("sets displayName to the binary name", () => {
    const entry = createToolEntry("jq");
    expect(entry.displayName).toBe("jq");
  });

  it("sets helpArgs to ['--help']", () => {
    const entry = createToolEntry("jq");
    expect(entry.helpArgs).toEqual(["--help"]);
  });

  it("sets enabled to true", () => {
    const entry = createToolEntry("jq");
    expect(entry.enabled).toBe(true);
  });

  it("works with hyphenated binary names", () => {
    const entry = createToolEntry("my-tool");
    expect(entry.id).toBe("my-tool");
    expect(entry.binary).toBe("my-tool");
    expect(entry.displayName).toBe("my-tool");
  });
});

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

describe("loadRegistry — maxDepth field", () => {
  it("accepts a positive integer maxDepth", async () => {
    const yaml = YAML.stringify({
      version: 1,
      tools: [{ id: "rg", binary: "rg", maxDepth: 3 }],
    });
    await withTmpRegistry(yaml, async (p) => {
      const registry = await loadRegistry(p);
      expect(registry.tools[0].maxDepth).toBe(3);
    });
  });

  it("allows maxDepth to be omitted", async () => {
    const yaml = YAML.stringify({
      version: 1,
      tools: [{ id: "rg", binary: "rg" }],
    });
    await withTmpRegistry(yaml, async (p) => {
      const registry = await loadRegistry(p);
      expect(registry.tools[0].maxDepth).toBeUndefined();
    });
  });

  it("throws when maxDepth is zero", async () => {
    const yaml = YAML.stringify({
      version: 1,
      tools: [{ id: "rg", binary: "rg", maxDepth: 0 }],
    });
    await withTmpRegistry(yaml, async (p) => {
      await expect(loadRegistry(p)).rejects.toThrow("maxDepth must be a positive integer");
    });
  });

  it("throws when maxDepth is negative", async () => {
    const yaml = YAML.stringify({
      version: 1,
      tools: [{ id: "rg", binary: "rg", maxDepth: -1 }],
    });
    await withTmpRegistry(yaml, async (p) => {
      await expect(loadRegistry(p)).rejects.toThrow("maxDepth must be a positive integer");
    });
  });

  it("throws when maxDepth is a non-integer number", async () => {
    const raw = `version: 1\ntools:\n  - id: rg\n    binary: rg\n    maxDepth: 1.5\n`;
    await withTmpRegistry(raw, async (p) => {
      await expect(loadRegistry(p)).rejects.toThrow("maxDepth must be a positive integer");
    });
  });

  it("throws when maxDepth is a string", async () => {
    const raw = `version: 1\ntools:\n  - id: rg\n    binary: rg\n    maxDepth: "two"\n`;
    await withTmpRegistry(raw, async (p) => {
      await expect(loadRegistry(p)).rejects.toThrow("maxDepth must be a positive integer");
    });
  });

  it("accepts maxDepth: 1 (minimum valid value)", async () => {
    const yaml = YAML.stringify({
      version: 1,
      tools: [{ id: "rg", binary: "rg", maxDepth: 1 }],
    });
    await withTmpRegistry(yaml, async (p) => {
      const registry = await loadRegistry(p);
      expect(registry.tools[0].maxDepth).toBe(1);
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
