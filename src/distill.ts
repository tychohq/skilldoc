import path from "node:path";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync, readdirSync, statSync } from "node:fs";
import YAML from "yaml";
import { writeFileEnsured, ensureDir, expandHome } from "./utils.js";

const DEFAULT_SKILLS_DIR = "~/.agents/skills";
const DEFAULT_DOCS_DIR = "~/.agents/docs/tool-docs";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_DISTILL_CONFIG_PATH = "~/.agents/tool-docs/distill-config.yaml";

const GENERATED_MARKER = "generated-from: agent-tool-docs";

/**
 * Sentinel value returned (in all text fields) by the LLM when raw docs are
 * empty or lack sufficient content to produce meaningful documentation.
 * distillTool detects this and skips writing output files.
 */
export const INSUFFICIENT_DOCS_SENTINEL = "Insufficient raw docs — re-run generate after fixing parser";

/**
 * Configuration for the distillation prompt template.
 *
 * All fields are optional — defaults match the tuned values from prompt engineering.
 * Create ~/.agents/tool-docs/distill-config.yaml to override without touching source code.
 *
 * Example distill-config.yaml:
 *
 *   # Tighter size budget — forces more aggressive compression
 *   sizeLimits:
 *     skill: 1500
 *     troubleshooting: 800
 *
 *   # Add a custom priority that front-loads safety-relevant flags
 *   priorities:
 *     - "**Most-used flags/commands first** — the 20% of flags that cover 80% of real-world use"
 *     - "**Safety flags** — flags that prevent data loss or destructive side effects"
 *     - "**Real-world usage patterns** over exhaustive flag lists"
 *     - "**Agent-specific gotchas** — quoting pitfalls, escaping issues, common errors"
 *     - "**Concrete runnable examples** over abstract descriptions"
 *
 *   # Append project-level guidance to every distillation prompt
 *   extraInstructions: |
 *     This documentation set is used by agents running inside CI pipelines.
 *     Prefer non-interactive flags and machine-readable output formats.
 */
export type DistillPromptConfig = {
  /**
   * Per-file byte limits used in both the LLM prompt and post-generation size checks.
   * Lower values force more aggressive compression from the LLM.
   * Defaults: skill=2000, advanced=2000, recipes=2000, troubleshooting=1000.
   */
  sizeLimits?: {
    skill?: number;
    advanced?: number;
    recipes?: number;
    troubleshooting?: number;
  };
  /**
   * Prioritization rules embedded in the prompt, listed in order.
   * Each string is rendered as a numbered list item and supports markdown.
   * Changing the order or wording shifts what the LLM emphasizes.
   * Defaults encode the 80/20 rule: most-used patterns first, exhaustive coverage last.
   */
  priorities?: string[];
  /**
   * Additional instructions appended to the prompt before the JSON output requirement.
   * Use this to add project-specific conventions, tool-class guidance, or audience notes
   * without modifying the core prompt template.
   */
  extraInstructions?: string;
};

/** Default values used when a DistillPromptConfig field is omitted. */
export const DEFAULT_PROMPT_CONFIG: DistillPromptConfig = {
  sizeLimits: {
    skill: 2000,
    advanced: 2000,
    recipes: 2000,
    troubleshooting: 1000,
  },
  priorities: [
    "**Most-used flags/commands first** — the 20% of flags that cover 80% of real-world use",
    "**Real-world usage patterns** over exhaustive flag lists — show how to accomplish tasks, not just what flags exist",
    "**Agent-specific gotchas** — quoting pitfalls, escaping issues, common errors, flags LLMs commonly misuse, output format surprises",
    "**Confusion prevention** — call out commands or flags that look similar but do different things, or that have misleading names",
    "**Concrete runnable examples** over abstract descriptions",
  ],
  extraInstructions: "",
};

export type DistillResult = {
  toolId: string;
  outDir: string;
  skipped?: boolean;
  skipReason?: string;
  sizeWarnings?: string[];
};

export type LLMCaller = (rawDocs: string, toolId: string, model: string, feedback?: string) => DistilledContent;

export type DistillOptions = {
  toolId: string;
  binary: string;
  docsDir: string;
  outDir: string;
  model: string;
  llmCaller?: LLMCaller;
  feedback?: string;
  /** Prompt template config. When omitted, defaults from DEFAULT_PROMPT_CONFIG are used. */
  promptConfig?: DistillPromptConfig;
};

