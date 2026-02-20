import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import path from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import {
  parseScenarios,
  parseScorecard,
  generateScenarios,
  evaluateScenario,
  validateSkill,
  validateSkillMultiModel,
  formatReport,
  formatMultiModelReport,
  buildValidationFeedback,
  buildScenariosPrompt,
  buildEvaluationPrompt,
  DEFAULT_THRESHOLD,
  DEFAULT_VALIDATION_MODELS,
  ExecFn,
  ValidationReport,
  MultiModelValidationReport,
} from "../src/validate.js";

const validScenariosJson = JSON.stringify([
  { task: "search for a pattern in Python files", hint: "rg pattern --type py" },
  { task: "search case-insensitively", hint: "rg -i pattern" },
  { task: "show line numbers", hint: "rg -n pattern" },
  { task: "exclude a directory", hint: "rg --glob '!vendor/*' pattern" },
]);

const validScorecardJson = JSON.stringify({
  command: "rg -i pattern",
  completed: true,
  correct: true,
  hallucinated: false,
  missing: "",
  score: 9,
  reasoning: "Documentation clearly covers case-insensitive search",
});

const mockScenariosOk: ExecFn = () => ({
  stdout: validScenariosJson,
  stderr: "",
  status: 0,
});

const mockScorecardOk: ExecFn = () => ({
  stdout: validScorecardJson,
  stderr: "",
  status: 0,
});

describe("DEFAULT_THRESHOLD", () => {
  it("is 9", () => {
    expect(DEFAULT_THRESHOLD).toBe(9);
  });
});

describe("parseScenarios", () => {
  it("parses a valid scenarios array", () => {
    const result = parseScenarios(validScenariosJson);
    expect(result).toHaveLength(4);
    expect(result[0].task).toBe("search for a pattern in Python files");
    expect(result[0].hint).toBe("rg pattern --type py");
  });

  it("strips markdown fences before parsing", () => {
    const fenced = `\`\`\`json\n${validScenariosJson}\n\`\`\``;
    const result = parseScenarios(fenced);
    expect(result).toHaveLength(4);
  });

  it("strips plain fences before parsing", () => {
    const fenced = `\`\`\`\n${validScenariosJson}\n\`\`\``;
    const result = parseScenarios(fenced);
    expect(result).toHaveLength(4);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseScenarios("not json")).toThrow("Failed to parse scenarios as JSON");
  });

  it("throws when output is not an array", () => {
    expect(() => parseScenarios(JSON.stringify({ task: "thing", hint: "cmd" }))).toThrow(
      "Scenarios output is not a JSON array"
    );
  });

  it("throws when a scenario item is not an object", () => {
    expect(() => parseScenarios(JSON.stringify(["string item"]))).toThrow("Scenario 0 is not an object");
  });

  it("throws when task field is missing", () => {
    expect(() => parseScenarios(JSON.stringify([{ hint: "cmd" }]))).toThrow('Scenario 0 missing "task" string');
  });

  it("throws when hint field is missing", () => {
    expect(() => parseScenarios(JSON.stringify([{ task: "do something" }]))).toThrow(
      'Scenario 0 missing "hint" string'
    );
  });

  it("returns an empty array for an empty array input", () => {
    const result = parseScenarios("[]");
    expect(result).toHaveLength(0);
  });
});

