import { describe, expect, it } from "bun:test";
import { parseFlags } from "../src/cli.js";
import { DEFAULT_MODEL, DEFAULT_SKILLS_DIR } from "../src/distill.js";
import { DEFAULT_VALIDATION_MODELS } from "../src/validate.js";

describe("parseFlags --out", () => {
  it("returns the specified path when --out is provided", () => {
    const flags = parseFlags(["--out", "/tmp/my-skills"]);
    expect(flags.out).toBe("/tmp/my-skills");
  });

  it("returns undefined for out when --out is not provided", () => {
    const flags = parseFlags(["--registry", "/some/path"]);
    expect(flags.out).toBeUndefined();
  });

  it("accepts any path string value", () => {
    const flags = parseFlags(["--out", "~/.agents/skills"]);
    expect(flags.out).toBe("~/.agents/skills");
  });

  it("throws when --out flag has no value", () => {
    expect(() => parseFlags(["--out"])).toThrow("Missing value for --out");
  });

  it("throws when --out value looks like another flag", () => {
    expect(() => parseFlags(["--out", "--registry"])).toThrow("Missing value for --out");
  });

  it("parses --out alongside other flags", () => {
    const flags = parseFlags(["--out", "/tmp/out", "--only", "rg,git", "--model", "claude-sonnet-4-6"]);
    expect(flags.out).toBe("/tmp/out");
    expect(flags.only).toBe("rg,git");
    expect(flags.model).toBe("claude-sonnet-4-6");
  });

  it("DEFAULT_SKILLS_DIR is ~/.agents/skills", () => {
    expect(DEFAULT_SKILLS_DIR).toBe("~/.agents/skills");
  });
});

describe("parseFlags --model", () => {
  it("returns the specified model when --model is provided", () => {
    const flags = parseFlags(["--model", "claude-opus-4-6"]);
    expect(flags.model).toBe("claude-opus-4-6");
  });

  it("returns undefined for model when --model is not provided", () => {
    const flags = parseFlags(["--registry", "/some/path"]);
    expect(flags.model).toBeUndefined();
  });

  it("accepts any model string value", () => {
    const flags = parseFlags(["--model", "claude-haiku-4-5-20251001"]);
    expect(flags.model).toBe("claude-haiku-4-5-20251001");
  });

  it("throws when --model flag has no value", () => {
    expect(() => parseFlags(["--model"])).toThrow("Missing value for --model");
  });

  it("throws when --model value looks like another flag", () => {
    expect(() => parseFlags(["--model", "--out"])).toThrow("Missing value for --model");
  });

  it("parses --model alongside other flags", () => {
    const flags = parseFlags(["--model", "claude-sonnet-4-6", "--only", "rg,git", "--out", "/tmp/out"]);
    expect(flags.model).toBe("claude-sonnet-4-6");
    expect(flags.only).toBe("rg,git");
    expect(flags.out).toBe("/tmp/out");
  });

  it("DEFAULT_MODEL is a non-empty string used as fallback", () => {
    expect(typeof DEFAULT_MODEL).toBe("string");
    expect(DEFAULT_MODEL.length).toBeGreaterThan(0);
  });
});

describe("parseFlags --models", () => {
  it("returns the specified models string when --models is provided", () => {
    const flags = parseFlags(["--models", "claude-sonnet-4-6,claude-opus-4-6"]);
    expect(flags.models).toBe("claude-sonnet-4-6,claude-opus-4-6");
  });

  it("returns undefined for models when --models is not provided", () => {
    const flags = parseFlags(["--registry", "/some/path"]);
    expect(flags.models).toBeUndefined();
  });

  it("accepts a single model", () => {
    const flags = parseFlags(["--models", "claude-haiku-4-5-20251001"]);
    expect(flags.models).toBe("claude-haiku-4-5-20251001");
  });

  it("throws when --models flag has no value", () => {
    expect(() => parseFlags(["--models"])).toThrow("Missing value for --models");
  });

  it("throws when --models value looks like another flag", () => {
    expect(() => parseFlags(["--models", "--skills"])).toThrow("Missing value for --models");
  });

  it("parses --models alongside other flags", () => {
    const flags = parseFlags(["--models", "model-a,model-b", "--threshold", "8"]);
    expect(flags.models).toBe("model-a,model-b");
    expect(flags.threshold).toBe("8");
  });

  it("DEFAULT_VALIDATION_MODELS contains at least 2 Claude models", () => {
    expect(DEFAULT_VALIDATION_MODELS.length).toBeGreaterThanOrEqual(2);
    expect(DEFAULT_VALIDATION_MODELS.every((m) => m.startsWith("claude-"))).toBe(true);
  });
});

describe("parseFlags --auto-redist", () => {
  it("returns true when --auto-redist is provided", () => {
    const flags = parseFlags(["--auto-redist"]);
    expect(flags["auto-redist"]).toBe(true);
  });

  it("returns undefined when --auto-redist is not provided", () => {
    const flags = parseFlags(["--model", "claude-sonnet-4-6"]);
    expect(flags["auto-redist"]).toBeUndefined();
  });

  it("parses --auto-redist alongside other flags", () => {
    const flags = parseFlags(["--auto-redist", "--threshold", "8", "--models", "claude-sonnet-4-6"]);
    expect(flags["auto-redist"]).toBe(true);
    expect(flags.threshold).toBe("8");
    expect(flags.models).toBe("claude-sonnet-4-6");
  });
});
