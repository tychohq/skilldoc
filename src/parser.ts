import { compactWhitespace, normalizeLineEndings } from "./utils.js";
import { CommandSummary, EnvDoc, OptionDoc, SectionDoc } from "./types.js";

// Matches mixed-case headers with trailing colon: "Commands:", "Available Commands:"
const HEADER_WITH_COLON_RE = /^([A-Z][A-Za-z0-9 /_-]*):\s*$/;
// Matches all-caps headers without trailing colon: "CORE COMMANDS", "FLAGS", "USAGE"
const HEADER_ALL_CAPS_RE = /^([A-Z][A-Z0-9 /_-]*)\s*$/;
const INLINE_USAGE_RE = /^\s*Usage:\s*(.*)$/i;

function matchHeader(line: string): string | null {
  const m = line.match(HEADER_WITH_COLON_RE) ?? line.match(HEADER_ALL_CAPS_RE);
  return m ? m[1] : null;
}
const SECTION_NAMES = {
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
  const preambleLines: string[] = [];

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

    const headerName = matchHeader(line.trim());
    if (headerName) {
      if (current) {
        sections.push(current);
      }
      current = { name: headerName, lines: [] };
      continue;
    }

    if (current) {
      current.lines.push(line);
    } else {
      preambleLines.push(line);
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

  const commandsSections = sections.filter((s) => /command|service/i.test(s.name));
  const examplesSection = findSection(sections, SECTION_NAMES.examples);
  const envSection = findSection(sections, SECTION_NAMES.env);

  // Collect commands from explicit "command" sections first, then also scan
  // all other non-option/non-example/non-env sections for command-like lines.
  // This handles tools like wrangler that group commands under category headers
  // (ACCOUNT, COMPUTE & AI, STORAGE & DATABASES, etc.).
  const excludeSections = new Set([
    ...commandsSections.map((s) => s.name),
    ...(examplesSection ? [examplesSection.name] : []),
    ...(envSection ? [envSection.name] : []),
  ]);
  const optionNameSet = new Set(
    sections.filter((s) => /option|flag/i.test(s.name)).map((s) => s.name)
  );
  const candidateSections =
    commandsSections.length > 0
      ? [
          ...commandsSections,
          ...sections.filter(
            (s) =>
              !excludeSections.has(s.name) &&
              !optionNameSet.has(s.name) &&
              !/option|flag|usage/i.test(s.name)
          ),
        ]
      : sections;
  const commandLines = candidateSections.flatMap((s) => s.lines);
  const commands = parseCommands(commandLines, true);

  const optionsSections = sections.filter((section) =>
    /option|flag/i.test(section.name)
  );
  // Fall back to preamble lines when no sections exist at all (e.g. curl --help all
  // outputs a flat list of options with no structural headers).
  const optionLines =
    optionsSections.length > 0
      ? optionsSections.flatMap((section) => section.lines)
      : sections.length === 0
        ? preambleLines
        : [];
  const options = parseOptions(optionLines);

  const examples = examplesSection ? trimEmpty(examplesSection.lines) : [];
  const env = envSection ? parseEnv(envSection.lines) : [];

  if (commandsSections.length === 0 && commands.length === 0) {
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
    if (matchHeader(line.trim()) !== null) {
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
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (requireIndent && !/^\s+/.test(line)) continue;
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("-")) continue;

    // Inline format: "name  description" (tab or 2+ spaces separator)
    const match = trimmed.match(/^(\S+(?:\s+\S+)*)(?:\t|\s{2,})(.+)$/);
    if (match) {
      commands.push({
        name: match[1].trim().replace(/:$/, ""),
        summary: match[2].trim(),
      });
      continue;
    }

    // Man-page bullet-list format: "o servicename" (e.g. AWS AVAILABLE SERVICES)
    const bulletMatch = trimmed.match(/^o\s+([a-z][a-z0-9-]*)\s*$/);
    if (bulletMatch) {
      commands.push({ name: bulletMatch[1], summary: "" });
      continue;
    }

    // 2-line format: signature on this line, description on next more-indented line.
    // Signature must contain CLI arg markers ([, <, or () to distinguish from category headers.
    // e.g.:  "  drive (drv) <command> [flags]" / "    Google Drive"
    if (/[([<]/.test(trimmed)) {
      const lineIndent = (line.match(/^(\s*)/) ?? ["", ""])[1].length;
      let nextIdx = i + 1;
      while (nextIdx < lines.length && !lines[nextIdx].trim()) nextIdx++;
      if (nextIdx < lines.length) {
        const nextLine = lines[nextIdx];
        const nextIndent = (nextLine.match(/^(\s*)/) ?? ["", ""])[1].length;
        if (nextIndent > lineIndent) {
          const nameMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9_-]*)/);
          if (nameMatch) {
            const hasSubcommands = /<command>/i.test(trimmed) || undefined;
            commands.push({
              name: nameMatch[1],
              summary: nextLine.trim(),
              ...(hasSubcommands && { hasSubcommands }),
            });
            i = nextIdx; // consume the description line
            continue;
          }
        }
      }
    }
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
