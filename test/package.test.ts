import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const pkgPath = path.resolve(import.meta.dir, "../package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

describe("package.json", () => {
  it("has a description", () => {
    expect(typeof pkg.description).toBe("string");
    expect(pkg.description.length).toBeGreaterThan(0);
  });

  it("has keywords array", () => {
    expect(Array.isArray(pkg.keywords)).toBe(true);
    expect(pkg.keywords.length).toBeGreaterThan(0);
  });

  it("has homepage", () => {
    expect(typeof pkg.homepage).toBe("string");
    expect(pkg.homepage).toMatch(/^https?:\/\//);
  });

  it("has repository with type and url", () => {
    expect(pkg.repository).toBeDefined();
    expect(pkg.repository.type).toBe("git");
    expect(pkg.repository.url).toMatch(/^git\+https?:\/\//);
  });

  it("has license", () => {
    expect(typeof pkg.license).toBe("string");
    expect(pkg.license.length).toBeGreaterThan(0);
  });
});
