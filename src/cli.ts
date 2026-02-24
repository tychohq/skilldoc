import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import YAML from "yaml";
import pkg from "../package.json";
import { parseHelp } from "./parser.js";
import { renderCommandMarkdown, renderToolMarkdown } from "./render.js";
import { buildUsageDoc, extractUsageTokens } from "./usage.js";
import { expandHome, ensureDir, writeFileEnsured, readText } from "./utils.js";
import { resolveProvider, DEFAULT_LLM_CONFIG_PATH, type ProviderType } from "./llm.js";
import { CommandDoc, CommandSummary, ToolComplexity, ToolDoc } from "./types.js";
import { distillTool, DEFAULT_SKILLS_DIR, DEFAULT_DOCS_DIR, DEFAULT_MODEL, DEFAULT_DISTILL_CONFIG_PATH, loadDistillConfig, DistillOptions, DistillResult, DistillPromptConfig, detectVersion } from "./distill.js";
import { loadLock, saveLock, updateLockEntry, removeLockEntry, isStale, DEFAULT_LOCK_PATH, type LockFile } from "./lock.js";
import { resolveAgentFlag, detectAgents, linkSkillToAgent, linkSkillToDir, unlinkAll, AGENT_TARGETS } from "./agents.js";
import {
  validateSkillMultiModel,
  formatMultiModelReport,
  buildValidationFeedback,
  saveValidationReport,
  loadQualityReports,
  formatQualityReport,
  DEFAULT_THRESHOLD,
  DEFAULT_VALIDATION_MODELS,
  type MultiModelValidationReport,
} from "./validate.js";

const DEFAULT_OUT_DIR = "~/.skilldoc/docs";

const DEFAULT_SKILLS_OUT_DIR = DEFAULT_SKILLS_DIR;

const HELP_TEXT = `skilldoc

Usage:
  skilldoc add <tool> [--claude] [--cursor] [--codex] [--openclaw] [--global] [--dir <path>]
  skilldoc list
  skilldoc update [tool]
  skilldoc remove <tool>
  skilldoc run <tool>                         # generate + distill + validate in one shot
  skilldoc run [--only <id1,id2>] ...         # full pipeline for all locked tools
  skilldoc generate <tool>                    # generate docs for a single tool
  skilldoc generate [--only <ids>] ...        # generate from lock file
  skilldoc distill <tool>                     # distill a single tool
  skilldoc distill [--only <ids>] ...         # distill from lock file
  skilldoc refresh [--only <id1,id2>] [--diff]
  skilldoc validate <tool-id> [--skills <path>] [--models <m1,m2>] [--threshold <n>] [--auto-redist]
  skilldoc report [--skills <path>]
  skilldoc config                             # show current LLM provider config
  skilldoc config --provider <p> [--model <m>] [--api-key <k>]  # set config
  skilldoc config --reset                     # delete config file
  skilldoc --help

Commands:
  add        Run full pipeline for one tool and optionally link skill into agent directories
  list       List installed skills from ${DEFAULT_LOCK_PATH}
  update     Rebuild stale skills when version/help output changed
  remove     Remove one installed skill, lock entry, docs, and tracked links
  run        Run full pipeline: generate → distill → validate (recommended start here)
  generate   Generate docs for a single tool or all tools in the lock file
  distill    Distill raw docs into agent-optimized skills (SKILL.md + docs/)
  refresh    Re-run generate + distill for tools whose --help output has changed
  validate   Test skill quality using LLM-based scenario evaluation
  report     Show aggregate quality report across all validated tools
  config     Show or update LLM provider configuration (~/.skilldoc/config.yaml)

Options:
  --lock <path>           Path to lock file (default: ${DEFAULT_LOCK_PATH})
  --out <path>            Output directory (default: generate=${DEFAULT_OUT_DIR}, distill=${DEFAULT_SKILLS_OUT_DIR})
  --docs <path>           Path to raw docs dir for distill (default: ${DEFAULT_DOCS_DIR})
  --skills <path>         Path to skills dir for validate (default: ${DEFAULT_SKILLS_OUT_DIR})
  --only <ids>            Comma-separated list of tool ids to process
  --model <model>         LLM model for distill/auto-redist (default: ${DEFAULT_MODEL})
  --models <m1,m2>        Comma-separated models for validate (default: ${DEFAULT_VALIDATION_MODELS.join(",")})
  --threshold <n>         Minimum passing score for validate (default: ${DEFAULT_THRESHOLD})
  --distill-config <path> Path to distill prompt config YAML (default: ${DEFAULT_DISTILL_CONFIG_PATH})
  --auto-redist           Re-run distill with feedback if validation fails
  --claude                Link generated skill into ~/.claude/skills
  --cursor                Link generated skill into ~/.cursor/rules
  --codex                 Link generated skill into ~/.codex/skills
  --openclaw              Link generated skill into ~/.openclaw/workspace/skills
  --global                Link generated skill to all detected agent targets
  --dir <path>            Link generated skill into a custom directory
  --diff                  Show diff of skill output after refresh
  -h, --help              Show this help
`;

const VERSION = pkg.version;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help") || args.length === 0) {
    console.log(HELP_TEXT.trimEnd());
    return;
  }

  const command = args[0];
  const flags = parseFlags(args.slice(1));

  if (command === "run") {
    const positional = extractPositionalArgs(args.slice(1));
    if (positional.length > 0) {
      const result = await handleRun(positional[0], flags);
      if (!result.passed) process.exit(1);
    } else {
      await handleRunBatch(flags);
    }
    return;
  }

  if (command === "add") {
    const positional = extractPositionalArgs(args.slice(1));
    if (positional.length === 0) {
      console.error("add requires a <tool> argument");
      process.exit(1);
    }
    const result = await handleAdd(positional[0], flags);
    if (!result.passed) process.exit(1);
    return;
  }

  if (command === "list") {
    await handleList();
    return;
  }

  if (command === "update") {
    const positional = extractPositionalArgs(args.slice(1));
    const allPassed = await handleUpdate(positional[0], flags);
    if (!allPassed) process.exit(1);
    return;
  }

  if (command === "remove") {
    const positional = extractPositionalArgs(args.slice(1));
    if (positional.length === 0) {
      console.error("remove requires a <tool> argument");
      process.exit(1);
    }
    await handleRemove(positional[0]);
    return;
  }

  if (command === "generate") {
    const positional = extractPositionalArgs(args.slice(1));
    await handleGenerate(flags, positional[0]);
    return;
  }

  if (command === "distill") {
    const positional = extractPositionalArgs(args.slice(1));
    await handleDistill(flags, positional[0]);
    return;
  }

  if (command === "refresh") {
    await handleRefresh(flags);
    return;
  }

  if (command === "validate") {
    const subArgs = args.slice(1);
    const toolId = subArgs.find((a) => !a.startsWith("-"));
    if (!toolId) {
      console.error("validate requires a <tool-id> argument");
      process.exit(1);
    }
    await handleValidate(toolId, flags);
    return;
  }

  if (command === "report") {
    await handleReport(flags);
    return;
  }

  if (command === "config") {
    await handleConfig(flags);
    return;
  }

  if (command === "--version" || command === "-v") {
    console.log(VERSION);
    return;
  }

  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

