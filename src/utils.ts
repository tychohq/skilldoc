import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import os from "node:os";

export function expandHome(input: string): string {
  if (input.startsWith("~/")) {
    return input.replace("~", os.homedir());
  }
  return input;
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function writeFileEnsured(path: string, content: string): Promise<void> {
  await ensureDir(dirname(path));
  await writeFile(path, content, "utf8");
}

export async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

export function compactWhitespace(text: string): string {
  return text.replace(/\s+$/g, "");
}
