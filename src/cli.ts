import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import YAML from "yaml";
import pkg from "../package.json";
import { createToolEntry, loadRegistry } from "./config.js";
import { parseHelp } from "./parser.js";
import { renderCommandMarkdown, renderToolMarkdown } from "./render.js";
import { buildUsageDoc, extractUsageTokens } from "./usage.js";
import { expandHome, ensureDir, writeFileEnsured, readText } from "./utils.js";
import { CommandDoc, CommandSummary, Registry, RegistryTool, ToolComplexity, ToolDoc } from "./types.js";
import { distillTool, DEFAULT_SKILLS_DIR, DEFAULT_DOCS_DIR, DEFAULT_MODEL, DEFAULT_DISTILL_CONFIG_PATH, loadDistillConfig, DistillOptions, DistillResult, DistillPromptConfig } from "./distill.js";
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

const DEFAULT_REGISTRY = "~/.agents/tool-docs/registry.yaml";
const DEFAULT_OUT_DIR = "~/.agents/docs/tool-docs";

const DEFAULT_SKILLS_OUT_DIR = DEFAULT_SKILLS_DIR;

const HELP_TEXT = `tool-docs

Usage:
  tool-docs run <tool>                         # generate + distill + validate in one shot
  tool-docs run [--registry <path>] ...        # full pipeline for all registry tools
  tool-docs generate <tool>                    # generate docs for a single tool
  tool-docs generate [--registry <path>] ...   # generate from registry
  tool-docs distill <tool>                     # distill a single tool
  tool-docs distill [--registry <path>] ...    # distill from registry
  tool-docs refresh [--registry <path>] [--only <id1,id2>] [--diff]
  tool-docs validate <tool-id> [--skills <path>] [--models <m1,m2>] [--threshold <n>] [--auto-redist]
  tool-docs report [--skills <path>]
  tool-docs init [--registry <path>] [--force]
  tool-docs --help

Commands:
  run        Run full pipeline: generate → distill → validate (recommended start here)
  generate   Generate docs for a single tool (ad-hoc) or all tools in the registry
  distill    Distill raw docs into agent-optimized skills (SKILL.md + docs/)
  refresh    Re-run generate + distill for tools whose --help output has changed
  validate   Test skill quality using LLM-based scenario evaluation
  report     Show aggregate quality report across all validated tools
  init       Create a starter registry file at ~/.agents/tool-docs/registry.yaml with example
             tool entries (git, ripgrep). Use this to configure batch generation for multiple tools.

Options:
  --registry <path>       Path to registry YAML (default: ${DEFAULT_REGISTRY})
  --out <path>            Output directory (default: generate=${DEFAULT_OUT_DIR}, distill=${DEFAULT_SKILLS_OUT_DIR})
  --docs <path>           Path to raw docs dir for distill (default: ${DEFAULT_DOCS_DIR})
  --skills <path>         Path to skills dir for validate (default: ${DEFAULT_SKILLS_OUT_DIR})
  --only <ids>            Comma-separated list of tool ids to process
  --model <model>         LLM model for distill/auto-redist (default: ${DEFAULT_MODEL})
  --models <m1,m2>        Comma-separated models for validate (default: ${DEFAULT_VALIDATION_MODELS.join(",")})
  --threshold <n>         Minimum passing score for validate (default: ${DEFAULT_THRESHOLD})
  --distill-config <path> Path to distill prompt config YAML (default: ${DEFAULT_DISTILL_CONFIG_PATH})
  --auto-redist           Re-run distill with feedback if validation fails
  --force                 Overwrite registry on init
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

  if (command === "init") {
    await handleInit(flags);
    return;
  }

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

  if (command === "--version" || command === "-v") {
    console.log(VERSION);
    return;
  }

  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

const VALUE_FLAGS = new Set([
  "--registry", "--out", "--only", "--docs", "--model",
  "--models", "--skills", "--threshold", "--distill-config",
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
    if (arg === "--force" || arg === "--auto-redist" || arg === "--diff") {
      flags[arg.replace(/^--/, "")] = true;
      continue;
    }
    if (arg === "--registry" || arg === "--out" || arg === "--only" || arg === "--docs" || arg === "--model" || arg === "--models" || arg === "--skills" || arg === "--threshold" || arg === "--distill-config") {
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

export async function handleInit(flags: Record<string, string | boolean>): Promise<void> {
  const registryPath = expandHome(
    typeof flags.registry === "string" ? flags.registry : DEFAULT_REGISTRY
  );
  const displayPath = typeof flags.registry === "string" ? flags.registry : DEFAULT_REGISTRY;
  const force = flags.force === true;

  const sample = `version: 1\ntools:\n  - id: git\n    binary: git\n    displayName: Git\n    category: cli\n    homepage: https://git-scm.com\n    helpArgs: ["-h"]\n    commandHelpArgs: ["help", "{command}"]\n    useCases:\n      - version control and branching\n      - code review and collaboration\n  - id: rg\n    binary: rg\n    displayName: ripgrep\n    category: cli\n    homepage: https://github.com/BurntSushi/ripgrep\n    helpArgs: ["--help"]\n    useCases:\n      - fast file content search\n      - recursive grep with gitignore support\n`;

  if (!force) {
    try {
      const fs = await import("node:fs/promises");
      await fs.access(registryPath);
      console.error(`Registry already exists: ${registryPath}`);
      process.exit(1);
    } catch {
      // ok
    }
  }

  await writeFileEnsured(registryPath, sample);

  const lines = [
    `Created: ${displayPath}`,
    `  Tools: git, rg (2 example entries)`,
    ``,
    `Next steps:`,
    `  1. Edit the registry to add your tools`,
    `  2. Run the pipeline:`,
    `     tool-docs run --registry ${displayPath}`,
  ];
  console.log(lines.join("\n"));
}

