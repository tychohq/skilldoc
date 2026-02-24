import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { expandHome, writeFileEnsured } from "./utils.js";

export type LockEntry = {
  cliName: string;
  version: string;
  helpHash: string;
  source: string;
  syncedAt: string;
  generator: "skilldoc";
  links?: string[];
};

export type LockFile = {
  skills: Record<string, LockEntry>;
};

export const LOCK_FILE_NAME = "skilldoc-lock.yaml";
export const DEFAULT_LOCK_PATH = "~/.skills/skilldoc-lock.yaml";

function resolveLockPath(lockPath?: string): string {
  return expandHome(lockPath ?? DEFAULT_LOCK_PATH);
}

export async function loadLock(lockPath?: string): Promise<LockFile> {
  const path = resolveLockPath(lockPath);

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { skills: {} };
    }
    throw error;
  }

  const parsed = YAML.parse(raw) as { skills?: unknown } | null;
  if (!parsed || typeof parsed !== "object") {
    return { skills: {} };
  }

  const { skills } = parsed;
  if (!skills || typeof skills !== "object" || Array.isArray(skills)) {
    return { skills: {} };
  }

  return { skills: { ...(skills as Record<string, LockEntry>) } };
}

export async function saveLock(lock: LockFile, lockPath?: string): Promise<void> {
  const path = resolveLockPath(lockPath);
  await writeFileEnsured(path, YAML.stringify(lock));
}

export function updateLockEntry(lock: LockFile, toolId: string, entry: Partial<LockEntry>): void {
  const existing = lock.skills[toolId];
  lock.skills[toolId] = { ...(existing ?? {}), ...entry } as LockEntry;
}

export function removeLockEntry(lock: LockFile, toolId: string): LockEntry | undefined {
  const removed = lock.skills[toolId];
  if (removed === undefined) {
    return undefined;
  }
  delete lock.skills[toolId];
  return removed;
}

export function isStale(entry: LockEntry, currentVersion: string, currentHelpHash: string): boolean {
  return entry.version !== currentVersion || entry.helpHash !== currentHelpHash;
}
