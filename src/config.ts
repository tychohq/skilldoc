import YAML from "yaml";
import { Registry, RegistryTool } from "./types.js";
import { readText } from "./utils.js";

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
  return {
    enabled: true,
    helpArgs: ["--help"],
    ...tool,
  };
}
