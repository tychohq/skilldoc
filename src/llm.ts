import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import { expandHome } from "./utils.js";

export type ProviderType =
  | "claude-cli"
  | "codex-cli"
  | "gemini-cli"
  | "anthropic"
  | "openai"
  | "gemini"
  | "openrouter";

export type ResolvedProvider = {
  provider: ProviderType;
  model: string;
  apiKey?: string;
};

export type ExecResult = {
  error?: Error;
  stdout: string | null;
  stderr: string | null;
  status: number | null;
};

export type ExecFn = (
  command: string,
  args: ReadonlyArray<string>,
  options: { input: string; encoding: "utf8"; maxBuffer: number; env?: Record<string, string | undefined> }
) => ExecResult;

export type LLMCallOptions = {
  model?: string;
};

export type CreateLLMCallerOptions = {
  exec?: ExecFn;
  checkBinary?: (name: string) => boolean;
  env?: Record<string, string | undefined>;
  configPath?: string;
};

type LLMConfig = {
  provider?: ProviderType;
  model?: string;
  apiKey?: string;
};

const DEFAULT_LLM_CONFIG_PATH = "~/.skilldoc/config.yaml";
const MAX_BUFFER = 10 * 1024 * 1024;

const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderType, string> = {
  "claude-cli": "claude-opus-4-6",
  "codex-cli": "gpt-5.3-codex",
  "gemini-cli": "gemini-3.1-pro-preview",
  anthropic: "claude-opus-4-6",
  openai: "gpt-5.2",
  gemini: "gemini-3.1-pro-preview",
  openrouter: "anthropic/claude-opus-4-6",
};

const ENV_BY_PROVIDER: Partial<Record<ProviderType, string>> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

const defaultExec: ExecFn = (command, args, options) =>
  spawnSync(command, [...args], options) as ReturnType<typeof spawnSync>;

const defaultCheckBinary = (name: string): boolean =>
  spawnSync("which", [name], { encoding: "utf8" }).status === 0;

const API_RUNNER_SCRIPT = `
const provider = process.env.LLM_PROVIDER;
const model = process.env.LLM_MODEL;
const apiKey = process.env.LLM_API_KEY;

const readPrompt = async () => {
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  return data;
};

const parseOpenAICompatibleContent = (payload) => {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const part of content) {
      if (part && typeof part === "object" && typeof part.text === "string") {
        parts.push(part.text);
      }
    }
    return parts.join("");
  }
  return "";
};

const getGeminiUrl = (modelName, key) =>
  "https://generativelanguage.googleapis.com/v1beta/models/" +
  encodeURIComponent(modelName) +
  ":generateContent?key=" +
  encodeURIComponent(key);

const extractText = (backend, payload) => {
  if (backend === "anthropic") {
    const content = payload?.content;
    if (!Array.isArray(content)) return "";
    for (const item of content) {
      if (item && typeof item === "object" && item.type === "text" && typeof item.text === "string") {
        return item.text;
      }
    }
    return "";
  }
  if (backend === "openai" || backend === "openrouter") {
    return parseOpenAICompatibleContent(payload);
  }
  if (backend === "gemini") {
    const candidates = payload?.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) return "";
    const parts = candidates[0]?.content?.parts;
    if (!Array.isArray(parts)) return "";
    const out = [];
    for (const part of parts) {
      if (part && typeof part === "object" && typeof part.text === "string") {
        out.push(part.text);
      }
    }
    return out.join("");
  }
  return "";
};

const main = async () => {
  if (!provider || !model || !apiKey) {
    throw new Error("Missing API provider configuration");
  }

  const prompt = await readPrompt();
  let url = "";
  let headers = {};
  let body = {};

  if (provider === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    headers = {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
    body = {
      model,
      max_tokens: 16000,
      thinking: { type: "adaptive", effort: "high" },
      messages: [{ role: "user", content: prompt }],
    };
  } else if (provider === "openai") {
    url = "https://api.openai.com/v1/chat/completions";
    headers = {
      "content-type": "application/json",
      "authorization": "Bearer " + apiKey,
    };
    body = {
      model,
      reasoning: { effort: "high" },
      messages: [{ role: "user", content: prompt }],
    };
  } else if (provider === "gemini") {
    url = getGeminiUrl(model, apiKey);
    headers = {
      "content-type": "application/json",
    };
    body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        thinkingConfig: { thinkingBudget: 10000 },
      },
    };
  } else if (provider === "openrouter") {
    url = "https://openrouter.ai/api/v1/chat/completions";
    headers = {
      "content-type": "application/json",
      "authorization": "Bearer " + apiKey,
    };
    body = {
      model,
      reasoning: { effort: "high" },
      messages: [{ role: "user", content: prompt }],
    };
  } else {
    throw new Error("Unsupported API provider: " + provider);
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const raw = await response.text();
  if (!response.ok) {
    process.stderr.write("HTTP " + response.status + ": " + raw.slice(0, 1000));
    process.exit(2);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.stderr.write("API returned invalid JSON: " + raw.slice(0, 1000));
    process.exit(3);
  }

  const output = extractText(provider, payload);
  if (!output || !output.trim()) {
    process.stderr.write("API returned empty output");
    process.exit(4);
  }

  process.stdout.write(output);
};

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  process.stderr.write(msg);
  process.exit(1);
});
`.trim();