const VALUE_FLAGS = new Set([
  "--lock", "--out", "--only", "--docs", "--model",
  "--models", "--skills", "--threshold", "--distill-config",
  "--provider", "--api-key", "--dir",
]);

export function extractPositionalArgs(args: string[]): string[] {
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("-")) {
      if (VALUE_FLAGS.has(arg)) i++;
      continue;
    }
    positional.push(arg);
  }
  return positional;
}

export function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("-")) continue;
    if (
      arg === "--auto-redist"
      || arg === "--diff"
      || arg === "--reset"
      || arg === "--claude"
      || arg === "--cursor"
      || arg === "--codex"
      || arg === "--openclaw"
      || arg === "--global"
    ) {
      flags[arg.replace(/^--/, "")] = true;
      continue;
    }
    if (
      arg === "--lock"
      || arg === "--out"
      || arg === "--only"
      || arg === "--docs"
      || arg === "--model"
      || arg === "--models"
      || arg === "--skills"
      || arg === "--threshold"
      || arg === "--distill-config"
      || arg === "--provider"
      || arg === "--api-key"
      || arg === "--dir"
    ) {
      const value = args[i + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`Missing value for ${arg}`);
      }
      const key = arg.replace(/^--/, "");
      flags[key] = value;
      i += 1;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      flags.help = true;
      continue;
    }
  }
  return flags;
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function resolveToolBinary(toolId: string): Promise<string> {
  const lock = await loadLock();
  return lock.skills[toolId]?.cliName ?? toolId;
}

function collectRequestedAgents(flags: Record<string, string | boolean>): Array<(typeof AGENT_TARGETS)[number]> {
  const requested: Array<(typeof AGENT_TARGETS)[number]> = [];

  for (const target of AGENT_TARGETS) {
    const key = target.flag.replace(/^--/, "");
    if (flags[key] !== true) continue;
    const resolved = resolveAgentFlag(target.flag);
    if (resolved) requested.push(resolved);
  }

  if (flags.global === true) {
    for (const target of detectAgents()) {
      requested.push(target);
    }
  }

  const deduped = new Map<string, (typeof AGENT_TARGETS)[number]>();
  for (const target of requested) {
    deduped.set(target.name, target);
  }
  return [...deduped.values()];
}

/**
 * Derive a skill token limit from a tool's complexity setting.
 * simple → 500 tokens (single-command tools like jq, rg)
 * complex → 1000 tokens (multi-subcommand tools like gh, railway, wrangler)
 */
export const COMPLEXITY_SKILL_LIMITS: Record<ToolComplexity, number> = {
  simple: 500,
  complex: 1000,
};

/**
 * Merge a tool's complexity into a base DistillPromptConfig.
 * If the base config already has an explicit sizeLimits.skill, it takes priority.
 * If complexity is undefined, the base config is returned unchanged.
 */
export function applyComplexity(base: DistillPromptConfig, complexity?: ToolComplexity): DistillPromptConfig {
  if (!complexity || base.sizeLimits?.skill !== undefined) return base;
  return {
    ...base,
    sizeLimits: { ...base.sizeLimits, skill: COMPLEXITY_SKILL_LIMITS[complexity] },
  };
}