describe("parseScorecard", () => {
  it("parses a valid scorecard", () => {
    const result = parseScorecard("search case-insensitively", validScorecardJson);
    expect(result.task).toBe("search case-insensitively");
    expect(result.command).toBe("rg -i pattern");
    expect(result.completed).toBe(true);
    expect(result.correct).toBe(true);
    expect(result.hallucinated).toBe(false);
    expect(result.missing).toBe("");
    expect(result.score).toBe(9);
    expect(result.reasoning).toContain("case-insensitive");
  });

  it("strips markdown fences before parsing", () => {
    const fenced = `\`\`\`json\n${validScorecardJson}\n\`\`\``;
    const result = parseScorecard("task", fenced);
    expect(result.score).toBe(9);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseScorecard("task", "bad json")).toThrow("Failed to parse scorecard as JSON");
  });

  it("throws when output is not an object", () => {
    expect(() => parseScorecard("task", '"just a string"')).toThrow(
      "Scorecard output is not a JSON object"
    );
  });

  it("throws when output is null", () => {
    expect(() => parseScorecard("task", "null")).toThrow("Scorecard output is not a JSON object");
  });

  it("throws when required key command is missing", () => {
    const noCmd = JSON.stringify({
      completed: true,
      correct: true,
      hallucinated: false,
      missing: "",
      score: 9,
      reasoning: "ok",
    });
    expect(() => parseScorecard("task", noCmd)).toThrow("Scorecard missing required key: command");
  });

  it("throws when required key score is missing", () => {
    const noScore = JSON.stringify({
      command: "rg pattern",
      completed: true,
      correct: true,
      hallucinated: false,
      missing: "",
      reasoning: "ok",
    });
    expect(() => parseScorecard("task", noScore)).toThrow("Scorecard missing required key: score");
  });

  it("throws when score is out of range", () => {
    const badScore = JSON.stringify({
      command: "rg pattern",
      completed: true,
      correct: true,
      hallucinated: false,
      missing: "",
      score: 11,
      reasoning: "ok",
    });
    expect(() => parseScorecard("task", badScore)).toThrow("Scorecard score must be between 1 and 10");
  });

  it("throws when score is below 1", () => {
    const badScore = JSON.stringify({
      command: "rg pattern",
      completed: true,
      correct: true,
      hallucinated: false,
      missing: "",
      score: 0,
      reasoning: "ok",
    });
    expect(() => parseScorecard("task", badScore)).toThrow("Scorecard score must be between 1 and 10");
  });

  it("accepts a numeric string score", () => {
    const strScore = JSON.stringify({
      command: "rg pattern",
      completed: true,
      correct: true,
      hallucinated: false,
      missing: "",
      score: "8",
      reasoning: "ok",
    });
    const result = parseScorecard("task", strScore);
    expect(result.score).toBe(8);
  });
});

describe("buildScenariosPrompt", () => {
  it("includes the toolId in the prompt", () => {
    const prompt = buildScenariosPrompt("# rg\n\nFast search", "rg");
    expect(prompt).toContain("rg");
  });

  it("includes the skill content in the prompt", () => {
    const prompt = buildScenariosPrompt("# mytool\n\nDoes things", "mytool");
    expect(prompt).toContain("# mytool");
    expect(prompt).toContain("Does things");
  });

  it("instructs to return JSON array", () => {
    const prompt = buildScenariosPrompt("content", "tool");
    expect(prompt).toContain("JSON");
    expect(prompt).toContain("task");
    expect(prompt).toContain("hint");
  });

  it("instructs to return no markdown fences", () => {
    const prompt = buildScenariosPrompt("content", "tool");
    expect(prompt).toContain("no markdown fences");
  });
});

describe("buildEvaluationPrompt", () => {
  it("includes the skill content in the prompt", () => {
    const prompt = buildEvaluationPrompt("# rg\n\nFast search tool", "search Python files");
    expect(prompt).toContain("# rg");
    expect(prompt).toContain("Fast search tool");
  });

  it("includes the task in the prompt", () => {
    const prompt = buildEvaluationPrompt("# rg\n\nDocs", "search for pattern in Python files recursively");
    expect(prompt).toContain("search for pattern in Python files recursively");
  });

  it("instructs to use ONLY the documentation", () => {
    const prompt = buildEvaluationPrompt("docs", "task");
    expect(prompt).toContain("ONLY");
    expect(prompt).toContain("documentation");
  });

  it("instructs to score 1-10", () => {
    const prompt = buildEvaluationPrompt("docs", "task");
    expect(prompt).toContain("1-10");
  });

  it("asks for command, completed, correct, hallucinated, missing, score, reasoning", () => {
    const prompt = buildEvaluationPrompt("docs", "task");
    expect(prompt).toContain('"command"');
    expect(prompt).toContain('"completed"');
    expect(prompt).toContain('"correct"');
    expect(prompt).toContain('"hallucinated"');
    expect(prompt).toContain('"missing"');
    expect(prompt).toContain('"score"');
    expect(prompt).toContain('"reasoning"');
  });

  it("instructs to return valid JSON without markdown fences", () => {
    const prompt = buildEvaluationPrompt("docs", "task");
    expect(prompt).toContain("ONLY valid JSON");
  });
});

