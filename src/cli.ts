import path from "node:path";
import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import YAML from "yaml";
import { loadRegistry } from "./config.js";
import { parseHelp } from "./parser.js";
import { renderCommandMarkdown, renderToolMarkdown } from "./render.js";
import { buildUsageDoc, extractUsageTokens } from "./usage.js";
import { expandHome, ensureDir, writeFileEnsured } from "./utils.js";
import { CommandDoc, CommandSummary, ToolDoc } from "./types.js";

const DEFAULT_REGISTRY = "~/.agents/tool-docs/registry.yaml";
const DEFAULT_OUT_DIR = "~/.agents/docs/tool-docs";

const HELP_TEXT = `tool-docs

Usage:
  tool-docs generate [--registry <path>] [--out <path>] [--only <id1,id2>]
  tool-docs init [--registry <path>] [--force]
  tool-docs --help

Commands:
  generate   Generate markdown + JSON docs for tools in the registry
  init       Create a starter registry file

Options:
  --registry <path>   Path to registry YAML (default: ${DEFAULT_REGISTRY})
  --out <path>        Output directory (default: ${DEFAULT_OUT_DIR})
  --only <ids>        Comma-separated list of tool ids to generate
  --force             Overwrite registry on init
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

  if (command === "--version" || command === "-v") {
    console.log(VERSION);
    return;
  }

  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("-")) continue;
    if (arg === "--force") {
      flags.force = true;
      continue;
    }
    if (arg === "--registry" || arg === "--out" || arg === "--only") {
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

  const sample = `version: 1\ntools:\n  - id: git\n    binary: git\n    displayName: Git\n    helpArgs: ["-h"]\n    commandHelpArgs: ["help", "{command}"]\n  - id: rg\n    binary: rg\n    displayName: ripgrep\n    helpArgs: ["--help"]\n`;

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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
