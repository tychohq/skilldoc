import path from "node:path";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { expandHome, writeFileEnsured } from "./utils.js";
import { DEFAULT_SKILLS_DIR, DEFAULT_DOCS_DIR, DEFAULT_MODEL, gatherRawDocs } from "./distill.js";
import { callLLM as callSharedLLM, createLLMCaller, type ExecFn } from "./llm.js";

export type { ExecFn } from "./llm.js";

export const DEFAULT_THRESHOLD = 9;
export const DEFAULT_VALIDATION_MODELS = ["claude-sonnet-4-6", "claude-opus-4-6"];
const NUM_SCENARIOS = 4;

const defaultExec: ExecFn = (command, args, options) =>
  spawnSync(command, [...args], options) as ReturnType<typeof spawnSync>;

export type GroundednessResult = {
  score: number;
  hallucinatedItems: string[];
  reasoning: string;
};

export type ValidationScenario = {
  task: string;
  hint: string;
};

export type ValidationScorecard = {
  task: string;
  command: string;
  completed: boolean;
  correct: boolean;
  hallucinated: boolean;
  missing: string;
  score: number;
  reasoning: string;
};

export type ValidationReport = {
  toolId: string;
  skillPath: string;
  model: string;
  scenarios: ValidationScorecard[];
  averageScore: number;
  passed: boolean;
  threshold: number;
  generatedAt: string;
  groundedness?: GroundednessResult;
};

export type ValidateOptions = {
  toolId: string;
  skillsDir?: string;
  docsDir?: string;
  model?: string;
  threshold?: number;
  exec?: ExecFn;
};

export function buildScenariosPrompt(skillContent: string, toolId: string): string {
  return `You are evaluating skill documentation quality for an AI agent. Given the following CLI skill documentation for "${toolId}", generate exactly ${NUM_SCENARIOS} test scenarios that would test whether an AI agent could effectively use this documentation.

Focus on the most common real-world tasks that the tool is used for.

Return ONLY valid JSON: an array of exactly ${NUM_SCENARIOS} objects, each with:
- "task": a short task description (e.g., "search for a pattern in Python files recursively")
- "hint": what a correct command should include or look like

Return ONLY valid JSON with no markdown fences.

## Documentation

${skillContent}`;
}

export function buildEvaluationPrompt(skillContent: string, task: string): string {
  return `You are an AI agent that has ONLY been given the following documentation. Do NOT use any prior knowledge about the tool beyond what is in this documentation.

## Documentation

${skillContent}

---

## Task

${task}

## Instructions

1. Using ONLY the above documentation, write the complete command to accomplish this task.
2. Evaluate your response on these 4 criteria:
   - completed: (true/false) Did the documentation give you enough information to complete the task?
   - correct: (true/false) Is the command you wrote syntactically correct based on the documentation?
   - hallucinated: (true/false) Did you use any flags or options NOT mentioned in the documentation?
   - missing: what information was missing or unclear (empty string if nothing was missing)
3. Give an overall score from 1-10 where 10 means "documentation was perfect for this task"

Return ONLY valid JSON with exactly these keys:
{
  "command": "<the command you would run>",
  "completed": true,
  "correct": true,
  "hallucinated": false,
  "missing": "",
  "score": 9,
  "reasoning": "<brief explanation of your score>"
}`;
}

