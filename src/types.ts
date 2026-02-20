export type Registry = {
  version: 1;
  tools: RegistryTool[];
};

export type ToolCategory = "cli" | "sdk" | "api";

export type RegistryTool = {
  id: string;
  binary: string;
  displayName?: string;
  description?: string;
  helpArgs?: string[];
  commandHelpArgs?: string[];
  env?: string[];
  enabled?: boolean;
  category?: ToolCategory;
  homepage?: string;
  useCases?: string[];
};

export type UsageDoc = {
  requiredArgs: string[];
  optionalArgs: string[];
};

export type CommandSummary = {
  name: string;
  summary: string;
  docPath?: string;
};

export type ToolDoc = {
  kind: "tool";
  id: string;
  displayName: string;
  binary: string;
  description?: string;
  generatedAt: string;
  helpArgs: string[];
  helpExitCode: number | null;
  helpHash?: string;
  usage: UsageDoc;
  commands: CommandSummary[];
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
