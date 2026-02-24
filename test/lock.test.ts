import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import YAML from "yaml";
import {
  type LockEntry,
  isStale,
  loadLock,
  removeLockEntry,
  saveLock,
  updateLockEntry,
} from "../src/lock.js";

const BASE_ENTRY: LockEntry = {
  cliName: "jq",
  version: "jq-1.7.1",
  helpHash: "abc123",
  source: "help",
  syncedAt: "2026-02-23",
  generator: "skilldoc",
};

describe("lock", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "skilldoc-lock-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loadLock returns an empty lock when the file is missing", async () => {
    const lockPath = path.join(tempDir, "missing-lock.yaml");
    const lock = await loadLock(lockPath);
    expect(lock).toEqual({ skills: {} });
  });

  it("loadLock reads valid YAML lock content", async () => {
    const lockPath = path.join(tempDir, "skilldoc-lock.yaml");
    const expected = {
      skills: {
        jq: BASE_ENTRY,
        gh: {
          cliName: "gh",
          version: "2.70.0",
          helpHash: "def456",
          source: "help",
          syncedAt: "2026-02-24",
          generator: "skilldoc" as const,
          links: ["/tmp/gh-link"],
        },
      },
    };
    await writeFile(lockPath, YAML.stringify(expected), "utf8");

    const loaded = await loadLock(lockPath);
    expect(loaded).toEqual(expected);
  });

  it("saveLock writes valid YAML", async () => {
    const lockPath = path.join(tempDir, "nested", "skilldoc-lock.yaml");
    const lock = {
      skills: {
        jq: BASE_ENTRY,
      },
    };

    await saveLock(lock, lockPath);

    const raw = await readFile(lockPath, "utf8");
    const parsed = YAML.parse(raw);
    expect(parsed).toEqual(lock);
  });

  it("updateLockEntry adds new entries and updates existing ones", () => {
    const lock = { skills: {} as Record<string, LockEntry> };

    updateLockEntry(lock, "jq", BASE_ENTRY);
    expect(lock.skills.jq).toEqual(BASE_ENTRY);

    updateLockEntry(lock, "jq", {
      version: "jq-1.8.0",
      helpHash: "newhash",
      links: ["/tmp/jq-link"],
    });

    expect(lock.skills.jq).toEqual({
      ...BASE_ENTRY,
      version: "jq-1.8.0",
      helpHash: "newhash",
      links: ["/tmp/jq-link"],
    });
  });

  it("removeLockEntry removes and returns the previous entry", () => {
    const ghEntry: LockEntry = {
      cliName: "gh",
      version: "2.70.0",
      helpHash: "def456",
      source: "help",
      syncedAt: "2026-02-24",
      generator: "skilldoc",
    };
    const lock = {
      skills: {
        jq: BASE_ENTRY,
        gh: ghEntry,
      },
    };

    const removed = removeLockEntry(lock, "gh");
    expect(removed).toEqual(ghEntry);
    expect(lock.skills.gh).toBeUndefined();
    expect(lock.skills.jq).toEqual(BASE_ENTRY);
    expect(removeLockEntry(lock, "missing")).toBeUndefined();
  });

  it("isStale detects version and helpHash changes", () => {
    expect(isStale(BASE_ENTRY, "jq-1.7.1", "abc123")).toBe(false);
    expect(isStale(BASE_ENTRY, "jq-1.8.0", "abc123")).toBe(true);
    expect(isStale(BASE_ENTRY, "jq-1.7.1", "zzz999")).toBe(true);
  });
});