export function buildGroundednessPrompt(skillContent: string, rawDocs: string): string {
  return `You are a documentation auditor checking whether a generated skill file is faithfully grounded in its source documentation.

## Raw Documentation (Source of Truth)

${rawDocs}

---

## Generated Skill File

${skillContent}

---

## Your Task

Compare the skill file against the raw documentation. Identify any specific commands, flags, options, or behaviors that appear in the skill file but are NOT present anywhere in the raw documentation above.

Focus on:
- Specific flags (e.g., "--foo", "-x") mentioned in the skill but absent from raw docs
- Subcommands or commands mentioned in the skill but absent from raw docs
- Specific behaviors, defaults, or option values described in the skill but not in raw docs

Do NOT flag:
- Minor wording differences or paraphrasing of documented behavior
- Structural differences (headers, ordering, formatting)
- Information that IS present in the raw docs, even if worded differently

Rate the groundedness on a scale from 1-10 where:
- 10 = fully grounded, every claim is directly supported by the raw docs
- 5 = some hallucinations present that could mislead an agent
- 1 = many hallucinations, skill is unreliable

Return ONLY valid JSON with no markdown fences:
{
  "score": <1-10>,
  "hallucinatedItems": ["<specific flag or command not in raw docs>", ...],
  "reasoning": "<brief explanation of your score>"
}`;
}

export function parseGroundednessResult(output: string): GroundednessResult {
  const stripped = stripFences(output);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(`Failed to parse groundedness result as JSON: ${stripped.slice(0, 200)}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Groundedness result is not a JSON object");
  }

  const obj = parsed as Record<string, unknown>;
  for (const key of ["score", "hallucinatedItems", "reasoning"]) {
    if (!(key in obj)) {
      throw new Error(`Groundedness result missing required key: ${key}`);
    }
  }

  if (!Array.isArray(obj.hallucinatedItems)) {
    throw new Error("Groundedness hallucinatedItems must be an array");
  }

  const score = typeof obj.score === "number" ? obj.score : Number(obj.score);
  if (isNaN(score) || score < 1 || score > 10) {
    throw new Error(`Groundedness score must be between 1 and 10, got: ${obj.score}`);
  }

  return {
    score,
    hallucinatedItems: (obj.hallucinatedItems as unknown[]).map(String),
    reasoning: String(obj.reasoning ?? ""),
  };
}

export function checkGroundedness(
  skillContent: string,
  rawDocs: string,
  model: string,
  exec: ExecFn = defaultExec
): GroundednessResult {
  const prompt = buildGroundednessPrompt(skillContent, rawDocs);
  const output = runLLM(prompt, model, exec);
  return parseGroundednessResult(output);
}

function runLLM(prompt: string, model: string, exec: ExecFn): string {
  if (exec === defaultExec) {
    return callSharedLLM(prompt, { model });
  }

  // Keep test-injected exec deterministic and independent of host PATH.
  const caller = createLLMCaller({
    exec,
    checkBinary: (name: string) => name === "claude",
  });
  return caller.callLLM(prompt, { model });
}

function stripFences(output: string): string {
  return output.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
}

export function parseScenarios(output: string): ValidationScenario[] {
  const stripped = stripFences(output);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(`Failed to parse scenarios as JSON: ${stripped.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Scenarios output is not a JSON array");
  }

  return parsed.map((item: unknown, i: number) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`Scenario ${i} is not an object`);
    }
    const obj = item as Record<string, unknown>;
    if (typeof obj.task !== "string") {
      throw new Error(`Scenario ${i} missing "task" string`);
    }
    if (typeof obj.hint !== "string") {
      throw new Error(`Scenario ${i} missing "hint" string`);
    }
    return { task: obj.task, hint: obj.hint };
  });
}

