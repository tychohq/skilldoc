import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const README_MAX_LINES = 400;
const readmePath = path.resolve(import.meta.dir, "../README.md");

describe("README", () => {
  it(`is under ${README_MAX_LINES} lines`, () => {
    const content = readFileSync(readmePath, "utf8");
    const lines = content.split("\n").length;
    expect(lines).toBeLessThanOrEqual(README_MAX_LINES);
  });
});
