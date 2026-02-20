import path from "node:path";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { writeFileEnsured, ensureDir } from "./utils.js";

const DEFAULT_SKILLS_DIR = "~/.agents/skills";
const DEFAULT_DOCS_DIR = "~/.agents/docs/tool-docs";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

const GENERATED_MARKER = "generated-from: agent-tool-docs";

export type DistillResult = {
  toolId: string;
  outDir: string;
  skipped?: boolean;
  skipReason?: string;
  sizeWarnings?: string[];
};

const SIZE_LIMITS: Record<string, number> = {
  "SKILL.md": 2000,
  "advanced.md": 2000,
  "recipes.md": 2000,
  "troubleshooting.md": 1000,
};

export type LLMCaller = (rawDocs: string, toolId: string, model: string) => DistilledContent;

export type DistillOptions = {
  toolId: string;
  docsDir: string;
  outDir: string;
  model: string;
  llmCaller?: LLMCaller;
};

export async function distillTool(options: DistillOptions): Promise<DistillResult> {
  const { toolId, docsDir, outDir, model, llmCaller = callLLM } = options;

  // Check if skill exists and was hand-written (no marker)
  const skillPath = path.join(outDir, "SKILL.md");
  if (existsSync(skillPath)) {
    const existing = await readFile(skillPath, "utf8");
    if (!existing.includes(GENERATED_MARKER)) {
      return { toolId, outDir, skipped: true, skipReason: "hand-written skill (no generated-from marker)" };
    }
  }

  // Read raw docs
  const rawContent = await gatherRawDocs(toolId, docsDir);
  if (!rawContent) {
    return { toolId, outDir, skipped: true, skipReason: `no raw docs found in ${docsDir}/${toolId}` };
  }

  // Call LLM to distill
  const distilled = llmCaller(rawContent, toolId, model);

  // Write output files
  await ensureDir(outDir);
  await ensureDir(path.join(outDir, "docs"));

  const now = new Date().toISOString();
  const version = detectVersion(toolId);
  const skillMd = addMetadataHeader(distilled.skill, toolId, distilled.description, now, version);

  await writeFileEnsured(path.join(outDir, "SKILL.md"), skillMd);
  await writeFileEnsured(path.join(outDir, "docs", "advanced.md"), distilled.advanced);
  await writeFileEnsured(path.join(outDir, "docs", "recipes.md"), distilled.recipes);
  await writeFileEnsured(path.join(outDir, "docs", "troubleshooting.md"), distilled.troubleshooting);

  const sizeWarnings = checkSizeLimits({
    "SKILL.md": skillMd,
    "advanced.md": distilled.advanced,
    "recipes.md": distilled.recipes,
    "troubleshooting.md": distilled.troubleshooting,
  });

  return { toolId, outDir, ...(sizeWarnings.length > 0 ? { sizeWarnings } : {}) };
}

async function gatherRawDocs(toolId: string, docsDir: string): Promise<string | null> {
  const toolMdPath = path.join(docsDir, toolId, "tool.md");
  if (!existsSync(toolMdPath)) return null;

  const parts: string[] = [];
  parts.push(await readFile(toolMdPath, "utf8"));

  // Include command docs if they exist
  const commandsDir = path.join(docsDir, toolId, "commands");
  if (existsSync(commandsDir)) {
    const commandDirs = readdirSync(commandsDir);
    for (const cmdDir of commandDirs.sort()) {
      const cmdMd = path.join(commandsDir, cmdDir, "command.md");
      if (existsSync(cmdMd)) {
        parts.push(await readFile(cmdMd, "utf8"));
      }
    }
  }

  return parts.join("\n\n---\n\n");
}

type DistilledContent = {
  description: string;
  skill: string;
  advanced: string;
  recipes: string;
  troubleshooting: string;
};

function checkSizeLimits(files: Record<string, string>): string[] {
  const warnings: string[] = [];
  for (const [name, content] of Object.entries(files)) {
    const limit = SIZE_LIMITS[name];
    if (limit === undefined) continue;
    const size = new TextEncoder().encode(content).length;
    if (size > limit) {
      warnings.push(`${name} is ${size} bytes (limit: ${limit} bytes)`);
    }
  }
  return warnings;
}

