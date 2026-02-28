export type ToolComplexity = "simple" | "complex";

export type UsageDoc = {
  requiredArgs: string[];
  optionalArgs: string[];
};

export type CommandSummary = {
  name: string;
  summary: string;
  docPath?: string;
  /** True when the CLI signature contains `<command>`, indicating the command has subcommands. */
  hasSubcommands?: boolean;
};

export type ToolDoc = {
  kind: "tool";
  id: string;
  displayName: string;
  binary: string;
  description?: string;
  generatedAt: string;
  helpArgs: string[];
  commandHelpArgs?: string[];
  helpExitCode: number | null;
  helpHash?: string;
  usage: UsageDoc;
  commands: CommandSummary[];
  subcommandCandidates?: CommandSummary[];
  options: OptionDoc[];
  examples: string[];
  env: EnvDoc[];
  warnings: string[];
};

export type CommandDoc = {
  kind: "command";
  toolId: string;
  command: string;
  summary?: string;
  binary: string;
  description?: string;
  generatedAt: string;
  helpArgs: string[];
  helpExitCode: number | null;
  usage: UsageDoc;
  subcommands?: CommandSummary[];
  options: OptionDoc[];
  examples: string[];
  env: EnvDoc[];
  warnings: string[];
};

export type OptionDoc = {
  flags: string;
  description: string;
};

export type EnvDoc = {
  name: string;
  description: string;
};

export type SectionDoc = {
  name: string;
  lines: string[];
};