describe("generateScenarios", () => {
  it("returns parsed scenarios on success", () => {
    const result = generateScenarios("# rg\n\nFast search", "rg", "model", mockScenariosOk);
    expect(result).toHaveLength(4);
    expect(result[0].task).toBe("search for a pattern in Python files");
  });

  it("passes the skill content and toolId in the prompt", () => {
    let capturedInput = "";
    const exec: ExecFn = (_cmd, _args, opts) => {
      capturedInput = opts.input;
      return { stdout: validScenariosJson, stderr: "", status: 0 };
    };
    generateScenarios("# rg\n\nSpecial docs content", "rg", "model", exec);
    expect(capturedInput).toContain("# rg");
    expect(capturedInput).toContain("Special docs content");
    expect(capturedInput).toContain("rg");
  });

  it("passes the model to claude args", () => {
    let capturedArgs: ReadonlyArray<string> = [];
    const exec: ExecFn = (_cmd, args) => {
      capturedArgs = args;
      return { stdout: validScenariosJson, stderr: "", status: 0 };
    };
    generateScenarios("docs", "tool", "my-model", exec);
    expect(capturedArgs).toContain("--model");
    expect(capturedArgs).toContain("my-model");
  });

  it("throws when claude binary fails", () => {
    const exec: ExecFn = () => ({ error: new Error("spawn ENOENT"), stdout: null, stderr: null, status: null });
    expect(() => generateScenarios("docs", "tool", "model", exec)).toThrow("Failed to run claude");
  });

  it("throws when claude exits non-zero", () => {
    const exec: ExecFn = () => ({ stdout: "", stderr: "rate limit", status: 1 });
    expect(() => generateScenarios("docs", "tool", "model", exec)).toThrow("claude exited with code 1");
    expect(() => generateScenarios("docs", "tool", "model", exec)).toThrow("rate limit");
  });

  it("throws when claude returns empty output", () => {
    const exec: ExecFn = () => ({ stdout: "  ", stderr: "", status: 0 });
    expect(() => generateScenarios("docs", "tool", "model", exec)).toThrow("claude returned empty output");
  });
});

describe("evaluateScenario", () => {
  it("returns a parsed scorecard on success", () => {
    const result = evaluateScenario("# rg\n\nDocs", "search case-insensitively", "model", mockScorecardOk);
    expect(result.task).toBe("search case-insensitively");
    expect(result.score).toBe(9);
    expect(result.command).toBe("rg -i pattern");
  });

  it("passes the skill content and task in the prompt", () => {
    let capturedInput = "";
    const exec: ExecFn = (_cmd, _args, opts) => {
      capturedInput = opts.input;
      return { stdout: validScorecardJson, stderr: "", status: 0 };
    };
    evaluateScenario("# rg\n\nThe docs", "find all TODOs", "model", exec);
    expect(capturedInput).toContain("# rg");
    expect(capturedInput).toContain("The docs");
    expect(capturedInput).toContain("find all TODOs");
  });

  it("passes the model to claude args", () => {
    let capturedArgs: ReadonlyArray<string> = [];
    const exec: ExecFn = (_cmd, args) => {
      capturedArgs = args;
      return { stdout: validScorecardJson, stderr: "", status: 0 };
    };
    evaluateScenario("docs", "task", "my-test-model", exec);
    expect(capturedArgs).toContain("--model");
    expect(capturedArgs).toContain("my-test-model");
  });

  it("uses -p and --output-format text flags", () => {
    let capturedArgs: ReadonlyArray<string> = [];
    const exec: ExecFn = (_cmd, args) => {
      capturedArgs = args;
      return { stdout: validScorecardJson, stderr: "", status: 0 };
    };
    evaluateScenario("docs", "task", "model", exec);
    expect(capturedArgs).toContain("-p");
    expect(capturedArgs).toContain("--output-format");
    expect(capturedArgs).toContain("text");
  });

  it("throws when claude binary fails", () => {
    const exec: ExecFn = () => ({ error: new Error("ENOENT"), stdout: null, stderr: null, status: null });
    expect(() => evaluateScenario("docs", "task", "model", exec)).toThrow("Failed to run claude");
  });

  it("throws when claude exits non-zero", () => {
    const exec: ExecFn = () => ({ stdout: "", stderr: "timeout", status: 2 });
    expect(() => evaluateScenario("docs", "task", "model", exec)).toThrow("claude exited with code 2");
  });
});

