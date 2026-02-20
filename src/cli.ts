import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { writeFileSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import YAML from "yaml";
import { loadRegistry } from "./config.js";
import { parseHelp } from "./parser.js";
import { renderCommandMarkdown, renderToolMarkdown } from "./render.js";
import { buildUsageDoc, extractUsageTokens } from "./usage.js";
import { expandHome, ensureDir, writeFileEnsured, readText } from "./utils.js";
import { CommandDoc, CommandSummary, ToolDoc } from "./types.js";
import { distillTool, DEFAULT_SKILLS_DIR, DEFAULT_DOCS_DIR, DEFAULT_MODEL, DistillOptions, DistillResult } from "./distill.js";
import {
  validateSkillMultiModel,
  formatMultiModelReport,
  buildValidationFeedback,
  saveValidationReport,
  loadQualityReports,
  formatQualityReport,
  DEFAULT_THRESHOLD,
  DEFAULT_VALIDATION_MODELS,
} from "./validate.js";

const DEFAULT_REGISTRY = "~/.agents/tool-docs/registry.yaml";
const DEFAULT_OUT_DIR = "~/.agents/docs/tool-docs";

const DEFAULT_SKILLS_OUT_DIR = DEFAULT_SKILLS_DIR;

const HELP_TEXT = `tool-docs

Usage:
  tool-docs generate [--registry <path>] [--out <path>] [--only <id1,id2>]
  tool-docs distill [--registry <path>] [--docs <path>] [--out <path>] [--only <id1,id2>] [--model <model>]
  tool-docs refresh [--registry <path>] [--out <path>] [--only <id1,id2>] [--model <model>] [--diff]
  tool-docs validate <tool-id> [--skills <path>] [--models <m1,m2>] [--threshold <n>] [--auto-redist]
  tool-docs report [--skills <path>]
  tool-docs init [--registry <path>] [--force]
  tool-docs --help

Commands:
  generate   Generate markdown + JSON docs for tools in the registry
  distill    Distill raw docs into agent-optimized skills (SKILL.md + docs/)
  refresh    Re-run generate + distill for tools whose --help output has changed
  validate   Test skill quality using LLM-based scenario evaluation
  report     Show aggregate quality report across all validated tools
  init       Create a starter registry file

Options:
  --registry <path>   Path to registry YAML (default: ${DEFAULT_REGISTRY})
  --out <path>        Output directory (default: generate=${DEFAULT_OUT_DIR}, distill=${DEFAULT_SKILLS_OUT_DIR})
  --docs <path>       Path to raw docs dir for distill (default: ${DEFAULT_DOCS_DIR})
  --skills <path>     Path to skills dir for validate (default: ${DEFAULT_SKILLS_OUT_DIR})
  --only <ids>        Comma-separated list of tool ids to process
  --model <model>     LLM model for distill/auto-redist (default: ${DEFAULT_MODEL})
  --models <m1,m2>    Comma-separated models for validate (default: ${DEFAULT_VALIDATION_MODELS.join(",")})
  --threshold <n>     Minimum passing score for validate (default: ${DEFAULT_THRESHOLD})
  --auto-redist       Re-run distill with feedback if validation fails
  --force             Overwrite registry on init
  --diff              Show diff of skill output after refresh
  -h, --help          Show this help
`;

const VERSION = "0.2.0";

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

  if (command === "generate") {
    await handleGenerate(flags);
    return;
  }

  if (command === "distill") {
    await handleDistill(flags);
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

export function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("-")) continue;
    if (arg === "--force" || arg === "--auto-redist" || arg === "--diff") {
      flags[arg.replace(/^--/, "")] = true;
      continue;
    }
    if (arg === "--registry" || arg === "--out" || arg === "--only" || arg === "--docs" || arg === "--model" || arg === "--models" || arg === "--skills" || arg === "--threshold") {
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

async function handleInit(flags: Record<string, string | boolean>): Promise<void> {
  const registryPath = expandHome(
    typeof flags.registry === "string" ? flags.registry : DEFAULT_REGISTRY
  );
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
  console.log(`Wrote registry: ${registryPath}`);
}

async function handleDistill(flags: Record<string, string | boolean>): Promise<void> {
  const registryPath = expandHome(
    typeof flags.registry === "string" ? flags.registry : DEFAULT_REGISTRY
  );
  const docsDir = expandHome(
    typeof flags.docs === "string" ? flags.docs : DEFAULT_DOCS_DIR
  );
  const outBase = expandHome(
    typeof flags.out === "string" ? flags.out : DEFAULT_SKILLS_OUT_DIR
  );
  const model = typeof flags.model === "string" ? flags.model : DEFAULT_MODEL;
  const only = typeof flags.only === "string" ? new Set(flags.only.split(",").map((v) => v.trim())) : null;

  const registry = await loadRegistry(registryPath);
  const tools = registry.tools
    .filter((tool) => tool.enabled !== false)
    .filter((tool) => (only ? only.has(tool.id) : true))
    .sort((a, b) => a.id.localeCompare(b.id));

  let generated = 0;
  let skipped = 0;

  for (const tool of tools) {
    const outDir = path.join(outBase, tool.id);
    process.stdout.write(`distill ${tool.id}... `);
    const result = await distillTool({ toolId: tool.id, binary: tool.binary, docsDir, outDir, model });
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

async function handleGenerate(flags: Record<string, string | boolean>): Promise<void> {
  const registryPath = expandHome(
    typeof flags.registry === "string" ? flags.registry : DEFAULT_REGISTRY
  );
  const outDir = expandHome(
    typeof flags.out === "string" ? flags.out : DEFAULT_OUT_DIR
  );
  const only = typeof flags.only === "string" ? new Set(flags.only.split(",").map((v) => v.trim())) : null;

  const registry = await loadRegistry(registryPath);
  const tools = registry.tools
    .filter((tool) => tool.enabled !== false)
    .filter((tool) => (only ? only.has(tool.id) : true))
    .sort((a, b) => a.id.localeCompare(b.id));

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

    const commands = parsed.commands.map((command) => ({
      ...command,
      docPath: tool.commandHelpArgs ? commandDocPath(command) : undefined,
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
      helpExitCode: helpResult.exitCode,
      helpHash: computeHash(helpResult.output),
      usage,
      commands,
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

    if (tool.commandHelpArgs) {
      await generateCommandDocs(tool.id, tool.binary, tool.commandHelpArgs, commands, toolDir);
    }

    indexLines.push(`| ${tool.id} | ${tool.binary} |`);
  }

  await writeFileEnsured(path.join(outDir, "index.md"), indexLines.join("\n"));
  console.log(`Generated docs for ${tools.length} tool(s) in ${outDir}`);
}

async function generateCommandDocs(
  toolId: string,
  binary: string,
  commandHelpArgs: string[],
  commands: CommandSummary[],
  toolDir: string
): Promise<void> {
  const commandsDir = path.join(toolDir, "commands");
  await ensureDir(commandsDir);

  for (const command of commands) {
    const args = commandHelpArgs.map((arg) => arg.replace("{command}", command.name));
    const helpResult = runCommand(binary, args);
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

    const doc: CommandDoc = {
      kind: "command",
      toolId,
      command: command.name,
      summary: command.summary,
      binary,
      generatedAt: new Date().toISOString(),
      helpArgs: args,
      helpExitCode: helpResult.exitCode,
      usage,
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