export async function handleDistill(
  flags: Record<string, string | boolean>,
  toolId?: string,
  distillFn: (opts: DistillOptions) => Promise<DistillResult> = distillTool,
  { loadLockFn = loadLock }: { loadLockFn?: (lockPath?: string) => Promise<LockFile> } = {}
): Promise<void> {
  const docsDir = expandHome(
    typeof flags.docs === "string" ? flags.docs : DEFAULT_DOCS_DIR
  );
  const outBase = expandHome(
    typeof flags.out === "string" ? flags.out : DEFAULT_SKILLS_OUT_DIR
  );
  const model = typeof flags.model === "string" ? flags.model : DEFAULT_MODEL;
  const distillConfigPath = typeof flags["distill-config"] === "string" ? flags["distill-config"] : undefined;

  const promptConfig = await loadDistillConfig(distillConfigPath);

  let tools: Array<{ id: string; binary: string; complexity?: ToolComplexity }>;

  if (toolId) {
    // Ad-hoc mode: distill a single tool by id
    const rawDocsPath = path.join(docsDir, toolId, "tool.md");
    if (!existsSync(rawDocsPath)) {
      console.error(`Error: no raw docs found for "${toolId}". Run "skilldoc generate ${toolId}" first.`);
      process.exit(1);
    }
    tools = [{ id: toolId, binary: toolId }];
  } else {
    // Lock file mode: distill all (or filtered) locked tools
    const lockPath = typeof flags.lock === "string" ? expandHome(flags.lock) : undefined;
    const only = typeof flags.only === "string" ? new Set(flags.only.split(",").map((v) => v.trim())) : null;
    const lock = await loadLockFn(lockPath);
    tools = Object.entries(lock.skills)
      .filter(([id]) => (only ? only.has(id) : true))
      .map(([id, entry]) => ({
        id,
        binary: entry.cliName || id,
        complexity: entry.complexity,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  let generated = 0;
  let skipped = 0;

  for (const tool of tools) {
    const outDir = path.join(outBase, tool.id);
    process.stdout.write(`distill ${tool.id}... `);
    const toolPromptConfig = applyComplexity(promptConfig, tool.complexity);
    const result = await distillFn({ toolId: tool.id, binary: tool.binary, docsDir, outDir, model, promptConfig: toolPromptConfig });
    if (result.skipped) {
      console.log(`skipped (${result.skipReason})`);
      skipped += 1;
    } else {
      const warnings = result.sizeWarnings ?? [];
      console.log(warnings.length > 0 ? `done (size warnings: ${warnings.join(", ")})` : "done");
      generated += 1;
    }
  }

  console.log(`Distilled ${generated} tool(s), skipped ${skipped}, output: ${outBase}`);
}

async function handleValidate(toolId: string, flags: Record<string, string | boolean>): Promise<void> {
  const skillsDir = expandHome(
    typeof flags.skills === "string" ? flags.skills : DEFAULT_SKILLS_OUT_DIR
  );
  const modelsFlag = typeof flags.models === "string" ? flags.models : DEFAULT_VALIDATION_MODELS.join(",");
  const models = modelsFlag.split(",").map((m) => m.trim()).filter((m) => m.length > 0);
  const threshold =
    typeof flags.threshold === "string" ? parseInt(flags.threshold, 10) : DEFAULT_THRESHOLD;
  const autoRedist = flags["auto-redist"] === true;

  if (isNaN(threshold) || threshold < 1 || threshold > 10) {
    console.error("--threshold must be a number between 1 and 10");
    process.exit(1);
  }

  if (models.length === 0) {
    console.error("--models must include at least one model");
    process.exit(1);
  }

  process.stdout.write(`validate ${toolId} (${models.join(", ")})...\n`);

  try {
    const report = await validateSkillMultiModel({ toolId, skillsDir, models, threshold });
    console.log(formatMultiModelReport(report));

    await saveValidationReport(report, skillsDir);

    if (!report.passed && autoRedist) {
      await handleAutoRedist(toolId, buildValidationFeedback(report), flags);
    }

    if (!report.passed) {
      console.log(`\nValidation failed (score: ${report.overallAverageScore.toFixed(1)}, threshold: ${threshold})`);
      if (!autoRedist) {
        console.log(`Tip: re-run with --auto-redist to improve: skilldoc validate ${toolId} --auto-redist`);
      }
      process.exit(1);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

async function handleReport(flags: Record<string, string | boolean>): Promise<void> {
  const skillsDir = expandHome(
    typeof flags.skills === "string" ? flags.skills : DEFAULT_SKILLS_OUT_DIR
  );

  try {
    const report = await loadQualityReports(skillsDir);
    console.log(formatQualityReport(report));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

const VALID_PROVIDERS: ProviderType[] = [
  "claude-cli", "codex-cli", "gemini-cli",
  "anthropic", "openai", "gemini", "openrouter",
];

const CONFIG_TEMPLATE = `# skilldoc LLM configuration
# Docs: https://github.com/tychohq/skilldoc#prerequisites
#
# provider — which LLM backend to use for distill and validate
#   CLI backends (must be installed and logged in):
#     claude-cli    — Claude Code CLI (recommended)
#     codex-cli     — OpenAI Codex CLI
#     gemini-cli    — Google Gemini CLI
#   API backends (requires apiKey or env var):
#     anthropic     — Anthropic Messages API (env: ANTHROPIC_API_KEY)
#     openai        — OpenAI Chat API (env: OPENAI_API_KEY)
#     gemini        — Google Gemini API (env: GEMINI_API_KEY)
#     openrouter    — OpenRouter API (env: OPENROUTER_API_KEY)
#
# model — optional model override (each provider has a sensible default)
#   Examples: claude-opus-4-6, gpt-5.2, gemini-3.1-pro-preview
#
# apiKey — optional API key (overrides env var for API providers)
`;

export async function handleConfig(flags: Record<string, string | boolean>): Promise<void> {
  const configPath = expandHome(DEFAULT_LLM_CONFIG_PATH);
  const configDir = path.dirname(configPath);

  // --reset: delete config file
  if (flags.reset === true) {
    try {
      unlinkSync(configPath);
      console.log("Deleted " + DEFAULT_LLM_CONFIG_PATH);
    } catch {
      console.log("No config file found at " + DEFAULT_LLM_CONFIG_PATH);
    }
    return;
  }

  // Setting values: --provider, --model, --api-key
  const provider = typeof flags.provider === "string" ? flags.provider : undefined;
  const model = typeof flags.model === "string" ? flags.model : undefined;
  const apiKey = typeof flags["api-key"] === "string" ? flags["api-key"] : undefined;

  if (provider || model || apiKey) {
    if (provider && !VALID_PROVIDERS.includes(provider as ProviderType)) {
      console.error("Invalid provider: " + provider);
      console.error("Valid providers: " + VALID_PROVIDERS.join(", "));
      process.exit(1);
    }

    // Load existing config if present
    let existing: Record<string, unknown> = {};
    try {
      const raw = await readText(configPath);
      const parsed = YAML.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    } catch {
      // No existing config, start fresh
    }

    if (provider) existing.provider = provider;
    if (model) existing.model = model;
    if (apiKey) existing.apiKey = apiKey;

    await ensureDir(configDir);
    const yamlContent = YAML.stringify(existing);
    await writeFileEnsured(configPath, CONFIG_TEMPLATE + yamlContent);

    console.log("Updated " + DEFAULT_LLM_CONFIG_PATH);
    for (const [key, val] of Object.entries(existing)) {
      const display = key === "apiKey" ? (val as string).slice(0, 8) + "..." : String(val);
      console.log("  " + key + ": " + display);
    }
    return;
  }

  // Show mode: display current resolved config
  console.log("LLM Provider Configuration");
  console.log("─".repeat(40));

  // Check config file
  let configExists = false;
  try {
    const raw = await readText(configPath);
    const parsed = YAML.parse(raw);
    if (parsed && typeof parsed === "object") {
      configExists = true;
      console.log("Config: " + DEFAULT_LLM_CONFIG_PATH);
      for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
        const display = key === "apiKey" ? String(val).slice(0, 8) + "..." : String(val);
        console.log("  " + key + ": " + display);
      }
    }
  } catch {
    console.log("Config: " + DEFAULT_LLM_CONFIG_PATH + " (not found)");
  }

  console.log("");

  // Show resolved provider
  try {
    const resolved = resolveProvider();
    console.log("Resolved provider: " + resolved.provider);
    console.log("Model: " + resolved.model);
    if (resolved.apiKey) {
      console.log("API key: " + resolved.apiKey.slice(0, 8) + "...");
    }
  } catch (err) {
    console.log("Resolved provider: none");
    console.log(err instanceof Error ? err.message : String(err));
  }

  if (!configExists) {
    console.log("\nTo configure: skilldoc config --provider claude-cli");
  }
}

export type RunResult = {
  toolId: string;
  passed: boolean;
  score: number;
  skillPath: string;
};

export type RunDeps = {
  generateFn?: (flags: Record<string, string | boolean>, binaryName?: string) => Promise<void>;
  distillFn?: (flags: Record<string, string | boolean>, toolId?: string, distill?: (opts: DistillOptions) => Promise<DistillResult>) => Promise<void>;
  validateFn?: (options: { toolId: string; skillsDir?: string; models?: string[]; threshold?: number }) => Promise<MultiModelValidationReport>;
  distillToolFn?: (opts: DistillOptions) => Promise<DistillResult>;
};

export type RunBatchDeps = RunDeps & {
  loadLockFn?: (lockPath?: string) => Promise<LockFile>;
};

export type AddResult = RunResult & {
  cliName: string;
  version: string;
  helpHash: string;
  links: string[];
};

export async function handleRun(
  toolId: string,
  flags: Record<string, string | boolean>,
  {
    generateFn = handleGenerate,
    distillFn = handleDistill,
    validateFn = validateSkillMultiModel,
    distillToolFn = distillTool,
  }: RunDeps = {}
): Promise<RunResult> {
  const skillsDir = expandHome(
    typeof flags.skills === "string" ? flags.skills : DEFAULT_SKILLS_OUT_DIR
  );
  const modelsFlag = typeof flags.models === "string" ? flags.models : DEFAULT_VALIDATION_MODELS.join(",");
  const models = modelsFlag.split(",").map((m) => m.trim()).filter((m) => m.length > 0);
  const threshold =
    typeof flags.threshold === "string" ? parseInt(flags.threshold, 10) : DEFAULT_THRESHOLD;
  const autoRedist = flags["auto-redist"] === true;

  if (isNaN(threshold) || threshold < 1 || threshold > 10) {
    console.error("--threshold must be a number between 1 and 10");
    process.exit(1);
  }

  // Step 1: generate
  console.log(`\n— generate ${toolId}`);
  await generateFn(flags, toolId);

  // Step 2: distill
  console.log(`\n— distill ${toolId}`);
  await distillFn(flags, toolId);

  // Step 3: validate
  console.log(`\n— validate ${toolId}`);
  let report = await validateFn({ toolId, skillsDir, models, threshold });
  console.log(formatMultiModelReport(report));
  await saveValidationReport(report, skillsDir);

  // Step 4: auto-redist if validation failed
  if (!report.passed && autoRedist) {
    const docsDir = expandHome(typeof flags.docs === "string" ? flags.docs : DEFAULT_DOCS_DIR);
    const model = typeof flags.model === "string" ? flags.model : DEFAULT_MODEL;
    const distillConfigPath = typeof flags["distill-config"] === "string" ? flags["distill-config"] : undefined;
    const promptConfig = await loadDistillConfig(distillConfigPath);
    const feedback = buildValidationFeedback(report);
    const outDir = path.join(skillsDir, toolId);

    console.log(`\n— auto-redist ${toolId}`);
    await distillToolFn({ toolId, binary: toolId, docsDir, outDir, model, feedback, promptConfig });

    console.log(`\n— re-validate ${toolId}`);
    report = await validateFn({ toolId, skillsDir, models, threshold });
    console.log(formatMultiModelReport(report));
    await saveValidationReport(report, skillsDir);
  }

  const skillPath = path.join(skillsDir, toolId, "SKILL.md");
  if (report.passed) {
    console.log(`\nPipeline complete — ${skillPath} (score: ${report.overallAverageScore.toFixed(1)})`);
  } else {
    console.log(`\nValidation failed (score: ${report.overallAverageScore.toFixed(1)}, threshold: ${threshold})`);
    if (!autoRedist) {
      console.log(`Tip: re-run with --auto-redist to improve: skilldoc run ${toolId} --auto-redist`);
    }
  }

  return { toolId, passed: report.passed, score: report.overallAverageScore, skillPath };
}

export async function handleAdd(
  toolId: string,
  flags: Record<string, string | boolean>
): Promise<AddResult> {
  const runResult = await handleRun(toolId, flags);
  const lock = await loadLock();
  const cliName = await resolveToolBinary(toolId);
  // Read discovered helpArgs/commandHelpArgs/complexity from generated tool.json
  const docsDir = expandHome(typeof flags.docs === "string" ? flags.docs : DEFAULT_DOCS_DIR);
  const toolJsonPath = path.join(docsDir, toolId, "tool.json");
  let discoveredHelpArgs: string[] | undefined;
  let discoveredCommandHelpArgs: string[] | undefined;
  let discoveredComplexity: "simple" | "complex" | undefined;
  try {
    const raw = await readText(toolJsonPath);
    const doc = JSON.parse(raw) as { helpArgs?: string[]; commandHelpArgs?: string[]; commands?: unknown[] };
    if (Array.isArray(doc.helpArgs) && doc.helpArgs.every((a: unknown) => typeof a === "string")) {
      discoveredHelpArgs = doc.helpArgs;
    }
    if (Array.isArray(doc.commandHelpArgs) && doc.commandHelpArgs.every((a: unknown) => typeof a === "string")) {
      discoveredCommandHelpArgs = doc.commandHelpArgs;
    }
    if (Array.isArray(doc.commands)) {
      discoveredComplexity = doc.commands.length > 5 ? "complex" : "simple";
    }
  } catch {
    // ignore — tool.json may not exist
  }
  const version = detectVersion(cliName) ?? "unknown";
  const helpHash = computeHelpHashForBinary(cliName, discoveredHelpArgs);
  const existingLinks = lock.skills[toolId]?.links ?? [];
  const links = [...existingLinks];

  const requestedAgents = collectRequestedAgents(flags);
  for (const agent of requestedAgents) {
    const linkedPath = await linkSkillToAgent(toolId, agent);
    links.push(linkedPath ?? path.join(expandHome(agent.skillsDir), toolId));
  }

  if (typeof flags.dir === "string") {
    const linkedPath = await linkSkillToDir(toolId, flags.dir);
    links.push(linkedPath ?? path.join(path.resolve(expandHome(flags.dir)), toolId));
  }

  const dedupedLinks = [...new Set(links)];
  updateLockEntry(lock, toolId, {
    cliName,
    version,
    helpHash,
    source: "help",
    syncedAt: todayDate(),
    generator: "skilldoc",
    links: dedupedLinks,
    ...(discoveredHelpArgs ? { helpArgs: discoveredHelpArgs } : {}),
    ...(discoveredCommandHelpArgs ? { commandHelpArgs: discoveredCommandHelpArgs } : {}),
    ...(discoveredComplexity ? { complexity: discoveredComplexity } : {}),
  });
  await saveLock(lock);

  console.log(`\nAdded ${toolId}`);
  console.log(`  Lock: ${DEFAULT_LOCK_PATH}`);
  console.log(`  Binary: ${cliName}`);
  console.log(`  Version: ${version}`);
  console.log(`  Links: ${dedupedLinks.length}`);
  for (const linkPath of dedupedLinks) {
    console.log(`    - ${linkPath}`);
  }

  return { ...runResult, cliName, version, helpHash, links: dedupedLinks };
}

export async function handleList(): Promise<void> {
  const lock = await loadLock();
  const entries = Object.entries(lock.skills).sort(([a], [b]) => a.localeCompare(b));

  if (entries.length === 0) {
    console.log("No skills installed");
    return;
  }

  for (const [toolId, entry] of entries) {
    console.log(`${toolId}\t${entry.version}\t${entry.syncedAt}\tlinks:${entry.links?.length ?? 0}`);
  }
}

export async function handleUpdate(
  toolId: string | undefined,
  flags: Record<string, string | boolean>
): Promise<boolean> {
  const lock = await loadLock();
  const allToolIds = Object.keys(lock.skills).sort();

  if (allToolIds.length === 0) {
    console.log("No skills installed");
    return true;
  }

  const targetToolIds = toolId ? [toolId] : allToolIds;
  if (toolId && lock.skills[toolId] === undefined) {
    console.log(`No installed skill found for ${toolId}`);
    return true;
  }

  let staleCount = 0;
  let allPassed = true;

  for (const currentToolId of targetToolIds) {
    const entry = lock.skills[currentToolId];
    if (!entry) continue;

    const cliName = entry.cliName || currentToolId;
    const currentVersion = detectVersion(cliName) ?? "unknown";
    const currentHelpHash = computeHelpHashForBinary(cliName);
    if (!isStale(entry, currentVersion, currentHelpHash)) continue;

    staleCount += 1;
    console.log(`Stale: ${currentToolId} (${entry.version} -> ${currentVersion})`);

    const result = await handleRun(currentToolId, flags);
    if (!result.passed) {
      allPassed = false;
    }

    updateLockEntry(lock, currentToolId, {
      cliName,
      version: detectVersion(cliName) ?? currentVersion,
      helpHash: computeHelpHashForBinary(cliName, entry.helpArgs),
      source: "help",
      syncedAt: todayDate(),
      generator: "skilldoc",
      links: entry.links ?? [],
      ...(entry.helpArgs ? { helpArgs: entry.helpArgs } : {}),
      ...(entry.commandHelpArgs ? { commandHelpArgs: entry.commandHelpArgs } : {}),
      ...(entry.complexity ? { complexity: entry.complexity } : {}),
    });
  }

  if (staleCount === 0) {
    console.log("All skills up to date");
    return true;
  }

  await saveLock(lock);
  console.log(`Updated lock: ${DEFAULT_LOCK_PATH}`);
  return allPassed;
}

export async function handleRemove(toolId: string): Promise<void> {
  const lock = await loadLock();
  const removedEntry = removeLockEntry(lock, toolId);
  const removedLinks = removedEntry?.links ? unlinkAll(toolId, removedEntry.links) : [];
  const skillDir = path.join(expandHome(DEFAULT_SKILLS_DIR), toolId);
  const docsDir = path.join(expandHome(DEFAULT_DOCS_DIR), toolId);

  await rm(skillDir, { recursive: true, force: true });
  await rm(docsDir, { recursive: true, force: true });
  await saveLock(lock);

  console.log(`Removed ${toolId}`);
  console.log(`  Skill dir: ${skillDir}`);
  console.log(`  Raw docs: ${docsDir}`);
  console.log(`  Symlinks removed: ${removedLinks.length}`);
  for (const linkPath of removedLinks) {
    console.log(`    - ${linkPath}`);
  }
}

export async function handleRunBatch(
  flags: Record<string, string | boolean>,
  {
    loadLockFn = loadLock,
    ...runDeps
  }: RunBatchDeps = {}
): Promise<void> {
  const lockPath = typeof flags.lock === "string" ? expandHome(flags.lock) : undefined;
  const only = typeof flags.only === "string" ? new Set(flags.only.split(",").map((v) => v.trim())) : null;

  let lock: LockFile;
  try {
    lock = await loadLockFn(lockPath);
  } catch {
    console.error("Failed to load lock file. Use: skilldoc add <tool>");
    return process.exit(1);
  }

  const toolIds = Object.keys(lock.skills)
    .filter((id) => (only ? only.has(id) : true))
    .sort();

  if (toolIds.length === 0) {
    console.log("No skills installed. Use: skilldoc add <tool>");
    return;
  }

  const results: RunResult[] = [];

  for (const toolId of toolIds) {
    const entry = lock.skills[toolId];
    const binary = entry.cliName || toolId;
    console.log(`\n═══ ${toolId} ═══`);
    if (!resolveBinary(binary)) {
      console.error(`Skipping ${toolId}: binary "${binary}" not found on PATH`);
      results.push({ toolId, passed: false, score: 0, skillPath: "" });
      continue;
    }
    try {
      const result = await handleRun(toolId, flags, runDeps);
      results.push(result);
    } catch (err) {
      console.error(`Pipeline failed for ${toolId}: ${err instanceof Error ? err.message : String(err)}`);
      results.push({ toolId, passed: false, score: 0, skillPath: "" });
    }
  }

  // Print summary
  console.log("\n═══ Summary ═══");
  for (const r of results) {
    const status = r.passed ? "PASS" : "FAIL";
    console.log(`  ${r.toolId}: ${r.score.toFixed(1)}/10 — ${status}`);
  }

  const passed = results.filter((r) => r.passed).length;
  console.log(`\n${passed}/${results.length} tools passed`);

  if (passed < results.length) {
    process.exit(1);
  }
}

export async function handleAutoRedist(
  toolId: string,
  feedback: string,
  flags: Record<string, string | boolean>,
  distillFn: (opts: DistillOptions) => Promise<DistillResult> = distillTool,
  loadLockFn: (lockPath?: string) => Promise<LockFile> = loadLock
): Promise<void> {
  const docsDir = expandHome(
    typeof flags.docs === "string" ? flags.docs : DEFAULT_DOCS_DIR
  );
  const model = typeof flags.model === "string" ? flags.model : DEFAULT_MODEL;
  const skillsDir = expandHome(
    typeof flags.skills === "string" ? flags.skills : DEFAULT_SKILLS_OUT_DIR
  );

  process.stdout.write(`\nauto-redist: re-distilling ${toolId} with validation feedback...\n`);

  try {
    const lockPath = typeof flags.lock === "string" ? expandHome(flags.lock) : undefined;
    const lock = await loadLockFn(lockPath);
    const entry = lock.skills[toolId];
    const binary = entry?.cliName ?? toolId;

    const outDir = path.join(skillsDir, toolId);
    const result = await distillFn({ toolId, binary, docsDir, outDir, model, feedback });
    if (result.skipped) {
      console.log(`auto-redist skipped: ${result.skipReason}`);
    } else {
      console.log("auto-redist complete — re-run validate to check updated score");
    }
  } catch (err) {
    console.error(`auto-redist failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Fallback help invocation patterns to try when --help produces empty output. */
const HELP_FALLBACK_PATTERNS: string[][] = [["help"], ["-h"], []];

function scoreHelpContent(parsed: { commands: unknown[]; options: unknown[] }): number {
  return parsed.commands.length + parsed.options.length;
}

/**
 * Run `binary requestedArgs` and check if the output is useful (has commands or options).
 * If not, try fallback patterns and return whichever produces the most content.
 */
export function detectBestHelpArgs(
  binary: string,
  requestedArgs: string[],
  runFn: RunFn
): { helpArgs: string[]; helpResult: ReturnType<RunFn> } {
  const initial = runFn(binary, requestedArgs);
  const initialParsed = parseHelp(initial.output);

  if (initialParsed.commands.length > 0 || initialParsed.options.length > 0) {
    return { helpArgs: requestedArgs, helpResult: initial };
  }

  let bestArgs = requestedArgs;
  let bestResult = initial;
  let bestScore = scoreHelpContent(initialParsed);

  for (const fallbackArgs of HELP_FALLBACK_PATTERNS) {
    const key = JSON.stringify(fallbackArgs);
    if (key === JSON.stringify(requestedArgs)) continue;
    const result = runFn(binary, fallbackArgs);
    const parsed = parseHelp(result.output);
    const score = scoreHelpContent(parsed);
    if (score > bestScore) {
      bestScore = score;
      bestArgs = fallbackArgs;
      bestResult = result;
    }
  }

  return { helpArgs: bestArgs, helpResult: bestResult };
}

export async function handleGenerate(
  flags: Record<string, string | boolean>,
  binaryName?: string,
  { loadLockFn = loadLock }: { loadLockFn?: (lockPath?: string) => Promise<LockFile> } = {}
): Promise<void> {
  const outDir = expandHome(
    typeof flags.out === "string" ? flags.out : DEFAULT_OUT_DIR
  );

  type ToolEntry = { id: string; binary: string; helpArgs?: string[]; commandHelpArgs?: string[]; displayName?: string };
  let tools: ToolEntry[];

  if (binaryName) {
    if (!resolveBinary(binaryName)) {
      console.error(`Error: binary "${binaryName}" not found on PATH`);
      process.exit(1);
    }
    const lockPath = typeof flags.lock === "string" ? expandHome(flags.lock) : undefined;
    const lock = await loadLockFn(lockPath);
    const lockEntry = lock.skills[binaryName];
    tools = [{
      id: binaryName,
      binary: lockEntry?.cliName ?? binaryName,
      helpArgs: lockEntry?.helpArgs,
      commandHelpArgs: lockEntry?.commandHelpArgs,
    }];
  } else {
    const lockPath = typeof flags.lock === "string" ? expandHome(flags.lock) : undefined;
    const only = typeof flags.only === "string" ? new Set(flags.only.split(",").map((v) => v.trim())) : null;
    const lock = await loadLockFn(lockPath);
    tools = Object.entries(lock.skills)
      .filter(([id]) => (only ? only.has(id) : true))
      .map(([id, entry]) => ({
        id,
        binary: entry.cliName || id,
        helpArgs: entry.helpArgs,
        commandHelpArgs: entry.commandHelpArgs,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  await ensureDir(outDir);

  for (const tool of tools) {
    const requestedHelpArgs = tool.helpArgs ?? ["--help"];
    const { helpArgs, helpResult } = detectBestHelpArgs(tool.binary, requestedHelpArgs, runCommand);

    const parsed = parseHelp(helpResult.output);
    const warnings = [...parsed.warnings];

    if (helpResult.error) {
      warnings.push(helpResult.error);
    }

    const usageTokens = extractUsageTokens(parsed.usageLines, tool.binary);
    const usage = buildUsageDoc(parsed.usageLines, tool.binary);

    const candidateCommands = identifySubcommandCandidates(
      parsed.commands,
      tool.binary,
      runCommand
    );

    const toolJsonPath = path.join(outDir, tool.id, "tool.json");
    const storedCommandHelpArgs = tool.commandHelpArgs ? undefined : await readStoredCommandHelpArgs(toolJsonPath);
    const commandHelpArgs = tool.commandHelpArgs ?? resolveCommandHelpArgs(
      tool.binary,
      candidateCommands,
      parsed.commands,
      storedCommandHelpArgs,
      runCommand
    );

    const subcommandCandidates = candidateCommands.map((candidate) => ({
      name: candidate.name,
      summary: candidate.summary,
    }));

    const commands = parsed.commands.map((command) => ({
      ...command,
      docPath: commandHelpArgs ? commandDocPath(command) : undefined,
    }));

    const optionsFromUsage = parsed.options.length === 0 && usageTokens.flags.length > 0;
    const options = optionsFromUsage
      ? usageTokens.flags.map((flag) => ({ flags: flag, description: "" }))
      : parsed.options;

    if (optionsFromUsage) {
      const index = warnings.indexOf("No options detected.");
      if (index !== -1) {
        warnings.splice(index, 1);
      }
    }

    const doc: ToolDoc = {
      kind: "tool",
      id: tool.id,
      displayName: tool.displayName ?? tool.id,
      binary: tool.binary,
      description: undefined,
      generatedAt: new Date().toISOString(),
      helpArgs,
      commandHelpArgs,
      helpExitCode: helpResult.exitCode,
      helpHash: computeHash(helpResult.output),
      usage,
      commands,
      subcommandCandidates,
      options,
      examples: parsed.examples,
      env: parsed.env,
      warnings,
    };

    const toolDir = path.join(outDir, tool.id);
    await ensureDir(toolDir);

    await writeFileEnsured(path.join(toolDir, "tool.json"), JSON.stringify(doc, null, 2));
    await writeFileEnsured(path.join(toolDir, "tool.yaml"), YAML.stringify(doc));
    await writeFileEnsured(path.join(toolDir, "tool.md"), renderToolMarkdown(doc));
    await rm(path.join(toolDir, "raw.txt"), { force: true });

    const commandsDir = path.join(toolDir, "commands");
    if (commandHelpArgs) {
      await generateCommandDocs(tool.id, tool.binary, commandHelpArgs, commands, toolDir, runCommand, DEFAULT_MAX_DEPTH);
    } else {
      await rm(commandsDir, { recursive: true, force: true });
    }
  }
  const indexLines = await buildIndexLines(outDir);
  await writeFileEnsured(path.join(outDir, "index.md"), indexLines.join("\n"));
  console.log(`Generated docs for ${tools.length} tool(s) in ${outDir}`);
}

async function buildIndexLines(outDir: string): Promise<string[]> {
  const lines: string[] = [];
  lines.push("# Tool Docs", "", `Generated: ${new Date().toISOString()}`, "");
  lines.push("| Tool | Binary |", "| --- | --- |");

  const dirents = await readdir(outDir, { withFileTypes: true });
  const rows: Array<{ id: string; binary: string }> = [];

  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const toolJsonPath = path.join(outDir, dirent.name, "tool.json");
    if (!existsSync(toolJsonPath)) continue;
    try {
      const raw = await readText(toolJsonPath);
      const doc = JSON.parse(raw) as Partial<ToolDoc>;
      if (typeof doc.id !== "string" || typeof doc.binary !== "string") continue;
      rows.push({ id: doc.id, binary: doc.binary });
    } catch {
      // Skip malformed tool docs when rebuilding index.
    }
  }

  rows.sort((a, b) => a.id.localeCompare(b.id));
  for (const row of rows) {
    lines.push(`| ${row.id} | ${row.binary} |`);
  }

  return lines;
}

export const DEFAULT_MAX_DEPTH = 2;

export type RunFn = (binary: string, args: string[]) => { output: string; exitCode: number | null; error?: string };

const SUBCOMMAND_KEYWORD_RE = /\b(manage|control)\b/i;
const SUBCOMMAND_SECTION_HEADER_RE = /^\s*(?:[A-Z][A-Z0-9 /_-]*\s+)?(?:Subcommands|Commands):?\s*$/im;
const COMMAND_HELP_PROBE_PATTERNS: string[][] = [
  ["{command}", "--help"],
  ["{command}", "-h"],
  ["help", "{command}"],
];

function hasSubcommandSection(output: string): boolean {
  return SUBCOMMAND_SECTION_HEADER_RE.test(output);
}

/**
 * Returns true if a command summary likely indicates the command manages sub-resources.
 * Heuristic: description contains "manage" or "control" (word-boundary, case-insensitive).
 */
export function hasSubcommandKeyword(summary: string): boolean {
  return SUBCOMMAND_KEYWORD_RE.test(summary);
}

/**
 * Identifies top-level commands that likely have subcommands.
 * Two heuristics are applied:
 *   1. Description contains "manage" or "control" (text check, no subprocess).
 *   2. Running `<binary> <cmd> --help` returns output with a commands/subcommands section.
 * When `binary` and `runFn` are omitted, only the text heuristic is applied.
 */
export function identifySubcommandCandidates(
  commands: CommandSummary[],
  binary?: string,
  runFn?: RunFn
): CommandSummary[] {
  return commands.filter((cmd) => {
    if (hasSubcommandKeyword(cmd.summary)) return true;
    if (binary && runFn) {
      const result = runFn(binary, [cmd.name, "--help"]);
      return hasSubcommandSection(result.output);
    }
    return false;
  });
}

/**
 * Probe command-help invocation styles using one candidate command.
 * Returns the matching argument template (with {command}) or undefined.
 */
export function detectCommandHelpArgs(
  binary: string,
  candidates: CommandSummary[],
  runFn: RunFn
): string[] | undefined {
  if (candidates.length === 0) return undefined;
  const candidate = candidates[0];

  for (const pattern of COMMAND_HELP_PROBE_PATTERNS) {
    const probeArgs = pattern.map((part) => part.replace("{command}", candidate.name));
    const result = runFn(binary, probeArgs);
    if (hasSubcommandSection(result.output)) {
      return [...pattern];
    }
  }

  return undefined;
}

function matchesCommandHelpPattern(
  binary: string,
  candidateName: string,
  pattern: string[],
  runFn: RunFn
): boolean {
  const probeArgs = pattern.map((part) => part.replace("{command}", candidateName));
  const result = runFn(binary, probeArgs);
  return hasSubcommandSection(result.output);
}

function resolveCommandHelpArgs(
  binary: string,
  candidates: CommandSummary[],
  commands: CommandSummary[],
  storedCommandHelpArgs: string[] | undefined,
  runFn: RunFn
): string[] | undefined {
  if (storedCommandHelpArgs) {
    const probeCommands = candidates.length > 0 ? candidates : commands;
    for (const probeCommand of probeCommands) {
      if (matchesCommandHelpPattern(binary, probeCommand.name, storedCommandHelpArgs, runFn)) {
        return [...storedCommandHelpArgs];
      }
    }
  }

  if (candidates.length === 0) return undefined;
  return detectCommandHelpArgs(binary, candidates, runFn);
}

export async function generateCommandDocs(
  toolId: string,
  binary: string,
  commandHelpArgs: string[],
  commands: CommandSummary[],
  toolDir: string,
  runFn: RunFn = runCommand,
  maxDepth: number = DEFAULT_MAX_DEPTH
): Promise<void> {
  const commandsDir = path.join(toolDir, "commands");
  await ensureDir(commandsDir);

  for (const command of commands) {
    const args = commandHelpArgs.map((arg) => arg.replace("{command}", command.name));
    await generateOneCommandDoc(toolId, binary, command, args, commandsDir, [command.name], 0, runFn, maxDepth);
  }
}

async function generateOneCommandDoc(
  toolId: string,
  binary: string,
  command: CommandSummary,
  helpArgs: string[],
  commandsDir: string,
  cmdPath: string[],
  depth: number,
  runFn: RunFn,
  maxDepth: number
): Promise<void> {
  const helpResult = runFn(binary, helpArgs);
  const parsed = parseHelp(helpResult.output);
  const warnings = [...parsed.warnings];

  if (helpResult.error) {
    warnings.push(helpResult.error);
  }

  const usageTokens = extractUsageTokens(parsed.usageLines, binary);
  const usage = buildUsageDoc(parsed.usageLines, binary);

  const optionsFromUsage = parsed.options.length === 0 && usageTokens.flags.length > 0;
  const options = optionsFromUsage
    ? usageTokens.flags.map((flag) => ({ flags: flag, description: "" }))
    : parsed.options;

  if (optionsFromUsage) {
    const index = warnings.indexOf("No options detected.");
    if (index !== -1) {
      warnings.splice(index, 1);
    }
  }

  const subcommands: CommandSummary[] | undefined =
    parsed.commands.length > 0
      ? parsed.commands.map((sc) => ({
          ...sc,
          docPath: `${slugify(sc.name)}/command.md`,
        }))
      : undefined;

  const doc: CommandDoc = {
    kind: "command",
    toolId,
    command: cmdPath.join(" "),
    summary: command.summary,
    binary,
    generatedAt: new Date().toISOString(),
    helpArgs,
    helpExitCode: helpResult.exitCode,
    usage,
    subcommands,
    options,
    examples: parsed.examples,
    env: parsed.env,
    warnings,
  };

  const commandDir = path.join(commandsDir, slugify(command.name));
  await ensureDir(commandDir);
  await writeFileEnsured(path.join(commandDir, "command.json"), JSON.stringify(doc, null, 2));
  await writeFileEnsured(path.join(commandDir, "command.yaml"), YAML.stringify(doc));
  await writeFileEnsured(path.join(commandDir, "command.md"), renderCommandMarkdown(doc));

  if (depth < maxDepth && parsed.commands.length > 0) {
    for (const subCmd of parsed.commands) {
      const subArgs = [...cmdPath, subCmd.name, "--help"];
      await generateOneCommandDoc(
        toolId,
        binary,
        subCmd,
        subArgs,
        commandDir,
        [...cmdPath, subCmd.name],
        depth + 1,
        runFn,
        maxDepth
      );
    }
  }
}

function commandDocPath(command: CommandSummary): string {
  return `commands/${slugify(command.name)}/command.md`;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

export function resolveBinary(name: string): string | null {
  const result = spawnSync("which", [name], { encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

export function computeHelpHashForBinary(binary: string, helpArgs?: string[]): string {
  const env = {
    ...process.env,
    LANG: "C",
    LC_ALL: "C",
    TERM: "dumb",
    NO_COLOR: "1",
    CLICOLOR: "0",
    PAGER: "cat",
    GIT_PAGER: "cat",
    MANPAGER: "cat",
    LESS: "FRX",
  };

  const args = helpArgs ?? ["--help"];
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    env,
  });

  if (result.error) {
    throw new Error(`Failed to run ${binary} ${args.join(" ")}: ${result.error.message}`);
  }

  const output = result.stdout ?? "";
  return computeHash(output);
}

function runCommand(binary: string, args: string[]): { output: string; exitCode: number | null; error?: string } {
  const env = {
    ...process.env,
    LANG: "C",
    LC_ALL: "C",
    TERM: "dumb",
    NO_COLOR: "1",
    CLICOLOR: "0",
    PAGER: "cat",
    GIT_PAGER: "cat",
    MANPAGER: "cat",
    LESS: "FRX",
  };

  const result = spawnSync(binary, args, {
    encoding: "utf8",
    env,
  });

  if (result.error) {
    return {
      output: "",
      exitCode: null,
      error: result.error.message,
    };
  }

  return {
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    exitCode: result.status ?? null,
  };
}

export function computeHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function computeSkillDiff(oldContent: string, newContent: string, label: string): string {
  const tmpA = path.join(os.tmpdir(), `td-diff-a-${Date.now()}`);
  const tmpB = path.join(os.tmpdir(), `td-diff-b-${Date.now()}`);
  try {
    writeFileSync(tmpA, oldContent, "utf8");
    writeFileSync(tmpB, newContent, "utf8");
    const result = spawnSync("diff", ["-u", tmpA, tmpB], { encoding: "utf8" });
    return (result.stdout ?? "")
      .replace(tmpA, `a/${label}`)
      .replace(tmpB, `b/${label}`);
  } finally {
    try { unlinkSync(tmpA); } catch { /* ignore */ }
    try { unlinkSync(tmpB); } catch { /* ignore */ }
  }
}

async function readStoredHash(toolJsonPath: string): Promise<string | null> {
  try {
    const content = await readText(toolJsonPath);
    const doc = JSON.parse(content) as { helpHash?: string };
    return doc.helpHash ?? null;
  } catch {
    return null;
  }
}

async function readStoredCommandHelpArgs(toolJsonPath: string): Promise<string[] | undefined> {
  try {
    const content = await readText(toolJsonPath);
    const doc = JSON.parse(content) as { commandHelpArgs?: unknown };
    if (!Array.isArray(doc.commandHelpArgs) || doc.commandHelpArgs.length === 0) {
      return undefined;
    }
    if (!doc.commandHelpArgs.every((arg) => typeof arg === "string")) {
      return undefined;
    }
    return [...doc.commandHelpArgs];
  } catch {
    return undefined;
  }
}

export async function getChangedTools(
  tools: Array<{ id: string; binary: string; helpArgs?: string[] }>,
  docsDir: string,
  runFn: (binary: string, args: string[]) => { output: string; exitCode: number | null; error?: string }
): Promise<string[]> {
  const changed: string[] = [];
  for (const tool of tools) {
    const helpArgs = tool.helpArgs ?? ["--help"];
    const result = runFn(tool.binary, helpArgs);
    const currentHash = computeHash(result.output);
    const toolJsonPath = path.join(docsDir, tool.id, "tool.json");
    const storedHash = await readStoredHash(toolJsonPath);
    if (currentHash !== storedHash) {
      changed.push(tool.id);
    }
  }
  return changed;
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readText(filePath);
  } catch {
    return null;
  }
}

export async function handleRefresh(
  flags: Record<string, string | boolean>,
  {
    generateFn = handleGenerate,
    distillFn = handleDistill,
    runFn = runCommand,
    readFileFn = readOptionalFile,
    diffFn = computeSkillDiff,
  }: {
    generateFn?: (flags: Record<string, string | boolean>) => Promise<void>;
    distillFn?: (flags: Record<string, string | boolean>) => Promise<void>;
    runFn?: (binary: string, args: string[]) => { output: string; exitCode: number | null; error?: string };
    readFileFn?: (filePath: string) => Promise<string | null>;
    diffFn?: (oldContent: string, newContent: string, label: string) => string;
  } = {}
): Promise<void> {
  const registryPath = expandHome(
    typeof flags.registry === "string" ? flags.registry : DEFAULT_REGISTRY
  );
  const docsDir = expandHome(
    typeof flags.out === "string" ? flags.out : DEFAULT_OUT_DIR
  );
  const only = typeof flags.only === "string" ? new Set(flags.only.split(",").map((v) => v.trim())) : null;
  const showDiff = flags.diff === true;

  const registry = await loadRegistry(registryPath);
  const tools = registry.tools
    .filter((tool) => tool.enabled !== false)
    .filter((tool) => (only ? only.has(tool.id) : true))
    .sort((a, b) => a.id.localeCompare(b.id));

  const changedIds = await getChangedTools(tools, docsDir, runFn);

  if (changedIds.length === 0) {
    console.log("No changes detected.");
    return;
  }

  console.log(`Detected changes in: ${changedIds.join(", ")}`);
  const onlyFlag = changedIds.join(",");

  const skillsDir = expandHome(typeof flags.out === "string" ? flags.out : DEFAULT_SKILLS_OUT_DIR);
  const beforeSkills: Record<string, string | null> = {};
  if (showDiff) {
    for (const id of changedIds) {
      beforeSkills[id] = await readFileFn(path.join(skillsDir, id, "SKILL.md"));
    }
  }

  await generateFn({ ...flags, only: onlyFlag });
  await distillFn({ ...flags, only: onlyFlag });

  if (showDiff) {
    for (const id of changedIds) {
      const after = await readFileFn(path.join(skillsDir, id, "SKILL.md"));
      const before = beforeSkills[id] ?? "";
      const afterContent = after ?? "";
      if (before === afterContent) {
        console.log(`${id}/SKILL.md: unchanged`);
        continue;
      }
      const diff = diffFn(before, afterContent, `${id}/SKILL.md`);
      process.stdout.write(diff);
    }
  }
}

if ((import.meta as { main?: boolean }).main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
