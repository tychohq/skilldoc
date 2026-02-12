import { compactWhitespace, normalizeLineEndings } from "./utils.js";
import { CommandSummary, EnvDoc, OptionDoc, SectionDoc } from "./types.js";

const HEADER_RE = /^([A-Z][A-Za-z0-9 /_-]*):\s*$/;
const INLINE_USAGE_RE = /^\s*Usage:\s*(.*)$/i;
const SECTION_NAMES = {
  commands: ["Commands", "Command", "Available Commands", "Subcommands", "Sub-commands"],
  examples: ["Examples", "Example"],
  env: ["Environment", "Environment Variables", "Env", "ENV"],
};

export type ParsedHelp = {
  usageLines: string[];
  commands: CommandSummary[];
  options: OptionDoc[];
  examples: string[];
  env: EnvDoc[];
  warnings: string[];
};

export function parseHelp(rawHelp: string): ParsedHelp {
  const help = normalizeLineEndings(rawHelp);
  const lines = help.split("\n");
  const warnings: string[] = [];
  const sections: SectionDoc[] = [];

  let current: SectionDoc | null = null;
  const usageLines: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = compactWhitespace(lines[i]);

    const inlineUsage = line.match(INLINE_USAGE_RE);
    if (inlineUsage) {
      if (inlineUsage[1]) {
        usageLines.push(inlineUsage[1].trim());
      }
      const subsequent = collectIndented(lines, i + 1);
      usageLines.push(...subsequent);
      i += subsequent.length;
      continue;
    }

    const headerMatch = line.match(HEADER_RE);
    if (headerMatch) {
      if (current) {
        sections.push(current);
      }
      current = { name: headerMatch[1], lines: [] };
      continue;
    }

    if (current) {
      current.lines.push(line);
    }
  }

  if (current) {
    sections.push(current);
  }

  if (usageLines.length === 0) {
    const usageSection = findSection(sections, ["Usage", "USAGE"]);
    if (usageSection) {
      usageLines.push(...trimEmpty(usageSection.lines));
    }
  }

  const commandsSection = findSection(sections, SECTION_NAMES.commands);
  const examplesSection = findSection(sections, SECTION_NAMES.examples);
  const envSection = findSection(sections, SECTION_NAMES.env);

  const commandLines = commandsSection
    ? commandsSection.lines
    : sections.flatMap((section) => section.lines);
  const commands = parseCommands(commandLines, true);

  const optionsSections = sections.filter((section) =>
    /options|flags|arguments/i.test(section.name)
  );
  const optionLines = optionsSections.flatMap((section) => section.lines);
  const options = parseOptions(optionLines);

  const examples = examplesSection ? trimEmpty(examplesSection.lines) : [];
  const env = envSection ? parseEnv(envSection.lines) : [];

  if (!commandsSection && commands.length === 0) {
    warnings.push("No commands detected.");
  }
  if (options.length === 0) {
    warnings.push("No options detected.");
  }

  return {
    usageLines: trimEmpty(usageLines),
    commands,
    options,
    examples,
    env,
    warnings,
  };
}

function collectIndented(lines: string[], startIndex: number): string[] {
  const collected: string[] = [];
  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim().length === 0) {
      if (collected.length === 0) {
        continue;
      }
      break;
    }
    if (!/^\s+/.test(line)) {
      break;
    }
    if (HEADER_RE.test(line)) {
      break;
    }
    collected.push(line.trim());
  }
  return collected;
}

function findSection(sections: SectionDoc[], names: string[]): SectionDoc | undefined {
  const lower = new Set(names.map((name) => name.toLowerCase()));
  return sections.find((section) => lower.has(section.name.toLowerCase()));
}

function parseCommands(lines: string[], requireIndent: boolean): CommandSummary[] {
  const commands: CommandSummary[] = [];
  for (const line of lines) {
    if (requireIndent && !/^\s+/.test(line)) continue;
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("-")) continue;
    const match = trimmed.match(/^(\S+(?:\s+\S+)*)\s{2,}(.+)$/);
    if (!match) continue;
    commands.push({
      name: match[1].trim(),
      summary: match[2].trim(),
    });
  }
  return commands;
}

function parseOptions(lines: string[]): OptionDoc[] {
  const options: OptionDoc[] = [];
  let currentFlags = "";
  let currentDesc: string[] = [];
  let currentIndent = 0;

  const flush = () => {
    if (!currentFlags) return;
    options.push({
      flags: currentFlags,
      description: currentDesc.join(" ").trim(),
    });
    currentFlags = "";
    currentDesc = [];
    currentIndent = 0;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith("-")) {
      flush();
      const indent = line.search(/\S/);
      const match = trimmed.match(/^(\S(?:.*?))\s{2,}(.+)$/);
      if (match) {
        currentFlags = match[1].trim();
        currentDesc = [match[2].trim()];
      } else {
        currentFlags = trimmed;
        currentDesc = [];
      }
      currentIndent = indent === -1 ? 0 : indent;
      continue;
    }

    if (currentFlags) {
      const indent = line.search(/\S/);
      if (indent > currentIndent) {
        currentDesc.push(trimmed);
      } else {
        flush();
      }
    }
  }

  flush();
  return options;
}

function parseEnv(lines: string[]): EnvDoc[] {
  const env: EnvDoc[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\S+)\s{2,}(.+)$/);
    if (!match) continue;
    env.push({
      name: match[1].trim(),
      description: match[2].trim(),
    });
  }
  return env;
}

function trimEmpty(lines: string[]): string[] {
  const trimmed = lines.map((line) => line.trimEnd());
  while (trimmed.length > 0 && trimmed[0].trim() === "") {
    trimmed.shift();
  }
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === "") {
    trimmed.pop();
  }
  return trimmed;
}
