import { CommandDoc, ToolDoc } from "./types.js";

export function renderToolMarkdown(doc: ToolDoc): string {
  const lines: string[] = [];
  lines.push(`# ${doc.displayName}`);
  lines.push("");

  if (doc.description) {
    lines.push(doc.description);
    lines.push("");
  }

  renderUsageSection(lines, doc.usage.requiredArgs, doc.usage.optionalArgs);

  if (doc.commands.length > 0) {
    lines.push("## Commands");
    lines.push("");
    lines.push("| Command | Summary |", "| --- | --- |");
    for (const command of doc.commands) {
      const label = command.docPath
        ? `[${escapePipes(command.name)}](${command.docPath})`
        : escapePipes(command.name);
      lines.push(`| ${label} | ${escapePipes(command.summary)} |`);
    }
    lines.push("");
  }

  if (doc.options.length > 0) {
    lines.push("## Flags");
    lines.push("");
    lines.push("| Flag | Description |", "| --- | --- |");
    for (const option of doc.options) {
      const primary = formatFlag(option.flags);
      if (!primary) continue;
      lines.push(`| ${escapePipes(primary)} | ${escapePipes(option.description)} |`);
    }
    lines.push("");
  }

  if (doc.env.length > 0) {
    lines.push("## Env");
    lines.push("");
    lines.push("| Name | Description |", "| --- | --- |");
    for (const env of doc.env) {
      lines.push(`| ${escapePipes(env.name)} | ${escapePipes(env.description)} |`);
    }
    lines.push("");
  }

  if (doc.examples.length > 0) {
    lines.push("## Examples");
    lines.push("");
    lines.push("```text");
    lines.push(...doc.examples);
    lines.push("```");
    lines.push("");
  }

  if (doc.warnings.length > 0) {
    lines.push("## Warnings");
    lines.push("");
    for (const warning of doc.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push("");
  }

  lines.push("## Metadata");
  lines.push("");
  lines.push(`- id: ${doc.id}`);
  lines.push(`- binary: ${doc.binary}`);
  lines.push(`- kind: ${doc.kind}`);
  lines.push(`- generatedAt: ${doc.generatedAt}`);
  lines.push("");

  return lines.join("\n");
}

export function renderCommandMarkdown(doc: CommandDoc): string {
  const lines: string[] = [];
  lines.push(`# ${doc.toolId} ${doc.command}`);
  lines.push("");

  if (doc.summary) {
    lines.push(doc.summary);
    lines.push("");
  }

  if (doc.description) {
    lines.push(doc.description);
    lines.push("");
  }

  renderUsageSection(lines, doc.usage.requiredArgs, doc.usage.optionalArgs);

  if (doc.subcommands && doc.subcommands.length > 0) {
    lines.push("## Subcommands");
    lines.push("");
    lines.push("| Subcommand | Summary |", "| --- | --- |");
    for (const subCmd of doc.subcommands) {
      const label = subCmd.docPath
        ? `[${escapePipes(subCmd.name)}](${subCmd.docPath})`
        : escapePipes(subCmd.name);
      lines.push(`| ${label} | ${escapePipes(subCmd.summary)} |`);
    }
    lines.push("");
  }

  if (doc.options.length > 0) {
    lines.push("## Flags");
    lines.push("");
    lines.push("| Flag | Description |", "| --- | --- |");
    for (const option of doc.options) {
      const primary = formatFlag(option.flags);
      if (!primary) continue;
      lines.push(`| ${escapePipes(primary)} | ${escapePipes(option.description)} |`);
    }
    lines.push("");
  }

  if (doc.env.length > 0) {
    lines.push("## Env");
    lines.push("");
    lines.push("| Name | Description |", "| --- | --- |");
    for (const env of doc.env) {
      lines.push(`| ${escapePipes(env.name)} | ${escapePipes(env.description)} |`);
    }
    lines.push("");
  }

  if (doc.examples.length > 0) {
    lines.push("## Examples");
    lines.push("");
    lines.push("```text");
    lines.push(...doc.examples);
    lines.push("```");
    lines.push("");
  }

  if (doc.warnings.length > 0) {
    lines.push("## Warnings");
    lines.push("");
    for (const warning of doc.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push("");
  }

  lines.push("## Metadata");
  lines.push("");
  lines.push(`- toolId: ${doc.toolId}`);
  lines.push(`- command: ${doc.command}`);
  lines.push(`- binary: ${doc.binary}`);
  lines.push(`- kind: ${doc.kind}`);
  lines.push(`- generatedAt: ${doc.generatedAt}`);
  lines.push("");

  return lines.join("\n");
}

function renderUsageSection(lines: string[], required: string[], optional: string[]): void {
  lines.push("## Usage");
  lines.push("");

  if (required.length === 0 && optional.length === 0) {
    lines.push("No usage detected.");
    lines.push("");
    return;
  }

  if (required.length > 0) {
    lines.push(`Required arguments: ${formatTokens(required)}`);
  }

  if (optional.length > 0) {
    lines.push(`Optional arguments: ${formatTokens(optional)}`);
  }

  lines.push("");
}

function formatTokens(tokens: string[]): string {
  return tokens.map((token) => `\`${token}\``).join(", ");
}

function formatFlag(raw: string): string | null {
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const isLong = entry.startsWith("--");
      const cleaned = entry.replace(/^--?/, "").replace(/=/g, " ");
      return { cleaned, isLong };
    });

  if (entries.length === 0) return null;
  const primary = entries.find((entry) => entry.isLong) ?? entries[0];
  return primary.cleaned;
}

function escapePipes(value: string): string {
  return value.replace(/\|/g, "\\|");
}