describe("validateSkill", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `validate-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSkill(toolId: string, content: string): string {
    const skillDir = path.join(tmpDir, "skills", toolId);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), content);
    return path.join(tmpDir, "skills");
  }

  // Each exec call alternates between scenarios and scorecard responses
  function makeMockExec(scorecards: string[] = []): ExecFn {
    let calls = 0;
    return () => {
      calls += 1;
      if (calls === 1) {
        return { stdout: validScenariosJson, stderr: "", status: 0 };
      }
      const idx = calls - 2;
      const json = scorecards[idx] ?? validScorecardJson;
      return { stdout: json, stderr: "", status: 0 };
    };
  }

  it("throws when SKILL.md does not exist", async () => {
    await expect(
      validateSkill({ toolId: "notool", skillsDir: path.join(tmpDir, "skills"), exec: makeMockExec() })
    ).rejects.toThrow("No SKILL.md found for notool");
  });

  it("returns a report with the toolId and skillPath", async () => {
    const skillsDir = writeSkill("mytool", "# mytool\n\nDoes stuff");
    const report = await validateSkill({ toolId: "mytool", skillsDir, exec: makeMockExec() });
    expect(report.toolId).toBe("mytool");
    expect(report.skillPath).toContain("mytool");
    expect(report.skillPath).toContain("SKILL.md");
  });

  it("returns a report with generatedAt timestamp", async () => {
    const skillsDir = writeSkill("mytool", "# mytool");
    const report = await validateSkill({ toolId: "mytool", skillsDir, exec: makeMockExec() });
    expect(report.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns scenarios equal to the number generated", async () => {
    const skillsDir = writeSkill("mytool", "# mytool");
    const report = await validateSkill({ toolId: "mytool", skillsDir, exec: makeMockExec() });
    expect(report.scenarios).toHaveLength(4); // validScenariosJson has 4
  });

  it("calculates averageScore correctly", async () => {
    const scorecard8 = JSON.stringify({ ...JSON.parse(validScorecardJson), score: 8 });
    const scorecard6 = JSON.stringify({ ...JSON.parse(validScorecardJson), score: 6 });
    const scorecard9 = JSON.stringify({ ...JSON.parse(validScorecardJson), score: 9 });
    const scorecard7 = JSON.stringify({ ...JSON.parse(validScorecardJson), score: 7 });
    const skillsDir = writeSkill("mytool", "# mytool");
    const report = await validateSkill({
      toolId: "mytool",
      skillsDir,
      exec: makeMockExec([scorecard8, scorecard6, scorecard9, scorecard7]),
    });
    expect(report.averageScore).toBeCloseTo((8 + 6 + 9 + 7) / 4);
  });

  it("passed is true when averageScore >= threshold", async () => {
    const scorecard9 = JSON.stringify({ ...JSON.parse(validScorecardJson), score: 9 });
    const skillsDir = writeSkill("mytool", "# mytool");
    const report = await validateSkill({
      toolId: "mytool",
      skillsDir,
      threshold: 9,
      exec: makeMockExec([scorecard9, scorecard9, scorecard9, scorecard9]),
    });
    expect(report.passed).toBe(true);
  });

  it("passed is false when averageScore < threshold", async () => {
    const scorecard5 = JSON.stringify({ ...JSON.parse(validScorecardJson), score: 5 });
    const skillsDir = writeSkill("mytool", "# mytool");
    const report = await validateSkill({
      toolId: "mytool",
      skillsDir,
      threshold: 9,
      exec: makeMockExec([scorecard5, scorecard5, scorecard5, scorecard5]),
    });
    expect(report.passed).toBe(false);
  });

  it("uses the specified model", async () => {
    const capturedModels: string[] = [];
    const exec: ExecFn = (_cmd, args) => {
      const modelIdx = [...args].indexOf("--model");
      if (modelIdx !== -1) capturedModels.push(args[modelIdx + 1] as string);
      const calls = capturedModels.length;
      return { stdout: calls === 1 ? validScenariosJson : validScorecardJson, stderr: "", status: 0 };
    };
    const skillsDir = writeSkill("mytool", "# mytool");
    await validateSkill({ toolId: "mytool", skillsDir, model: "claude-opus-4-6", exec });
    expect(capturedModels.every((m) => m === "claude-opus-4-6")).toBe(true);
  });

  it("uses the specified threshold", async () => {
    const scorecard7 = JSON.stringify({ ...JSON.parse(validScorecardJson), score: 7 });
    const skillsDir = writeSkill("mytool", "# mytool");
    const report = await validateSkill({
      toolId: "mytool",
      skillsDir,
      threshold: 7,
      exec: makeMockExec([scorecard7, scorecard7, scorecard7, scorecard7]),
    });
    expect(report.threshold).toBe(7);
    expect(report.passed).toBe(true);
  });

  it("passes the SKILL.md content to generateScenarios", async () => {
    let capturedInput = "";
    let callCount = 0;
    const trackingExec: ExecFn = (_cmd, _args, opts) => {
      callCount += 1;
      if (callCount === 1) capturedInput = opts.input;
      return { stdout: callCount === 1 ? validScenariosJson : validScorecardJson, stderr: "", status: 0 };
    };
    const skillsDir = writeSkill("mytool", "# mytool\n\nSpecial documentation content");
    await validateSkill({ toolId: "mytool", skillsDir, exec: trackingExec });
    expect(capturedInput).toContain("# mytool");
    expect(capturedInput).toContain("Special documentation content");
  });
});

describe("formatReport", () => {
  const baseReport: ValidationReport = {
    toolId: "rg",
    skillPath: "/home/.agents/skills/rg/SKILL.md",
    model: "claude-haiku-4-5-20251001",
    scenarios: [
      {
        task: "search Python files",
        command: "rg pattern --type py",
        completed: true,
        correct: true,
        hallucinated: false,
        missing: "",
        score: 9,
        reasoning: "Docs were clear",
      },
      {
        task: "search case-insensitively",
        command: "rg -i pattern",
        completed: true,
        correct: true,
        hallucinated: false,
        missing: "",
        score: 8,
        reasoning: "Good docs",
      },
    ],
    averageScore: 8.5,
    passed: true,
    threshold: 8,
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("includes the toolId in output", () => {
    expect(formatReport(baseReport)).toContain("rg");
  });

  it("includes the model in output", () => {
    expect(formatReport(baseReport)).toContain("claude-haiku-4-5-20251001");
  });

  it("includes the skillPath in output", () => {
    expect(formatReport(baseReport)).toContain("/home/.agents/skills/rg/SKILL.md");
  });

  it("shows each scenario with its score", () => {
    const output = formatReport(baseReport);
    expect(output).toContain("search Python files");
    expect(output).toContain("9/10");
    expect(output).toContain("search case-insensitively");
    expect(output).toContain("8/10");
  });

  it("shows PASS when passed is true", () => {
    expect(formatReport(baseReport)).toContain("PASS");
  });

  it("shows FAIL when passed is false", () => {
    const failReport: ValidationReport = { ...baseReport, passed: false, averageScore: 6.0 };
    expect(formatReport(failReport)).toContain("FAIL");
  });

  it("shows average score", () => {
    expect(formatReport(baseReport)).toContain("8.5/10");
  });

  it("shows threshold in output", () => {
    expect(formatReport(baseReport)).toContain("threshold: 8/10");
  });

  it("shows [hallucinated] tag when a scenario hallucinated", () => {
    const report: ValidationReport = {
      ...baseReport,
      scenarios: [{ ...baseReport.scenarios[0], hallucinated: true }],
    };
    expect(formatReport(report)).toContain("hallucinated");
  });

  it("shows [incomplete] tag when a scenario was not completed", () => {
    const report: ValidationReport = {
      ...baseReport,
      scenarios: [{ ...baseReport.scenarios[0], completed: false }],
    };
    expect(formatReport(report)).toContain("incomplete");
  });

  it("shows [incorrect] tag when a scenario command was incorrect", () => {
    const report: ValidationReport = {
      ...baseReport,
      scenarios: [{ ...baseReport.scenarios[0], correct: false }],
    };
    expect(formatReport(report)).toContain("incorrect");
  });

  it("shows missing info for failed scenarios when report fails", () => {
    const failReport: ValidationReport = {
      ...baseReport,
      passed: false,
      averageScore: 5.0,
      scenarios: [{ ...baseReport.scenarios[0], missing: "the -v flag for invert match" }],
    };
    const output = formatReport(failReport);
    expect(output).toContain("the -v flag for invert match");
  });

  it("does not show missing section when report passes", () => {
    const passReport: ValidationReport = {
      ...baseReport,
      passed: true,
      scenarios: [{ ...baseReport.scenarios[0], missing: "something minor" }],
    };
    const output = formatReport(passReport);
    // Missing section only appears on failure
    expect(output).not.toContain("Missing from skill:");
  });

  it("shows the command for each scenario", () => {
    const output = formatReport(baseReport);
    expect(output).toContain("rg pattern --type py");
  });
});

describe("DEFAULT_VALIDATION_MODELS", () => {
  it("includes claude-sonnet-4-6 and claude-opus-4-6", () => {
    expect(DEFAULT_VALIDATION_MODELS).toContain("claude-sonnet-4-6");
    expect(DEFAULT_VALIDATION_MODELS).toContain("claude-opus-4-6");
  });

  it("has at least 2 models", () => {
    expect(DEFAULT_VALIDATION_MODELS.length).toBeGreaterThanOrEqual(2);
  });
});

describe("validateSkillMultiModel", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `validate-multi-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSkill(toolId: string, content: string): string {
    const skillDir = path.join(tmpDir, "skills", toolId);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(path.join(skillDir, "SKILL.md"), content);
    return path.join(tmpDir, "skills");
  }

  // Exec that returns scenarios on call 1, scorecards on subsequent calls
  // For N models with 4 scenarios each: call 1 = scenarios, calls 2..N*4+1 = scorecards
  function makeMultiModelExec(scoresByModel: Record<string, number>): ExecFn {
    let calls = 0;
    return (_cmd, args) => {
      calls += 1;
      if (calls === 1) {
        return { stdout: validScenariosJson, stderr: "", status: 0 };
      }
      // Figure out which model is being called from args
      const modelIdx = [...args].indexOf("--model");
      const model = modelIdx !== -1 ? (args[modelIdx + 1] as string) : "default";
      const score = scoresByModel[model] ?? 9;
      const scorecard = JSON.stringify({ ...JSON.parse(validScorecardJson), score });
      return { stdout: scorecard, stderr: "", status: 0 };
    };
  }

  it("throws when SKILL.md does not exist", async () => {
    await expect(
      validateSkillMultiModel({
        toolId: "notool",
        skillsDir: path.join(tmpDir, "skills"),
        models: ["model-a"],
        exec: makeMultiModelExec({}),
      })
    ).rejects.toThrow("No SKILL.md found for notool");
  });

  it("throws when no models are specified", async () => {
    const skillsDir = writeSkill("mytool", "# mytool");
    await expect(
      validateSkillMultiModel({ toolId: "mytool", skillsDir, models: [], exec: makeMultiModelExec({}) })
    ).rejects.toThrow("At least one model must be specified");
  });

  it("returns one ValidationReport per model", async () => {
    const skillsDir = writeSkill("mytool", "# mytool");
    const exec = makeMultiModelExec({ "model-a": 8, "model-b": 9 });
    const report = await validateSkillMultiModel({
      toolId: "mytool",
      skillsDir,
      models: ["model-a", "model-b"],
      exec,
    });
    expect(report.reports).toHaveLength(2);
    expect(report.models).toEqual(["model-a", "model-b"]);
  });

  it("generates scenarios using the primary (first) model only once", async () => {
    const skillsDir = writeSkill("mytool", "# mytool");
    const scenarioCallModels: string[] = [];
    let firstCall = true;
    const exec: ExecFn = (_cmd, args) => {
      const modelIdx = [...args].indexOf("--model");
      const model = modelIdx !== -1 ? (args[modelIdx + 1] as string) : "";
      if (firstCall) {
        scenarioCallModels.push(model);
        firstCall = false;
        return { stdout: validScenariosJson, stderr: "", status: 0 };
      }
      return { stdout: validScorecardJson, stderr: "", status: 0 };
    };
    await validateSkillMultiModel({ toolId: "mytool", skillsDir, models: ["primary", "secondary"], exec });
    expect(scenarioCallModels).toHaveLength(1);
    expect(scenarioCallModels[0]).toBe("primary");
  });

  it("calculates overallAverageScore across all models", async () => {
    const skillsDir = writeSkill("mytool", "# mytool");
    const exec = makeMultiModelExec({ "model-a": 6, "model-b": 10 });
    const report = await validateSkillMultiModel({
      toolId: "mytool",
      skillsDir,
      models: ["model-a", "model-b"],
      exec,
    });
    expect(report.overallAverageScore).toBeCloseTo((6 + 10) / 2);
  });

  it("passed is true when overallAverageScore >= threshold", async () => {
    const skillsDir = writeSkill("mytool", "# mytool");
    const exec = makeMultiModelExec({ "model-a": 9, "model-b": 9 });
    const report = await validateSkillMultiModel({
      toolId: "mytool",
      skillsDir,
      models: ["model-a", "model-b"],
      threshold: 9,
      exec,
    });
    expect(report.passed).toBe(true);
  });

  it("passed is false when overallAverageScore < threshold", async () => {
    const skillsDir = writeSkill("mytool", "# mytool");
    const exec = makeMultiModelExec({ "model-a": 5, "model-b": 7 });
    const report = await validateSkillMultiModel({
      toolId: "mytool",
      skillsDir,
      models: ["model-a", "model-b"],
      threshold: 9,
      exec,
    });
    expect(report.passed).toBe(false);
  });

  it("skips models that fail with ENOENT and continues with the rest", async () => {
    const skillsDir = writeSkill("mytool", "# mytool");
    let calls = 0;
    const exec: ExecFn = (_cmd, args) => {
      calls += 1;
      if (calls === 1) return { stdout: validScenariosJson, stderr: "", status: 0 };
      const modelIdx = [...args].indexOf("--model");
      const model = modelIdx !== -1 ? (args[modelIdx + 1] as string) : "";
      if (model === "unavailable-model") {
        return { error: new Error("spawn ENOENT"), stdout: null, stderr: null, status: null };
      }
      return { stdout: validScorecardJson, stderr: "", status: 0 };
    };
    const report = await validateSkillMultiModel({
      toolId: "mytool",
      skillsDir,
      models: ["model-a", "unavailable-model"],
      exec,
    });
    expect(report.models).toEqual(["model-a"]);
    expect(report.reports).toHaveLength(1);
  });

  it("throws when all models are unavailable", async () => {
    const skillsDir = writeSkill("mytool", "# mytool");
    // First call (scenarios) succeeds, but all eval calls fail with ENOENT
    let calls = 0;
    const failExec: ExecFn = () => {
      calls += 1;
      if (calls === 1) return { stdout: validScenariosJson, stderr: "", status: 0 };
      return { error: new Error("spawn ENOENT"), stdout: null, stderr: null, status: null };
    };
    await expect(
      validateSkillMultiModel({ toolId: "mytool", skillsDir, models: ["gone-model"], exec: failExec })
    ).rejects.toThrow("No models were available");
  });

  it("returns toolId and skillPath in the report", async () => {
    const skillsDir = writeSkill("mytool", "# mytool");
    const exec = makeMultiModelExec({ "model-a": 9 });
    const report = await validateSkillMultiModel({
      toolId: "mytool",
      skillsDir,
      models: ["model-a"],
      exec,
    });
    expect(report.toolId).toBe("mytool");
    expect(report.skillPath).toContain("mytool");
    expect(report.skillPath).toContain("SKILL.md");
  });

  it("uses DEFAULT_VALIDATION_MODELS when no models option is given", async () => {
    const skillsDir = writeSkill("mytool", "# mytool");
    const capturedModels: string[] = [];
    let calls = 0;
    const exec: ExecFn = (_cmd, args) => {
      calls += 1;
      if (calls === 1) return { stdout: validScenariosJson, stderr: "", status: 0 };
      const modelIdx = [...args].indexOf("--model");
      if (modelIdx !== -1) capturedModels.push(args[modelIdx + 1] as string);
      return { stdout: validScorecardJson, stderr: "", status: 0 };
    };
    await validateSkillMultiModel({ toolId: "mytool", skillsDir, exec });
    // Each default model should appear in captured models
    for (const m of DEFAULT_VALIDATION_MODELS) {
      expect(capturedModels).toContain(m);
    }
  });
});