export function parseScorecard(task: string, output: string): ValidationScorecard {
  const stripped = stripFences(output);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(`Failed to parse scorecard as JSON: ${stripped.slice(0, 200)}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Scorecard output is not a JSON object");
  }

  const obj = parsed as Record<string, unknown>;
  for (const key of ["command", "completed", "correct", "hallucinated", "missing", "score", "reasoning"]) {
    if (!(key in obj)) {
      throw new Error(`Scorecard missing required key: ${key}`);
    }
  }

  const score = typeof obj.score === "number" ? obj.score : Number(obj.score);
  if (isNaN(score) || score < 1 || score > 10) {
    throw new Error(`Scorecard score must be between 1 and 10, got: ${obj.score}`);
  }

  return {
    task,
    command: String(obj.command),
    completed: Boolean(obj.completed),
    correct: Boolean(obj.correct),
    hallucinated: Boolean(obj.hallucinated),
    missing: String(obj.missing ?? ""),
    score,
    reasoning: String(obj.reasoning ?? ""),
  };
}

export function generateScenarios(
  skillContent: string,
  toolId: string,
  model: string,
  exec: ExecFn = defaultExec
): ValidationScenario[] {
  const prompt = buildScenariosPrompt(skillContent, toolId);
  const output = runLLM(prompt, model, exec);
  return parseScenarios(output);
}

export function evaluateScenario(
  skillContent: string,
  task: string,
  model: string,
  exec: ExecFn = defaultExec
): ValidationScorecard {
  const prompt = buildEvaluationPrompt(skillContent, task);
  const output = runLLM(prompt, model, exec);
  return parseScorecard(task, output);
}

export async function validateSkill(options: ValidateOptions): Promise<ValidationReport> {
  const {
    toolId,
    skillsDir = expandHome(DEFAULT_SKILLS_DIR),
    docsDir,
    model = DEFAULT_MODEL,
    threshold = DEFAULT_THRESHOLD,
    exec = defaultExec,
  } = options;

  const skillPath = path.join(skillsDir, toolId, "SKILL.md");
  if (!existsSync(skillPath)) {
    throw new Error(`No SKILL.md found for ${toolId} at ${skillPath}`);
  }

  const skillContent = await readFile(skillPath, "utf8");

  const scenarios = generateScenarios(skillContent, toolId, model, exec);

  const scorecards: ValidationScorecard[] = [];
  for (const scenario of scenarios) {
    const scorecard = evaluateScenario(skillContent, scenario.task, model, exec);
    scorecards.push(scorecard);
  }

  const averageScore = scorecards.reduce((sum, s) => sum + s.score, 0) / scorecards.length;

  let groundedness: GroundednessResult | undefined;
  if (docsDir) {
    const rawDocs = await gatherRawDocs(toolId, expandHome(docsDir));
    if (rawDocs) {
      groundedness = checkGroundedness(skillContent, rawDocs, model, exec);
    }
  }

  return {
    toolId,
    skillPath,
    model,
    scenarios: scorecards,
    averageScore,
    passed: averageScore >= threshold,
    threshold,
    generatedAt: new Date().toISOString(),
    ...(groundedness !== undefined ? { groundedness } : {}),
  };
}

export type MultiModelValidationReport = {
  toolId: string;
  skillPath: string;
  models: string[];
  reports: ValidationReport[];
  overallAverageScore: number;
  passed: boolean;
  threshold: number;
  generatedAt: string;
  groundedness?: GroundednessResult;
};

export type ValidateMultiModelOptions = {
  toolId: string;
  skillsDir?: string;
  docsDir?: string;
  models?: string[];
  threshold?: number;
  exec?: ExecFn;
};

export async function validateSkillMultiModel(options: ValidateMultiModelOptions): Promise<MultiModelValidationReport> {
  const {
    toolId,
    skillsDir = expandHome(DEFAULT_SKILLS_DIR),
    docsDir,
    models = DEFAULT_VALIDATION_MODELS,
    threshold = DEFAULT_THRESHOLD,
    exec = defaultExec,
  } = options;

  if (models.length === 0) {
    throw new Error("At least one model must be specified");
  }

  const skillPath = path.join(skillsDir, toolId, "SKILL.md");
  if (!existsSync(skillPath)) {
    throw new Error(`No SKILL.md found for ${toolId} at ${skillPath}`);
  }

  const skillContent = await readFile(skillPath, "utf8");

  // Generate scenarios once from the primary model
  const primaryModel = models[0];
  const scenarios = generateScenarios(skillContent, toolId, primaryModel, exec);

  const reports: ValidationReport[] = [];
  for (const model of models) {
    const scorecards: ValidationScorecard[] = [];
    let skipped = false;

    for (const scenario of scenarios) {
      try {
        const scorecard = evaluateScenario(skillContent, scenario.task, model, exec);
        scorecards.push(scorecard);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("ENOENT")) {
          skipped = true;
          break;
        }
        throw err;
      }
    }

    if (skipped) continue;

    const averageScore = scorecards.reduce((sum, s) => sum + s.score, 0) / scorecards.length;
    reports.push({
      toolId,
      skillPath,
      model,
      scenarios: scorecards,
      averageScore,
      passed: averageScore >= threshold,
      threshold,
      generatedAt: new Date().toISOString(),
    });
  }

  if (reports.length === 0) {
    throw new Error("No models were available to validate against");
  }

  const overallAverageScore = reports.reduce((sum, r) => sum + r.averageScore, 0) / reports.length;

  // Run groundedness check once using the primary model
  let groundedness: GroundednessResult | undefined;
  if (docsDir) {
    const rawDocs = await gatherRawDocs(toolId, expandHome(docsDir));
    if (rawDocs) {
      try {
        groundedness = checkGroundedness(skillContent, rawDocs, primaryModel, exec);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("ENOENT")) throw err;
        // Primary model unavailable — skip groundedness silently
      }
    }
  }

  return {
    toolId,
    skillPath,
    models: reports.map((r) => r.model),
    reports,
    overallAverageScore,
    passed: overallAverageScore >= threshold,
    threshold,
    generatedAt: new Date().toISOString(),
    ...(groundedness !== undefined ? { groundedness } : {}),
  };
}

export function formatMultiModelReport(report: MultiModelValidationReport): string {
  const lines: string[] = [];
  lines.push(`Multi-Model Validation: ${report.toolId}`);
  lines.push(`Models: ${report.models.join(", ")}`);
  lines.push(`Skill: ${report.skillPath}`);
  lines.push("");

  for (const modelReport of report.reports) {
    lines.push(`--- ${modelReport.model} ---`);
    for (let i = 0; i < modelReport.scenarios.length; i++) {
      const s = modelReport.scenarios[i];
      const issues: string[] = [];
      if (!s.completed) issues.push("incomplete");
      if (!s.correct) issues.push("incorrect");
      if (s.hallucinated) issues.push("hallucinated");
      const issueStr = issues.length > 0 ? ` [${issues.join(", ")}]` : "";
      lines.push(`  Scenario ${i + 1}: "${s.task}" → ${s.score}/10${issueStr}`);
      if (s.command) lines.push(`    Command: ${s.command}`);
      if (s.missing) lines.push(`    Missing: ${s.missing}`);
    }
    const modelStatus = modelReport.passed ? "PASS" : "FAIL";
    lines.push(`  Average: ${modelReport.averageScore.toFixed(1)}/10 — ${modelStatus}`);
    lines.push("");
  }

  const avgFormatted = report.overallAverageScore.toFixed(1);
  const status = report.passed ? "PASS" : "FAIL";
  lines.push(`Overall: ${avgFormatted}/10 — ${status} (threshold: ${report.threshold}/10)`);

  if (!report.passed) {
    const allMissing = report.reports
      .flatMap((r) => r.scenarios.map((s) => s.missing))
      .filter((m) => m.length > 0)
      .filter((m, i, arr) => arr.indexOf(m) === i);
    if (allMissing.length > 0) {
      lines.push(`Missing from skill: ${allMissing.join("; ")}`);
    }
  }

  if (report.groundedness !== undefined) {
    lines.push("");
    lines.push(`Groundedness: ${report.groundedness.score.toFixed(1)}/10`);
    if (report.groundedness.hallucinatedItems.length > 0) {
      lines.push(`  Hallucinated: ${report.groundedness.hallucinatedItems.join(", ")}`);
    }
  }

  return lines.join("\n");
}

export function buildValidationFeedback(report: MultiModelValidationReport): string {
  const allMissing = report.reports
    .flatMap((r) => r.scenarios.map((s) => s.missing))
    .filter((m) => m.length > 0)
    .filter((m, i, arr) => arr.indexOf(m) === i);

  const hallucinations = report.reports
    .flatMap((r) => r.scenarios.filter((s) => s.hallucinated).map((s) => s.task))
    .filter((t, i, arr) => arr.indexOf(t) === i);

  const lines: string[] = [];
  lines.push(
    `Validation failed for ${report.toolId} (average score: ${report.overallAverageScore.toFixed(1)}/10 across ${report.models.length} model(s)).`
  );

  if (allMissing.length > 0) {
    lines.push(`\nInformation missing from the skill that agents needed:`);
    for (const m of allMissing) lines.push(`- ${m}`);
  }

  if (hallucinations.length > 0) {
    lines.push(`\nTasks where models hallucinated non-existent flags or options:`);
    for (const h of hallucinations) lines.push(`- ${h}`);
  }

  lines.push(`\nPlease improve the skill to address these gaps.`);
  return lines.join("\n");
}

export function formatReport(report: ValidationReport): string {
  const lines: string[] = [];
  lines.push(`Validation Report: ${report.toolId}`);
  lines.push(`Model: ${report.model}`);
  lines.push(`Skill: ${report.skillPath}`);
  lines.push("");

  for (let i = 0; i < report.scenarios.length; i++) {
    const s = report.scenarios[i];
    const issues: string[] = [];
    if (!s.completed) issues.push("incomplete");
    if (!s.correct) issues.push("incorrect");
    if (s.hallucinated) issues.push("hallucinated");
    const issueStr = issues.length > 0 ? ` [${issues.join(", ")}]` : "";
    lines.push(`  Scenario ${i + 1}: "${s.task}" → ${s.score}/10${issueStr}`);
    if (s.command) lines.push(`    Command: ${s.command}`);
    if (s.missing) lines.push(`    Missing: ${s.missing}`);
  }

  lines.push("");
  const avgFormatted = report.averageScore.toFixed(1);
  const status = report.passed ? "PASS" : "FAIL";
  lines.push(`Average: ${avgFormatted}/10 — ${status} (threshold: ${report.threshold}/10)`);

  if (!report.passed) {
    const allMissing = report.scenarios
      .map((s) => s.missing)
      .filter((m) => m.length > 0)
      .filter((m, i, arr) => arr.indexOf(m) === i);
    if (allMissing.length > 0) {
      lines.push(`Missing from skill: ${allMissing.join("; ")}`);
    }
  }

  if (report.groundedness !== undefined) {
    lines.push("");
    lines.push(`Groundedness: ${report.groundedness.score.toFixed(1)}/10`);
    if (report.groundedness.hallucinatedItems.length > 0) {
      lines.push(`  Hallucinated: ${report.groundedness.hallucinatedItems.join(", ")}`);
    }
  }

  return lines.join("\n");
}

export const VALIDATION_REPORT_FILE = "validation-report.json";

export type QualityReportEntry = {
  toolId: string;
  overallAverageScore: number;
  models: string[];
  passed: boolean;
  threshold: number;
  generatedAt: string;
  groundednessScore?: number;
};

export type QualityReport = {
  entries: QualityReportEntry[];
  skillsDir: string;
  generatedAt: string;
};

export async function saveValidationReport(report: MultiModelValidationReport, skillsDir: string): Promise<string> {
  const reportPath = path.join(skillsDir, report.toolId, VALIDATION_REPORT_FILE);
  await writeFileEnsured(reportPath, JSON.stringify(report, null, 2));
  return reportPath;
}

export async function loadQualityReports(skillsDir: string): Promise<QualityReport> {
  let entries: QualityReportEntry[] = [];

  let toolDirs: string[] = [];
  try {
    const dirents = await readdir(skillsDir, { withFileTypes: true });
    toolDirs = dirents.filter((d: { isDirectory(): boolean; name: string }) => d.isDirectory()).map((d: { name: string }) => d.name);
  } catch {
    // skillsDir doesn't exist yet — return empty report
    return { entries: [], skillsDir, generatedAt: new Date().toISOString() };
  }

  for (const toolId of toolDirs) {
    const reportPath = path.join(skillsDir, toolId, VALIDATION_REPORT_FILE);
    if (!existsSync(reportPath)) continue;

    try {
      const raw = await readFile(reportPath, "utf8");
      const parsed = JSON.parse(raw) as MultiModelValidationReport;
      const entry: QualityReportEntry = {
        toolId: parsed.toolId,
        overallAverageScore: parsed.overallAverageScore,
        models: parsed.models,
        passed: parsed.passed,
        threshold: parsed.threshold,
        generatedAt: parsed.generatedAt,
      };
      if (parsed.groundedness !== undefined) {
        entry.groundednessScore = parsed.groundedness.score;
      }
      entries.push(entry);
    } catch {
      // skip malformed report files
    }
  }

  entries = entries.sort((a, b) => a.toolId.localeCompare(b.toolId));

  return { entries, skillsDir, generatedAt: new Date().toISOString() };
}

export function formatQualityReport(report: QualityReport): string {
  const lines: string[] = [];

  if (report.entries.length === 0) {
    lines.push("No validation reports found.");
    lines.push(`Run 'skilldoc validate <tool-id>' to generate reports.`);
    return lines.join("\n");
  }

  const passing = report.entries.filter((e) => e.passed).length;
  const failing = report.entries.length - passing;
  lines.push(`Quality Report — ${report.entries.length} tool(s)`);
  lines.push("");

  const colTool = Math.max(4, ...report.entries.map((e) => e.toolId.length));
  const hasGroundedness = report.entries.some((e) => e.groundednessScore !== undefined);
  const header = hasGroundedness
    ? `${"Tool".padEnd(colTool)}  ${"Score".padStart(6)}  ${"Ground".padStart(7)}  ${"Status"}`
    : `${"Tool".padEnd(colTool)}  ${"Score".padStart(6)}  ${"Status"}`;
  lines.push(header);
  lines.push("-".repeat(header.length));

  for (const entry of report.entries) {
    const score = `${entry.overallAverageScore.toFixed(1)}/10`.padStart(6);
    const status = entry.passed ? "PASS" : "FAIL";
    if (hasGroundedness) {
      const ground =
        entry.groundednessScore !== undefined
          ? `${entry.groundednessScore.toFixed(1)}/10`.padStart(7)
          : "    N/A";
      lines.push(`${entry.toolId.padEnd(colTool)}  ${score}  ${ground}  ${status}`);
    } else {
      lines.push(`${entry.toolId.padEnd(colTool)}  ${score}  ${status}`);
    }
  }

  lines.push("-".repeat(header.length));
  const overallAvg =
    report.entries.reduce((sum, e) => sum + e.overallAverageScore, 0) / report.entries.length;
  const summaryScore = `${overallAvg.toFixed(1)}/10`.padStart(6);
  if (hasGroundedness) {
    const groundEntries = report.entries.filter((e) => e.groundednessScore !== undefined);
    const avgGround = groundEntries.reduce((sum, e) => sum + e.groundednessScore!, 0) / groundEntries.length;
    const groundSummary = `${avgGround.toFixed(1)}/10`.padStart(7);
    lines.push(`${"Total".padEnd(colTool)}  ${summaryScore}  ${groundSummary}  ${passing}/${report.entries.length} PASS`);
  } else {
    lines.push(`${"Total".padEnd(colTool)}  ${summaryScore}  ${passing}/${report.entries.length} PASS`);
  }

  if (failing > 0) {
    lines.push("");
    lines.push(`${failing} tool(s) below threshold — run 'skilldoc validate <tool-id> --auto-redist' to improve.`);
  }

  return lines.join("\n");
}
