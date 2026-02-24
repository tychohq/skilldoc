import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readlinkSync } from "node:fs";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AGENT_TARGETS,
  type AgentTarget,
  detectAgents,
  linkSkillToAgent,
  linkSkillToDir,
  resolveAgentFlag,
  unlinkAll,
  unlinkSkillFromAgent,
} from "../src/agents.js";

describe("agents", () => {
  let tempDir: string;
  let originalDetectFns: Array<() => boolean>;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "skilldoc-agents-test-"));
    originalDetectFns = AGENT_TARGETS.map((target) => target.detect);
  });

  afterEach(async () => {
    for (const [index, detect] of originalDetectFns.entries()) {
      AGENT_TARGETS[index].detect = detect;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  async function createCanonicalSkillRoot(toolId: string): Promise<string> {
    const canonicalRoot = path.join(tempDir, "canonical");
    const skillDir = path.join(canonicalRoot, toolId);
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "SKILL.md"), "# test skill\n", "utf8");
    return canonicalRoot;
  }

  function createAgent(name: string, skillsDir: string): AgentTarget {
    return {
      name,
      flag: `--${name}`,
      skillsDir,
      detect: () => true,
    };
  }

  it("resolveAgentFlag finds known flags", () => {
    expect(resolveAgentFlag("--claude")?.name).toBe("claude");
    expect(resolveAgentFlag("--cursor")?.name).toBe("cursor");
    expect(resolveAgentFlag("--codex")?.name).toBe("codex");
    expect(resolveAgentFlag("--openclaw")?.name).toBe("openclaw");
  });

  it("resolveAgentFlag returns undefined for unknown flags", () => {
    expect(resolveAgentFlag("--unknown")).toBeUndefined();
  });

  it("detectAgents returns agents whose config dirs exist", async () => {
    const installed = new Set(["claude", "openclaw"]);

    for (const target of AGENT_TARGETS) {
      const markerDir = path.join(tempDir, target.name);
      if (installed.has(target.name)) {
        await mkdir(markerDir, { recursive: true });
      }
      target.detect = () => existsSync(markerDir);
    }

    const detected = detectAgents().map((target) => target.name).sort();
    expect(detected).toEqual(["claude", "openclaw"]);
  });

  it("linkSkillToAgent creates a working symlink", async () => {
    const toolId = "jq";
    const canonicalRoot = await createCanonicalSkillRoot(toolId);
    const agent = createAgent("test-agent", path.join(tempDir, "agent-skills"));

    const linkPath = await linkSkillToAgent(toolId, agent, canonicalRoot);
    const expectedLinkPath = path.join(agent.skillsDir, toolId);
    const expectedSource = path.join(canonicalRoot, toolId);

    expect(linkPath).toBe(expectedLinkPath);
    expect(existsSync(expectedLinkPath)).toBe(true);
    expect(path.resolve(path.dirname(expectedLinkPath), readlinkSync(expectedLinkPath))).toBe(expectedSource);
  });

  it("linkSkillToAgent is a no-op when correct symlink already exists", async () => {
    const toolId = "jq";
    const canonicalRoot = await createCanonicalSkillRoot(toolId);
    const agent = createAgent("test-agent", path.join(tempDir, "agent-skills"));

    await linkSkillToAgent(toolId, agent, canonicalRoot);
    const result = await linkSkillToAgent(toolId, agent, canonicalRoot);
    expect(result).toBeNull();
  });

  it("linkSkillToAgent throws when target exists and is not the right symlink", async () => {
    const toolId = "jq";
    const canonicalRoot = await createCanonicalSkillRoot(toolId);
    const otherRoot = await createCanonicalSkillRoot("other");
    const agent = createAgent("test-agent", path.join(tempDir, "agent-skills"));
    const existingPath = path.join(agent.skillsDir, toolId);

    await mkdir(agent.skillsDir, { recursive: true });
    await symlink(path.join(otherRoot, "other"), existingPath, "dir");

    await expect(linkSkillToAgent(toolId, agent, canonicalRoot)).rejects.toThrow(
      "Refusing to overwrite existing symlink"
    );
  });

  it("unlinkSkillFromAgent removes symlinks", async () => {
    const toolId = "jq";
    const canonicalRoot = await createCanonicalSkillRoot(toolId);
    const agent = createAgent("test-agent", path.join(tempDir, "agent-skills"));
    const linkPath = path.join(agent.skillsDir, toolId);

    await linkSkillToAgent(toolId, agent, canonicalRoot);
    expect(existsSync(linkPath)).toBe(true);

    const removed = unlinkSkillFromAgent(toolId, agent);
    expect(removed).toBe(true);
    expect(existsSync(linkPath)).toBe(false);
  });

  it("unlinkAll removes multiple symlinks", async () => {
    const toolId = "jq";
    const canonicalRoot = await createCanonicalSkillRoot(toolId);
    const dirA = path.join(tempDir, "links-a");
    const dirB = path.join(tempDir, "links-b");

    const linkA = await linkSkillToDir(toolId, dirA, canonicalRoot);
    const linkB = await linkSkillToDir(toolId, dirB, canonicalRoot);

    expect(linkA).not.toBeNull();
    expect(linkB).not.toBeNull();

    const removed = unlinkAll(toolId, [dirA, path.join(dirB, toolId)]).sort();
    expect(removed).toEqual([path.join(dirA, toolId), path.join(dirB, toolId)]);
    expect(existsSync(path.join(dirA, toolId))).toBe(false);
    expect(existsSync(path.join(dirB, toolId))).toBe(false);
  });

  it("linkSkillToDir creates symlinks from arbitrary directories", async () => {
    const toolId = "jq";
    const canonicalRoot = await createCanonicalSkillRoot(toolId);
    const targetDir = path.join(tempDir, "custom-links");
    const linkPath = path.join(targetDir, toolId);

    const created = await linkSkillToDir(toolId, targetDir, canonicalRoot);
    expect(created).toBe(linkPath);
    expect(existsSync(linkPath)).toBe(true);
    expect(path.resolve(path.dirname(linkPath), readlinkSync(linkPath))).toBe(
      path.join(canonicalRoot, toolId)
    );
  });
});