function buildPrompt(rawDocs: string, toolId: string): string {
  return `You are an agent documentation specialist. Your task is to distill raw CLI documentation into lean, agent-optimized skill files.

## Raw Documentation for: ${toolId}

${rawDocs}

---

## Your Task

Produce 4 documentation files in JSON format. **SKILL.md is the most important file** — agents read it first on 90% of requests. When in doubt, put essential information in SKILL.md.

Prioritize across all files:
1. **Most-used flags/commands first** — the 20% of flags that cover 80% of real-world use
2. **Real-world usage patterns** over exhaustive flag lists — show how to accomplish tasks, not just what flags exist
3. **Agent-specific gotchas** — quoting pitfalls, escaping issues, common errors, flags LLMs commonly misuse, output format surprises
4. **Concrete runnable examples** over abstract descriptions

Per-file size targets (strict — return less content rather than exceed these):
- "skill": ≤ 2000 bytes — the essential quick reference every agent needs
- "advanced": ≤ 2000 bytes — power-user flags and edge cases
- "recipes": ≤ 2000 bytes — task-oriented examples
- "troubleshooting": ≤ 1000 bytes — known gotchas and common LLM mistakes

Return ONLY a JSON object with exactly these keys:
- "description": one-line description of the tool for the YAML frontmatter (no markdown, plain text only)
- "skill": SKILL.md content — quick reference, the most important commands/flags, common patterns
- "advanced": docs/advanced.md content — power-user flags, edge cases
- "recipes": docs/recipes.md content — task-oriented recipes showing real commands
- "troubleshooting": docs/troubleshooting.md content — known gotchas, error patterns, things LLMs get wrong

SKILL.md format:
\`\`\`
# <tool display name>

<one-line description>

## Quick Reference
\`\`\`
<binary> <most common usage>
\`\`\`

## Key Commands / Flags
<concise table or list of the 5-10 most important commands/flags>

## Common Patterns
<3-5 concrete examples covering the most common use cases>
\`\`\`

docs/advanced.md format:
\`\`\`
# <tool> — Advanced Usage

## Power-User Flags
<flags and options that experienced users rely on, with concrete usage>

## Edge Cases
<known edge cases, non-obvious behaviors, environment-specific quirks>
\`\`\`

docs/recipes.md format:
\`\`\`
# <tool> — Recipes

## <Task Name>
\`\`\`
<complete, runnable command>
\`\`\`

(3-6 task-oriented recipes covering the most common real-world use cases)
\`\`\`

docs/troubleshooting.md format:
\`\`\`
# <tool> — Troubleshooting

## <Issue or Error Name>
**Symptom:** <what the user or agent sees>
**Fix:** <what to do>

## Common LLM Mistakes
<things AI agents typically get wrong — wrong flags, quoting issues, incorrect assumptions>
\`\`\`

Keep each file ruthlessly concise. No padding, no exhaustive lists. Respect the per-file byte limits. SKILL.md is the most important — agents rely on it first.

Return ONLY valid JSON, no markdown fences around the JSON itself.`;
}

type ExecResult = {
  error?: Error;
  stdout: string | null;
  stderr: string | null;
  status: number | null;
};

type ExecFn = (
  command: string,
  args: ReadonlyArray<string>,
  options: { input: string; encoding: "utf8"; maxBuffer: number }
) => ExecResult;

const defaultExec: ExecFn = (command, args, options) =>
  spawnSync(command, [...args], options) as ExecResult;

export function callLLM(
  rawDocs: string,
  toolId: string,
  model: string,
  exec: ExecFn = defaultExec
): DistilledContent {
  const prompt = buildPrompt(rawDocs, toolId);

  const result = exec("claude", ["-p", "--output-format", "text", "--model", model, "--no-session-persistence"], {
    input: prompt,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`Failed to run claude: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = result.stderr ?? "";
    throw new Error(`claude exited with code ${result.status}${stderr ? `: ${stderr.slice(0, 200)}` : ""}`);
  }

  const output = result.stdout ?? "";
  if (!output.trim()) {
    const stderr = result.stderr ?? "";
    throw new Error(`claude returned empty output${stderr ? `: ${stderr.slice(0, 200)}` : ""}`);
  }

  return parseDistilledOutput(output);
}

export function parseDistilledOutput(output: string): DistilledContent {
  // Strip markdown fences if present
  const stripped = output.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(`Failed to parse LLM output as JSON: ${stripped.slice(0, 200)}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("LLM output is not a JSON object");
  }

  const obj = parsed as Record<string, unknown>;
  const required = ["description", "skill", "advanced", "recipes", "troubleshooting"];
  for (const key of required) {
    if (typeof obj[key] !== "string") {
      throw new Error(`LLM output missing required key: ${key}`);
    }
  }

  return {
    description: obj.description as string,
    skill: obj.skill as string,
    advanced: obj.advanced as string,
    recipes: obj.recipes as string,
    troubleshooting: obj.troubleshooting as string,
  };
}

export function detectVersion(toolId: string, exec: ExecFn = defaultExec): string | undefined {
  for (const flag of ["--version", "-V"]) {
    const result = exec(toolId, [flag], { input: "", encoding: "utf8", maxBuffer: 1024 * 1024 });
    if (result.status === 0 && result.stdout) {
      const firstLine = result.stdout.trim().split("\n")[0];
      if (firstLine) return firstLine;
    }
  }
  return undefined;
}

function addMetadataHeader(
  skillContent: string,
  toolId: string,
  description: string,
  generatedAt: string,
  version?: string
): string {
  const lines = [
    "---",
    `name: ${toolId}`,
    `description: ${description}`,
    `${GENERATED_MARKER}`,
    `tool-id: ${toolId}`,
  ];
  if (version) lines.push(`tool-version: ${version}`);
  lines.push(`generated-at: ${generatedAt}`, "---", "");
  return lines.join("\n") + skillContent;
}

export { DEFAULT_SKILLS_DIR, DEFAULT_DOCS_DIR, DEFAULT_MODEL };
