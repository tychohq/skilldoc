import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { expandHome } from "./utils.js";
import { DEFAULT_SKILLS_DIR, DEFAULT_MODEL } from "./distill.js";

export const DEFAULT_THRESHOLD = 9;
export const DEFAULT_VALIDATION_MODELS = ["claude-sonnet-4-6", "claude-opus-4-6"];
const NUM_SCENARIOS = 4;

export type ExecFn = (
  command: string,
  args: ReadonlyArray<string>,
  options: { input: string; encoding: "utf8"; maxBuffer: number }
) => { error?: Error; stdout: string | null; stderr: string | null; status: number | null };

const defaultExec: ExecFn = (command, args, options) =>
  spawnSync(command, [...args], options) as ReturnType<typeof spawnSync>;

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
};

export type ValidateOptions = {
  toolId: string;
  skillsDir?: string;
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

function getModelCommand(model: string): { command: string; args: string[] } {
  if (model === "gemini" || model.startsWith("gemini-")) {
    return { command: "gemini", args: ["-p"] };
  }
  return {
    command: "claude",
    args: ["-p", "--output-format", "text", "--model", model, "--no-session-persistence"],
  };
}

function callLLM(prompt: string, model: string, exec: ExecFn): string {
  const { command, args } = getModelCommand(model);
  const result = exec(command, args, { input: prompt, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });

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
  const output = callLLM(prompt, model, exec);
  return parseScenarios(output);
}

export function evaluateScenario(
  skillContent: string,
  task: string,
  model: string,
  exec: ExecFn = defaultExec
): ValidationScorecard {
  const prompt = buildEvaluationPrompt(skillContent, task);
  const output = callLLM(prompt, model, exec);
  return parseScorecard(task, output);
}

export async function validateSkill(options: ValidateOptions): Promise<ValidationReport> {
  const {
    toolId,
    skillsDir = expandHome(DEFAULT_SKILLS_DIR),
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

  return {
    toolId,
    skillPath,
    model,
    scenarios: scorecards,
    averageScore,
    passed: averageScore >= threshold,
    threshold,
    generatedAt: new Date().toISOString(),
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
};

export type ValidateMultiModelOptions = {
  toolId: string;
  skillsDir?: string;
  models?: string[];
  threshold?: number;
  exec?: ExecFn;
};

export async function validateSkillMultiModel(options: ValidateMultiModelOptions): Promise<MultiModelValidationReport> {
  const {
    toolId,
    skillsDir = expandHome(DEFAULT_SKILLS_DIR),
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

  return {
    toolId,
    skillPath,
    models: reports.map((r) => r.model),
    reports,
    overallAverageScore,
    passed: overallAverageScore >= threshold,
    threshold,
    generatedAt: new Date().toISOString(),
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

  return lines.join("\n");
}
