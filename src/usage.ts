import { UsageDoc } from "./types.js";

export type UsageTokens = {
  requiredArgs: string[];
  optionalArgs: string[];
  flags: string[];
};

export function buildUsageDoc(lines: string[], binary: string): UsageDoc {
  const tokens = extractUsageTokens(lines, binary);
  return {
    requiredArgs: tokens.requiredArgs,
    optionalArgs: tokens.optionalArgs,
  };
}

export function extractUsageTokens(lines: string[], binary: string): UsageTokens {
  const requiredArgs: string[] = [];
  const optionalArgs: string[] = [];
  const flags: string[] = [];

  for (const line of lines) {
    const variant = parseUsageLine(line, binary);
    if (!variant) continue;

    for (const token of variant.required) {
      if (isFlag(token)) {
        flags.push(token);
      } else {
        requiredArgs.push(token);
      }
    }

    for (const token of variant.optionalArgs) {
      if (isFlag(token)) {
        flags.push(token);
      } else {
        optionalArgs.push(token);
      }
    }

    flags.push(...variant.optionalFlags);
  }

  return {
    requiredArgs: unique(requiredArgs),
    optionalArgs: unique(optionalArgs),
    flags: unique(flags),
  };
}

type UsageVariant = {
  required: string[];
  optionalFlags: string[];
  optionalArgs: string[];
};

function parseUsageLine(line: string, binary: string): UsageVariant | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const segments = splitOptionalSegments(trimmed);
  const requiredTokens: string[] = [];
  const optionalFlags: string[] = [];
  const optionalArgs: string[] = [];

  for (const segment of segments) {
    const tokens = normalizeTokens(segment.text);
    const coalesced = coalesceFlags(tokens);
    const collapsed = collapseAlternatives(coalesced);
    for (const token of collapsed) {
      if (!token) continue;
      if (segment.optional) {
        if (isFlag(token)) {
          optionalFlags.push(token);
        } else {
          optionalArgs.push(token);
        }
      } else {
        requiredTokens.push(token);
      }
    }
  }

  const required = stripBinary(requiredTokens, binary);

  return {
    required: unique(required),
    optionalFlags: unique(optionalFlags),
    optionalArgs: unique(optionalArgs),
  };
}

function splitOptionalSegments(input: string): Array<{ text: string; optional: boolean }> {
  const segments: Array<{ text: string; optional: boolean }> = [];
  let current = "";
  let optional = false;
  let depth = 0;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const prev = i > 0 ? input[i - 1] : "";
    const next = i + 1 < input.length ? input[i + 1] : "";

    if (char === "[" && depth === 0 && isBoundary(prev)) {
      if (current.trim()) {
        segments.push({ text: current.trim(), optional });
      }
      current = "";
      optional = true;
      depth = 1;
      continue;
    }

    if (char === "]" && depth === 1 && isBoundary(next)) {
      if (current.trim()) {
        segments.push({ text: current.trim(), optional });
      }
      current = "";
      optional = false;
      depth = 0;
      continue;
    }

    if (char === "[" && depth > 0) {
      depth += 1;
    }
    if (char === "]" && depth > 0) {
      depth -= 1;
    }

    current += char;
  }

  if (current.trim()) {
    segments.push({ text: current.trim(), optional });
  }

  return segments;
}

function isBoundary(char: string): boolean {
  return char === "" || /\s/.test(char);
}

function normalizeTokens(text: string): string[] {
  return text
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function coalesceFlags(tokens: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "|") {
      result.push(token);
      continue;
    }
    if (isFlag(token)) {
      const next = tokens[i + 1];
      if (next && !isFlag(next) && next !== "|") {
        result.push(`${token} ${next}`);
        i += 1;
      } else {
        result.push(token);
      }
      continue;
    }
    result.push(token);
  }
  return result;
}

function collapseAlternatives(tokens: string[]): string[] {
  const result: string[] = [];
  let group: string[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "|") {
      continue;
    }
    group.push(token);
    const next = tokens[i + 1];
    if (next !== "|") {
      result.push(selectCanonical(group));
      group = [];
    }
  }

  return result;
}

function selectCanonical(tokens: string[]): string {
  const long = tokens.find((token) => token.startsWith("--"));
  return long ?? tokens[0];
}

function isFlag(token: string): boolean {
  return token.startsWith("-");
}

function stripBinary(tokens: string[], binary: string): string[] {
  if (tokens.length === 0) return tokens;
  const cleaned: string[] = [];
  const base = binary.split("/").pop() ?? binary;

  for (const token of tokens) {
    if (token === binary || token === base) {
      continue;
    }
    cleaned.push(token);
  }
  return cleaned;
}

function unique(tokens: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    result.push(token);
  }
  return result;
}