/**
 * Derive a skill byte limit from a tool's complexity setting.
 * simple → 2000 bytes (single-command tools like jq, rg)
 * complex → 4000 bytes (multi-subcommand tools like gh, railway, wrangler)
 */
export const COMPLEXITY_SKILL_LIMITS: Record<ToolComplexity, number> = {
  simple: 2000,
  complex: 4000,
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
  distillFn: (opts: DistillOptions) => Promise<DistillResult> = distillTool
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
      console.error(`Error: no raw docs found for "${toolId}". Run "tool-docs generate ${toolId}" first.`);
      process.exit(1);
    }
    tools = [{ id: toolId, binary: toolId }];
  } else {
    // Registry mode: distill all (or filtered) tools
    const registryPath = expandHome(
      typeof flags.registry === "string" ? flags.registry : DEFAULT_REGISTRY
    );
    const only = typeof flags.only === "string" ? new Set(flags.only.split(",").map((v) => v.trim())) : null;
    const registry = await loadRegistry(registryPath);
    tools = registry.tools
      .filter((tool) => tool.enabled !== false)
      .filter((tool) => (only ? only.has(tool.id) : true))
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
        console.log(`Tip: re-run with --auto-redist to improve: tool-docs validate ${toolId} --auto-redist`);
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
  loadRegistryFn?: (registryPath: string) => Promise<Registry>;
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
      console.log(`Tip: re-run with --auto-redist to improve: tool-docs run ${toolId} --auto-redist`);
    }
  }

  return { toolId, passed: report.passed, score: report.overallAverageScore, skillPath };
}