export async function distillTool(options: DistillOptions): Promise<DistillResult> {
  const { toolId, binary, docsDir, outDir, model, llmCaller, feedback, promptConfig = {} } = options;
  const caller: LLMCaller = llmCaller ?? ((rawDocs, tid, m, fb) => callLLM(rawDocs, tid, m, defaultExec, fb, promptConfig));

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
  const distilled = caller(rawContent, toolId, model, feedback);

  // Detect insufficient-docs sentinel — LLM signals raw docs were too sparse
  if (distilled.skill.trim() === INSUFFICIENT_DOCS_SENTINEL) {
    return { toolId, outDir, skipped: true, skipReason: INSUFFICIENT_DOCS_SENTINEL };
  }

  // Write output files
  await ensureDir(outDir);
  await ensureDir(path.join(outDir, "docs"));

  const now = new Date().toISOString();
  const version = detectVersion(binary);
  const skillMd = addMetadataHeader(distilled.skill, toolId, binary, distilled.description, now, version);

  await writeFileEnsured(path.join(outDir, "SKILL.md"), skillMd);
  await writeFileEnsured(path.join(outDir, "docs", "advanced.md"), distilled.advanced);
  await writeFileEnsured(path.join(outDir, "docs", "recipes.md"), distilled.recipes);
  await writeFileEnsured(path.join(outDir, "docs", "troubleshooting.md"), distilled.troubleshooting);

  const sizeLimits = resolveSizeLimits(promptConfig);
  const sizeWarnings = checkSizeLimits({
    "SKILL.md": skillMd,
    "advanced.md": distilled.advanced,
    "recipes.md": distilled.recipes,
    "troubleshooting.md": distilled.troubleshooting,
  }, sizeLimits);

  return { toolId, outDir, ...(sizeWarnings.length > 0 ? { sizeWarnings } : {}) };
}

export async function gatherRawDocs(toolId: string, docsDir: string): Promise<string | null> {
  const toolMdPath = path.join(docsDir, toolId, "tool.md");
  if (!existsSync(toolMdPath)) return null;

  const parts: string[] = [];
  parts.push(await readFile(toolMdPath, "utf8"));

  // Recursively include command docs if they exist
  const commandsDir = path.join(docsDir, toolId, "commands");
  const commandParts = await gatherCommandDocs(commandsDir);
  parts.push(...commandParts);

  return parts.join("\n\n---\n\n");
}

/**
 * Recursively gather all command.md files from a commands directory tree.
 * Subcommands are stored directly inside their parent command's directory
 * (not under a nested "commands/" folder), so we recurse into every subdirectory.
 */
async function gatherCommandDocs(dir: string): Promise<string[]> {
  const parts: string[] = [];
  if (!existsSync(dir)) return parts;

  const entries = readdirSync(dir) as string[];
  const subdirs = entries
    .filter((name) => statSync(path.join(dir, name)).isDirectory())
    .sort();

  for (const name of subdirs) {
    const subDir = path.join(dir, name);
    const cmdMd = path.join(subDir, "command.md");
    if (existsSync(cmdMd)) {
      parts.push(await readFile(cmdMd, "utf8"));
    }
    const nested = await gatherCommandDocs(subDir);
    parts.push(...nested);
  }

  return parts;
}

type DistilledContent = {
  description: string;
  skill: string;
  advanced: string;
  recipes: string;
  troubleshooting: string;
};

function resolveSizeLimits(config: DistillPromptConfig): Record<string, number> {
  const defaults = DEFAULT_PROMPT_CONFIG.sizeLimits!;
  const overrides = config.sizeLimits ?? {};
  return {
    "SKILL.md": overrides.skill ?? defaults.skill!,
    "advanced.md": overrides.advanced ?? defaults.advanced!,
    "recipes.md": overrides.recipes ?? defaults.recipes!,
    "troubleshooting.md": overrides.troubleshooting ?? defaults.troubleshooting!,
  };
}

function checkSizeLimits(files: Record<string, string>, limits: Record<string, number>): string[] {
  const warnings: string[] = [];
  for (const [name, content] of Object.entries(files)) {
    const limit = limits[name];
    if (limit === undefined) continue;
    const size = new TextEncoder().encode(content).length;
    if (size > limit) {
      warnings.push(`${name} is ${size} bytes (limit: ${limit} bytes)`);
    }
  }
  return warnings;
}

/**
 * Build the distillation prompt from raw docs and a (possibly partial) config.
 *
 * The prompt has three configurable sections via DistillPromptConfig:
 *   1. priorities     — numbered list of what to emphasize across all files
 *   2. sizeLimits     — per-file byte budgets stated in the prompt and enforced post-gen
 *   3. extraInstructions — appended before the JSON output requirement
 *
 * All other sections (output format specs, JSON key list, feedback injection) are fixed
 * structural elements of the prompt and are not exposed for customization.
 */
