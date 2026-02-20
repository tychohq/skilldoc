import { describe, expect, it } from "bun:test";
import { parseFlags } from "../src/cli.js";
import { DEFAULT_MODEL } from "../src/distill.js";

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