export async function handleRunBatch(
  flags: Record<string, string | boolean>,
  {
    loadRegistryFn = loadRegistry,
    ...runDeps
  }: RunBatchDeps = {}
): Promise<void> {
  const registryPath = expandHome(
    typeof flags.registry === "string" ? flags.registry : DEFAULT_REGISTRY
  );
  const only = typeof flags.only === "string" ? new Set(flags.only.split(",").map((v) => v.trim())) : null;

  let registry: Registry;
  try {
    registry = await loadRegistryFn(registryPath);
  } catch {
    console.error(`No registry found at ${registryPath}. Use: tool-docs run <tool> or create a registry with: tool-docs init`);
    return process.exit(1);
  }

  const tools = registry.tools
    .filter((tool) => tool.enabled !== false)
    .filter((tool) => (only ? only.has(tool.id) : true))
    .sort((a, b) => a.id.localeCompare(b.id));

  if (tools.length === 0) {
    console.log("No tools to process.");
    return;
  }

  const results: RunResult[] = [];

  for (const tool of tools) {
    console.log(`\n═══ ${tool.id} ═══`);
    if (!resolveBinary(tool.binary)) {
      console.error(`Skipping ${tool.id}: binary "${tool.binary}" not found on PATH`);
      results.push({ toolId: tool.id, passed: false, score: 0, skillPath: "" });
      continue;
    }
    try {
      const result = await handleRun(tool.id, flags, runDeps);
      results.push(result);
    } catch (err) {
      console.error(`Pipeline failed for ${tool.id}: ${err instanceof Error ? err.message : String(err)}`);
      results.push({ toolId: tool.id, passed: false, score: 0, skillPath: "" });
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
  distillFn: (opts: DistillOptions) => Promise<DistillResult> = distillTool
): Promise<void> {
  const registryPath = expandHome(
    typeof flags.registry === "string" ? flags.registry : DEFAULT_REGISTRY
  );
  const docsDir = expandHome(
    typeof flags.docs === "string" ? flags.docs : DEFAULT_DOCS_DIR
  );
  const model = typeof flags.model === "string" ? flags.model : DEFAULT_MODEL;
  const skillsDir = expandHome(
    typeof flags.skills === "string" ? flags.skills : DEFAULT_SKILLS_OUT_DIR
  );

  process.stdout.write(`\nauto-redist: re-distilling ${toolId} with validation feedback...\n`);

  try {
    const registry = await loadRegistry(registryPath);
    const tool = registry.tools.find((t) => t.id === toolId);
    if (!tool) {
      console.error(`Tool ${toolId} not found in registry; skipping auto-redist`);
      return;
    }

    const outDir = path.join(skillsDir, toolId);
    const result = await distillFn({ toolId, binary: tool.binary, docsDir, outDir, model, feedback });
    if (result.skipped) {
      console.log(`auto-redist skipped: ${result.skipReason}`);
    } else {
      console.log("auto-redist complete — re-run validate to check updated score");
    }
  } catch (err) {
    console.error(`auto-redist failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function handleGenerate(flags: Record<string, string | boolean>, binaryName?: string): Promise<void> {
  const outDir = expandHome(
    typeof flags.out === "string" ? flags.out : DEFAULT_OUT_DIR
  );

  let tools: RegistryTool[];

  if (binaryName) {
    if (!resolveBinary(binaryName)) {
      console.error(`Error: binary "${binaryName}" not found on PATH`);
      process.exit(1);
    }
    const registryPath = expandHome(
      typeof flags.registry === "string" ? flags.registry : DEFAULT_REGISTRY
    );
    const registryTool = await lookupRegistryTool(registryPath, binaryName);
    tools = [registryTool ?? createToolEntry(binaryName)];
  } else {
    const registryPath = expandHome(
      typeof flags.registry === "string" ? flags.registry : DEFAULT_REGISTRY
    );
    const only = typeof flags.only === "string" ? new Set(flags.only.split(",").map((v) => v.trim())) : null;
    const registry = await loadRegistry(registryPath);
    tools = registry.tools
      .filter((tool) => tool.enabled !== false)
      .filter((tool) => (only ? only.has(tool.id) : true))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  await ensureDir(outDir);

  const indexLines: string[] = [];
  indexLines.push("# Tool Docs", "", `Generated: ${new Date().toISOString()}`, "");
  indexLines.push("| Tool | Binary |", "| --- | --- |");

  for (const tool of tools) {
    const helpArgs = tool.helpArgs ?? ["--help"];
    const helpResult = runCommand(tool.binary, helpArgs);

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
      description: tool.description,
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
      await generateCommandDocs(tool.id, tool.binary, commandHelpArgs, commands, toolDir, runCommand, tool.maxDepth ?? DEFAULT_MAX_DEPTH);
    } else {
      await rm(commandsDir, { recursive: true, force: true });
    }

    indexLines.push(`| ${tool.id} | ${tool.binary} |`);
  }

  await writeFileEnsured(path.join(outDir, "index.md"), indexLines.join("\n"));
  console.log(`Generated docs for ${tools.length} tool(s) in ${outDir}`);
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
  storedCommandHelpArgs: string[] | undefined,
  runFn: RunFn
): string[] | undefined {
  if (candidates.length === 0) return undefined;
  const candidateName = candidates[0].name;

  if (
    storedCommandHelpArgs &&
    matchesCommandHelpPattern(binary, candidateName, storedCommandHelpArgs, runFn)
  ) {
    return [...storedCommandHelpArgs];
  }

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

export async function lookupRegistryTool(registryPath: string, binaryName: string): Promise<RegistryTool | null> {
  try {
    const registry = await loadRegistry(registryPath);
    return registry.tools.find((t) => t.id === binaryName || t.binary === binaryName) ?? null;
  } catch {
    return null;
  }
}

export function resolveBinary(name: string): string | null {
  const result = spawnSync("which", [name], { encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.trim();
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