export function buildPrompt(rawDocs: string, toolId: string, feedback?: string, config: DistillPromptConfig = {}): string {
  const sl = resolveSizeLimits(config);
  const priorities = config.priorities ?? DEFAULT_PROMPT_CONFIG.priorities!;
  const extraInstructions = config.extraInstructions ?? "";

  const priorityList = priorities.map((p, i) => `${i + 1}. ${p}`).join("\n");

  return `You are an agent documentation specialist. Your task is to distill raw CLI documentation into lean, agent-optimized skill files.

## Raw Documentation for: ${toolId}

${rawDocs}

---

## Your Task

Produce 4 documentation files in JSON format. **SKILL.md is the most important file** — agents read it first on 90% of requests. When in doubt, put essential information in SKILL.md.

Prioritize across all files:
${priorityList}

Per-file size targets (strict — return less content rather than exceed these):
- "skill": ≤ ${sl["SKILL.md"]} bytes — the essential quick reference every agent needs
- "advanced": ≤ ${sl["advanced.md"]} bytes — power-user flags and edge cases
- "recipes": ≤ ${sl["recipes.md"]} bytes — task-oriented examples
- "troubleshooting": ≤ ${sl["troubleshooting.md"]} bytes — known gotchas and common LLM mistakes

**CRITICAL — Anti-hallucination rule:** You MUST ONLY use information explicitly present in the raw docs provided above. Do NOT draw on your training knowledge about this tool. Do NOT add commands, flags, examples, or behavior from your training knowledge. Do NOT invent flags, subcommands, options, or behaviors that are not documented in the raw docs above. Only distill what appears in the provided documentation.

If the input docs contain no useful content (e.g., empty, contain only parser warnings like "No commands detected", or lack sufficient content to produce meaningful documentation), output a stub skill that says 'raw docs incomplete'. To signal this, set ALL text fields ("description", "skill", "advanced", "recipes", "troubleshooting") to exactly this string: ${INSUFFICIENT_DOCS_SENTINEL}

Otherwise, always return valid JSON using only the information present in the raw docs.

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

## Critical Distinctions
<If two or more commands could plausibly be confused (similar names, overlapping purposes), add this section at the TOP explaining the differences. Omit entirely if no confusion risk exists.>

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

Return ONLY valid JSON, no markdown fences around the JSON itself.${extraInstructions ? `\n\n${extraInstructions}` : ""}${
    feedback
      ? `\n\n---\n\n## Validation Feedback\n\nA previous version of this skill was tested by AI agents and received a failing score. Please address these issues:\n\n${feedback}\n\nFix the above gaps in your new distillation.`
      : ""
  }`;
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
  exec: ExecFn = defaultExec,
  feedback?: string,
  promptConfig?: DistillPromptConfig
): DistilledContent {
  const prompt = buildPrompt(rawDocs, toolId, feedback, promptConfig);

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
  binary: string,
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
    `tool-binary: ${binary}`,
  ];
  if (version) lines.push(`tool-version: ${version}`);
  lines.push(`generated-at: ${generatedAt}`, "---", "");
  return lines.join("\n") + skillContent;
}

/**
 * Load a DistillPromptConfig from a YAML file.
 *
 * Returns an empty object (all defaults) if the file doesn't exist or is unparseable —
 * config is optional and the pipeline works fine without it.
 *
 * Recognized fields: sizeLimits (skill/advanced/recipes/troubleshooting), priorities, extraInstructions.
 * Unknown fields are silently ignored.
 */
export async function loadDistillConfig(configPath?: string): Promise<DistillPromptConfig> {
  const resolved = expandHome(configPath ?? DEFAULT_DISTILL_CONFIG_PATH);
  let raw: string;
  try {
    raw = await readFile(resolved, "utf8");
  } catch {
    return {}; // Config file is optional
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch {
    return {}; // Unparseable config falls back to defaults
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return extractDistillConfig(parsed as Record<string, unknown>);
}

function extractDistillConfig(raw: Record<string, unknown>): DistillPromptConfig {
  const config: DistillPromptConfig = {};

  if (raw.sizeLimits && typeof raw.sizeLimits === "object" && !Array.isArray(raw.sizeLimits)) {
    const sl = raw.sizeLimits as Record<string, unknown>;
    const sizeLimits: DistillPromptConfig["sizeLimits"] = {};
    for (const key of ["skill", "advanced", "recipes", "troubleshooting"] as const) {
      if (typeof sl[key] === "number") sizeLimits[key] = sl[key] as number;
    }
    config.sizeLimits = sizeLimits;
  }

  if (Array.isArray(raw.priorities) && raw.priorities.every((p) => typeof p === "string")) {
    config.priorities = raw.priorities as string[];
  }

  if (typeof raw.extraInstructions === "string") {
    config.extraInstructions = raw.extraInstructions;
  }

  return config;
}

export { DEFAULT_SKILLS_DIR, DEFAULT_DOCS_DIR, DEFAULT_MODEL, DEFAULT_DISTILL_CONFIG_PATH };
