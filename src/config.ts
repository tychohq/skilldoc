import YAML from "yaml";
import { Registry, RegistryTool } from "./types.js";
import { readText } from "./utils.js";

export function createToolEntry(binaryName: string): RegistryTool {
  return {
    id: binaryName,
    binary: binaryName,
    displayName: binaryName,
    helpArgs: ["--help"],
    enabled: true,
  };
}

export async function loadRegistry(path: string): Promise<Registry> {
  const raw = await readText(path);
  const parsed = YAML.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Registry is empty or invalid YAML.");
  }
  if (parsed.version !== 1) {
    throw new Error("Registry version must be 1.");
  }
  if (!Array.isArray(parsed.tools)) {
    throw new Error("Registry tools must be an array.");
  }
  const tools = parsed.tools.map(normalizeTool);
  return {
    version: 1,
    tools,
  };
}

function normalizeTool(tool: RegistryTool): RegistryTool {
  if (!tool || typeof tool !== "object") {
    throw new Error("Registry tool entry is invalid.");
  }
  if (!tool.id || typeof tool.id !== "string") {
    throw new Error("Registry tool missing id.");
  }
  if (!tool.binary || typeof tool.binary !== "string") {
    throw new Error(`Registry tool ${tool.id} missing binary.`);
  }
  if (tool.category !== undefined) {
    if (tool.category !== "cli" && tool.category !== "sdk" && tool.category !== "api") {
      throw new Error(`Registry tool ${tool.id} has invalid category "${tool.category}". Must be cli, sdk, or api.`);
    }
  }
  if (tool.homepage !== undefined && typeof tool.homepage !== "string") {
    throw new Error(`Registry tool ${tool.id} homepage must be a string.`);
  }
  if (tool.useCases !== undefined) {
    if (!Array.isArray(tool.useCases) || tool.useCases.some((u: unknown) => typeof u !== "string")) {
      throw new Error(`Registry tool ${tool.id} useCases must be an array of strings.`);
    }
  }
  if (tool.maxDepth !== undefined) {
    if (typeof tool.maxDepth !== "number" || !Number.isInteger(tool.maxDepth) || tool.maxDepth < 1) {
      throw new Error(`Registry tool ${tool.id} maxDepth must be a positive integer.`);
    }
  }
  return {
    enabled: true,
    helpArgs: ["--help"],
    ...tool,
  };
}
