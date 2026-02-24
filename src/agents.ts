import { existsSync, lstatSync, symlinkSync, unlinkSync, readlinkSync, type Stats } from "node:fs";
import path from "node:path";
import { ensureDir, expandHome } from "./utils.js";

const DEFAULT_CANONICAL_SKILLS_DIR = "~/.skills";

export type AgentTarget = {
  name: string;
  flag: string;
  skillsDir: string;
  detect: () => boolean;
};

export const AGENT_TARGETS: AgentTarget[] = [
  {
    name: "claude",
    flag: "--claude",
    skillsDir: "~/.claude/skills",
    detect: () => existsSync(expandHome("~/.claude")),
  },
  {
    name: "cursor",
    flag: "--cursor",
    skillsDir: "~/.cursor/rules",
    detect: () => existsSync(expandHome("~/.cursor")),
  },
  {
    name: "codex",
    flag: "--codex",
    skillsDir: "~/.codex/skills",
    detect: () => existsSync(expandHome("~/.codex")),
  },
  {
    name: "openclaw",
    flag: "--openclaw",
    skillsDir: "~/.openclaw/workspace/skills",
    detect: () => existsSync(expandHome("~/.openclaw")),
  },
];

function resolveAbsolute(input: string): string {
  return path.resolve(expandHome(input));
}

function tryLstat(pathname: string): Stats | null {
  try {
    return lstatSync(pathname);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function isSameLinkTarget(linkPath: string, expectedTarget: string): boolean {
  const currentTarget = readlinkSync(linkPath);
  const resolvedCurrentTarget = path.resolve(path.dirname(linkPath), currentTarget);
  return resolvedCurrentTarget === expectedTarget;
}

async function linkSkill(toolId: string, linkDir: string, canonicalSkillsDir = DEFAULT_CANONICAL_SKILLS_DIR): Promise<string | null> {
  const sourceDir = path.join(resolveAbsolute(canonicalSkillsDir), toolId);
  if (!existsSync(sourceDir)) {
    throw new Error(`Skill directory does not exist: ${sourceDir}`);
  }

  const resolvedLinkDir = resolveAbsolute(linkDir);
  await ensureDir(resolvedLinkDir);

  const targetPath = path.join(resolvedLinkDir, toolId);
  const stat = tryLstat(targetPath);
  if (stat) {
    if (stat.isSymbolicLink()) {
      if (isSameLinkTarget(targetPath, sourceDir)) {
        return null;
      }
      const currentTarget = path.resolve(path.dirname(targetPath), readlinkSync(targetPath));
      throw new Error(`Refusing to overwrite existing symlink: ${targetPath} -> ${currentTarget}`);
    }
    throw new Error(`Refusing to overwrite existing non-symlink path: ${targetPath}`);
  }

  symlinkSync(sourceDir, targetPath, "dir");
  return targetPath;
}

function removeLink(linkPath: string): boolean {
  const stat = tryLstat(linkPath);
  if (!stat) {
    return false;
  }
  if (!stat.isSymbolicLink()) {
    return false;
  }

  unlinkSync(linkPath);
  return true;
}

export function resolveAgentFlag(flag: string): AgentTarget | undefined {
  return AGENT_TARGETS.find((target) => target.flag === flag);
}

export function detectAgents(): AgentTarget[] {
  return AGENT_TARGETS.filter((target) => target.detect());
}

export async function linkSkillToAgent(toolId: string, agent: AgentTarget, canonicalSkillsDir?: string): Promise<string | null> {
  return linkSkill(toolId, agent.skillsDir, canonicalSkillsDir);
}

export function unlinkSkillFromAgent(toolId: string, agent: AgentTarget): boolean {
  const targetPath = path.join(resolveAbsolute(agent.skillsDir), toolId);
  return removeLink(targetPath);
}

export async function linkSkillToDir(toolId: string, dirPath: string, canonicalSkillsDir?: string): Promise<string | null> {
  return linkSkill(toolId, dirPath, canonicalSkillsDir);
}

export function unlinkAll(toolId: string, linkPaths: string[]): string[] {
  const removed: string[] = [];

  for (const rawPath of linkPaths) {
    const resolvedPath = resolveAbsolute(rawPath);
    const candidates = new Set<string>();
    if (path.basename(resolvedPath) === toolId) {
      candidates.add(resolvedPath);
    } else {
      candidates.add(path.join(resolvedPath, toolId));
      candidates.add(resolvedPath);
    }

    for (const candidate of candidates) {
      if (removeLink(candidate)) {
        removed.push(candidate);
      }
    }
  }

  return removed;
}