describe("formatMultiModelReport", () => {
  const baseMultiReport: MultiModelValidationReport = {
    toolId: "rg",
    skillPath: "/home/.agents/skills/rg/SKILL.md",
    models: ["claude-sonnet-4-6", "claude-opus-4-6"],
    reports: [
      {
        toolId: "rg",
        skillPath: "/home/.agents/skills/rg/SKILL.md",
        model: "claude-sonnet-4-6",
        scenarios: [
          {
            task: "search Python files",
            command: "rg pattern --type py",
            completed: true,
            correct: true,
            hallucinated: false,
            missing: "",
            score: 9,
            reasoning: "Clear docs",
          },
        ],
        averageScore: 9,
        passed: true,
        threshold: 9,
        generatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        toolId: "rg",
        skillPath: "/home/.agents/skills/rg/SKILL.md",
        model: "claude-opus-4-6",
        scenarios: [
          {
            task: "search Python files",
            command: "rg pattern --type py",
            completed: true,
            correct: true,
            hallucinated: false,
            missing: "",
            score: 8,
            reasoning: "Good docs",
          },
        ],
        averageScore: 8,
        passed: false,
        threshold: 9,
        generatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    overallAverageScore: 8.5,
    passed: false,
    threshold: 9,
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("includes the toolId", () => {
    expect(formatMultiModelReport(baseMultiReport)).toContain("rg");
  });

  it("includes all model names", () => {
    const output = formatMultiModelReport(baseMultiReport);
    expect(output).toContain("claude-sonnet-4-6");
    expect(output).toContain("claude-opus-4-6");
  });

  it("includes the skillPath", () => {
    expect(formatMultiModelReport(baseMultiReport)).toContain("/home/.agents/skills/rg/SKILL.md");
  });

  it("includes per-model average scores", () => {
    const output = formatMultiModelReport(baseMultiReport);
    expect(output).toContain("9.0/10");
    expect(output).toContain("8.0/10");
  });

  it("includes overall average score", () => {
    expect(formatMultiModelReport(baseMultiReport)).toContain("8.5/10");
  });

  it("shows PASS when passed is true", () => {
    const passing = { ...baseMultiReport, passed: true, overallAverageScore: 9 };
    expect(formatMultiModelReport(passing)).toContain("PASS");
  });

  it("shows FAIL when passed is false", () => {
    expect(formatMultiModelReport(baseMultiReport)).toContain("FAIL");
  });

  it("shows threshold in output", () => {
    expect(formatMultiModelReport(baseMultiReport)).toContain("threshold: 9/10");
  });

  it("shows scenario tasks for each model", () => {
    expect(formatMultiModelReport(baseMultiReport)).toContain("search Python files");
  });

  it("shows Missing from skill section when report fails and missing info exists", () => {
    const report: MultiModelValidationReport = {
      ...baseMultiReport,
      passed: false,
      reports: [
        {
          ...baseMultiReport.reports[0],
          scenarios: [{ ...baseMultiReport.reports[0].scenarios[0], missing: "the -v flag" }],
        },
      ],
    };
    expect(formatMultiModelReport(report)).toContain("the -v flag");
  });

  it("does not show Missing section when report passes", () => {
    const passing: MultiModelValidationReport = {
      ...baseMultiReport,
      passed: true,
      reports: [
        {
          ...baseMultiReport.reports[0],
          scenarios: [{ ...baseMultiReport.reports[0].scenarios[0], missing: "minor thing" }],
        },
      ],
    };
    expect(formatMultiModelReport(passing)).not.toContain("Missing from skill:");
  });

  it("shows [hallucinated] tag for hallucinated scenarios", () => {
    const report: MultiModelValidationReport = {
      ...baseMultiReport,
      reports: [
        {
          ...baseMultiReport.reports[0],
          scenarios: [{ ...baseMultiReport.reports[0].scenarios[0], hallucinated: true }],
        },
      ],
    };
    expect(formatMultiModelReport(report)).toContain("hallucinated");
  });
});

describe("buildValidationFeedback", () => {
  const passingReport: MultiModelValidationReport = {
    toolId: "rg",
    skillPath: "/skills/rg/SKILL.md",
    models: ["model-a", "model-b"],
    reports: [
      {
        toolId: "rg",
        skillPath: "/skills/rg/SKILL.md",
        model: "model-a",
        scenarios: [
          {
            task: "search files",
            command: "rg pattern",
            completed: true,
            correct: true,
            hallucinated: false,
            missing: "the -l flag for filenames only",
            score: 7,
            reasoning: "ok",
          },
        ],
        averageScore: 7,
        passed: false,
        threshold: 9,
        generatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        toolId: "rg",
        skillPath: "/skills/rg/SKILL.md",
        model: "model-b",
        scenarios: [
          {
            task: "search files",
            command: "rg --list pattern",
            completed: true,
            correct: false,
            hallucinated: true,
            missing: "",
            score: 6,
            reasoning: "hallucinated --list",
          },
        ],
        averageScore: 6,
        passed: false,
        threshold: 9,
        generatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    overallAverageScore: 6.5,
    passed: false,
    threshold: 9,
    generatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("includes the toolId and average score", () => {
    const feedback = buildValidationFeedback(passingReport);
    expect(feedback).toContain("rg");
    expect(feedback).toContain("6.5/10");
  });

  it("includes the number of models", () => {
    const feedback = buildValidationFeedback(passingReport);
    expect(feedback).toContain("2 model");
  });

  it("includes missing information from scenarios", () => {
    const feedback = buildValidationFeedback(passingReport);
    expect(feedback).toContain("the -l flag for filenames only");
  });

  it("includes hallucinated task names", () => {
    const feedback = buildValidationFeedback(passingReport);
    expect(feedback).toContain("search files");
    expect(feedback).toContain("hallucinated");
  });

  it("deduplicates missing info across models", () => {
    const report: MultiModelValidationReport = {
      ...passingReport,
      reports: [
        { ...passingReport.reports[0] },
        {
          ...passingReport.reports[1],
          scenarios: [{ ...passingReport.reports[0].scenarios[0] }], // same missing info
        },
      ],
    };
    const feedback = buildValidationFeedback(report);
    const count = (feedback.match(/the -l flag for filenames only/g) || []).length;
    expect(count).toBe(1);
  });

  it("omits missing section when no scenarios have missing info", () => {
    const report: MultiModelValidationReport = {
      ...passingReport,
      reports: [
        {
          ...passingReport.reports[0],
          scenarios: [{ ...passingReport.reports[0].scenarios[0], missing: "" }],
        },
      ],
    };
    const feedback = buildValidationFeedback(report);
    expect(feedback).not.toContain("missing from the skill");
  });

  it("omits hallucination section when no scenarios hallucinated", () => {
    const report: MultiModelValidationReport = {
      ...passingReport,
      reports: [
        {
          ...passingReport.reports[0],
          scenarios: [{ ...passingReport.reports[0].scenarios[0], hallucinated: false }],
        },
      ],
    };
    const feedback = buildValidationFeedback(report);
    expect(feedback).not.toContain("hallucinated non-existent");
  });

  it("ends with a call to improve the skill", () => {
    const feedback = buildValidationFeedback(passingReport);
    expect(feedback).toContain("improve the skill");
  });
});