function parseProvider(raw: unknown): ProviderType | undefined {
  if (
    raw === "claude-cli" ||
    raw === "codex-cli" ||
    raw === "gemini-cli" ||
    raw === "anthropic" ||
    raw === "openai" ||
    raw === "gemini" ||
    raw === "openrouter"
  ) {
    return raw;
  }
  return undefined;
}

function loadLLMConfig(configPath: string): LLMConfig {
  const resolvedPath = expandHome(configPath);

  let raw: string;
  try {
    raw = readFileSync(resolvedPath, "utf8");
  } catch {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const obj = parsed as Record<string, unknown>;
  const provider = parseProvider(obj.provider);
  const model = typeof obj.model === "string" && obj.model.trim() ? obj.model.trim() : undefined;
  const apiKey = typeof obj.apiKey === "string" && obj.apiKey.trim() ? obj.apiKey.trim() : undefined;

  if (obj.provider !== undefined && !provider) {
    throw new Error(
      "Invalid provider in ~/.skilldoc/config.yaml. Expected one of: claude-cli, codex-cli, gemini-cli, anthropic, openai, gemini, openrouter."
    );
  }

  return { provider, model, apiKey };
}

function selectModel(provider: ProviderType, options: LLMCallOptions, config: LLMConfig): string {
  return options.model ?? config.model ?? DEFAULT_MODEL_BY_PROVIDER[provider];
}

function providerNeedsApiKey(provider: ProviderType): boolean {
  return provider === "anthropic" || provider === "openai" || provider === "gemini" || provider === "openrouter";
}

function getApiKeyForProvider(
  provider: ProviderType,
  env: Record<string, string | undefined>,
  config: LLMConfig
): string | undefined {
  if (!providerNeedsApiKey(provider)) return undefined;

  if (config.provider === provider && config.apiKey) {
    return config.apiKey;
  }

  const envKey = ENV_BY_PROVIDER[provider];
  return envKey ? env[envKey] : undefined;
}

function resolveProviderWithDeps(
  options: LLMCallOptions,
  deps: Pick<CreateLLMCallerOptions, "checkBinary" | "env" | "configPath">
): ResolvedProvider {
  const checkBinary = deps.checkBinary ?? defaultCheckBinary;
  const env = deps.env ?? process.env;
  const configPath = deps.configPath ?? DEFAULT_LLM_CONFIG_PATH;
  const config = loadLLMConfig(configPath);

  if (config.provider) {
    const model = selectModel(config.provider, options, config);
    const apiKey = getApiKeyForProvider(config.provider, env, config);
    return { provider: config.provider, model, ...(apiKey ? { apiKey } : {}) };
  }

  for (const [provider, binary] of [
    ["claude-cli", "claude"],
    ["codex-cli", "codex"],
    ["gemini-cli", "gemini"],
  ] as const) {
    if (checkBinary(binary)) {
      return { provider, model: selectModel(provider, options, config) };
    }
  }

  for (const provider of ["anthropic", "openai", "gemini", "openrouter"] as const) {
    const envKey = ENV_BY_PROVIDER[provider]!;
    const envValue = env[envKey];
    if (envValue) {
      const apiKey = config.apiKey ?? envValue;
      return { provider, model: selectModel(provider, options, config), apiKey };
    }
  }

  throw new Error(
    "No LLM provider available. Set ~/.skilldoc/config.yaml (provider/model/apiKey), install one CLI (claude, codex, gemini), or set an API key (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY)."
  );
}

function runCliCommand(
  command: string,
  args: ReadonlyArray<string>,
  prompt: string,
  exec: ExecFn
): string {
  const result = exec(command, args, {
    input: prompt,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });

  if (result.error) {
    throw new Error(`Failed to run ${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = result.stderr ?? "";
    throw new Error(`${command} exited with code ${result.status}${stderr ? `: ${stderr.slice(0, 200)}` : ""}`);
  }

  const output = result.stdout ?? "";
  if (!output.trim()) {
    const stderr = result.stderr ?? "";
    throw new Error(`${command} returned empty output${stderr ? `: ${stderr.slice(0, 200)}` : ""}`);
  }

  return output;
}

function runApiProvider(provider: ResolvedProvider, prompt: string, exec: ExecFn): string {
  if (!provider.apiKey) {
    throw new Error(`Missing API key for ${provider.provider}.`);
  }

  const result = exec("node", ["--input-type=module", "-e", API_RUNNER_SCRIPT], {
    input: prompt,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    env: {
      ...process.env,
      LLM_PROVIDER: provider.provider,
      LLM_MODEL: provider.model,
      LLM_API_KEY: provider.apiKey,
    },
  });

  if (result.error) {
    throw new Error(`Failed to run API caller for ${provider.provider}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = result.stderr ?? "";
    throw new Error(`${provider.provider} API call failed${stderr ? `: ${stderr.slice(0, 500)}` : ""}`);
  }

  const output = result.stdout ?? "";
  if (!output.trim()) {
    const stderr = result.stderr ?? "";
    throw new Error(`${provider.provider} API returned empty output${stderr ? `: ${stderr.slice(0, 500)}` : ""}`);
  }

  return output;
}

function callLLMWithDeps(
  prompt: string,
  options: LLMCallOptions,
  deps: Pick<CreateLLMCallerOptions, "exec" | "checkBinary" | "env" | "configPath">
): string {
  const resolved = resolveProviderWithDeps(options, deps);
  const exec = deps.exec ?? defaultExec;

  if (resolved.provider === "claude-cli") {
    return runCliCommand(
      "claude",
      ["-p", "--output-format", "text", "--model", resolved.model, "--no-session-persistence", "--effort", "high"],
      prompt,
      exec
    );
  }

  if (resolved.provider === "codex-cli") {
    return runCliCommand("codex", ["exec", "--effort", "high", "--model", resolved.model], prompt, exec);
  }

  if (resolved.provider === "gemini-cli") {
    return runCliCommand("gemini", ["-p", prompt], "", exec);
  }

  return runApiProvider(resolved, prompt, exec);
}

export function createLLMCaller(options: CreateLLMCallerOptions = {}): {
  callLLM: (prompt: string, callOptions?: LLMCallOptions) => string;
  resolveProvider: (callOptions?: LLMCallOptions) => ResolvedProvider;
} {
  return {
    callLLM: (prompt: string, callOptions: LLMCallOptions = {}) =>
      callLLMWithDeps(prompt, callOptions, {
        exec: options.exec,
        checkBinary: options.checkBinary,
        env: options.env,
        configPath: options.configPath,
      }),
    resolveProvider: (callOptions: LLMCallOptions = {}) =>
      resolveProviderWithDeps(callOptions, {
        checkBinary: options.checkBinary,
        env: options.env,
        configPath: options.configPath,
      }),
  };
}

const defaultCaller = createLLMCaller();

export function callLLM(prompt: string, options: LLMCallOptions = {}): string {
  return defaultCaller.callLLM(prompt, options);
}

export function resolveProvider(options: LLMCallOptions = {}): ResolvedProvider {
  return defaultCaller.resolveProvider(options);
}

export { DEFAULT_LLM_CONFIG_PATH };
