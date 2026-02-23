import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createLLMCaller, ExecFn } from "../src/llm.js";

function makeExec(output: string): ExecFn {
  return () => ({ stdout: output, stderr: "", status: 0 });
}

describe("llm provider resolution", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "tool-docs-llm-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uses config provider when set", () => {
    const configPath = path.join(tmpDir, "config.yaml");
    writeFileSync(configPath, "provider: openai\nmodel: gpt-4.1-mini\napiKey: sk-config\n", "utf8");

    const caller = createLLMCaller({
      configPath,
      checkBinary: () => true,
      env: { ANTHROPIC_API_KEY: "env-key" },
      exec: makeExec("ok"),
    });

    const resolved = caller.resolveProvider();
    expect(resolved.provider).toBe("openai");
    expect(resolved.model).toBe("gpt-4.1-mini");
    expect(resolved.apiKey).toBe("sk-config");
  });

  it("falls through to CLI detection when config file is missing", () => {
    const configPath = path.join(tmpDir, "missing.yaml");
    const caller = createLLMCaller({
      configPath,
      checkBinary: (name) => name === "codex",
      env: {},
      exec: makeExec("ok"),
    });

    const resolved = caller.resolveProvider();
    expect(resolved.provider).toBe("codex-cli");
    expect(resolved.model).toBe("o4-mini");
  });

  it("falls through to CLI detection when config YAML is invalid", () => {
    const configPath = path.join(tmpDir, "config.yaml");
    writeFileSync(configPath, "provider: [oops", "utf8");

    const caller = createLLMCaller({
      configPath,
      checkBinary: (name) => name === "gemini",
      env: {},
      exec: makeExec("ok"),
    });

    const resolved = caller.resolveProvider();
    expect(resolved.provider).toBe("gemini-cli");
  });

  it("applies config model when provider is omitted", () => {
    const configPath = path.join(tmpDir, "config.yaml");
    writeFileSync(configPath, "model: custom-model\n", "utf8");

    const caller = createLLMCaller({
      configPath,
      checkBinary: (name) => name === "codex",
      env: {},
      exec: makeExec("ok"),
    });

    const resolved = caller.resolveProvider();
    expect(resolved.provider).toBe("codex-cli");
    expect(resolved.model).toBe("custom-model");
  });

  it("applies config apiKey when provider is omitted", () => {
    const configPath = path.join(tmpDir, "config.yaml");
    writeFileSync(configPath, "apiKey: sk-config-only\n", "utf8");

    const caller = createLLMCaller({
      configPath,
      checkBinary: () => false,
      env: { OPENAI_API_KEY: "sk-env" },
      exec: makeExec("ok"),
    });

    const resolved = caller.resolveProvider();
    expect(resolved.provider).toBe("openai");
    expect(resolved.apiKey).toBe("sk-config-only");
  });

  it("prefers claude when multiple CLIs are available", () => {
    const caller = createLLMCaller({
      configPath: path.join(tmpDir, "missing.yaml"),
      checkBinary: (name) => name === "claude" || name === "codex" || name === "gemini",
      env: {},
      exec: makeExec("ok"),
    });

    expect(caller.resolveProvider().provider).toBe("claude-cli");
  });

  it("uses codex when claude is unavailable", () => {
    const caller = createLLMCaller({
      configPath: path.join(tmpDir, "missing.yaml"),
      checkBinary: (name) => name === "codex",
      env: {},
      exec: makeExec("ok"),
    });

    expect(caller.resolveProvider().provider).toBe("codex-cli");
  });

  it("uses gemini CLI when it is the only CLI available", () => {
    const caller = createLLMCaller({
      configPath: path.join(tmpDir, "missing.yaml"),
      checkBinary: (name) => name === "gemini",
      env: {},
      exec: makeExec("ok"),
    });

    expect(caller.resolveProvider().provider).toBe("gemini-cli");
  });

  it("falls through to ANTHROPIC_API_KEY when no CLIs are found", () => {
    const caller = createLLMCaller({
      configPath: path.join(tmpDir, "missing.yaml"),
      checkBinary: () => false,
      env: { ANTHROPIC_API_KEY: "sk-ant" },
      exec: makeExec("ok"),
    });

    const resolved = caller.resolveProvider();
    expect(resolved.provider).toBe("anthropic");
    expect(resolved.apiKey).toBe("sk-ant");
  });

  it("falls through to OPENAI_API_KEY when Anthropic key is absent", () => {
    const caller = createLLMCaller({
      configPath: path.join(tmpDir, "missing.yaml"),
      checkBinary: () => false,
      env: { OPENAI_API_KEY: "sk-openai" },
      exec: makeExec("ok"),
    });

    const resolved = caller.resolveProvider();
    expect(resolved.provider).toBe("openai");
    expect(resolved.apiKey).toBe("sk-openai");
  });

  it("falls through to GEMINI_API_KEY when Anthropic and OpenAI keys are absent", () => {
    const caller = createLLMCaller({
      configPath: path.join(tmpDir, "missing.yaml"),
      checkBinary: () => false,
      env: { GEMINI_API_KEY: "sk-gemini" },
      exec: makeExec("ok"),
    });

    const resolved = caller.resolveProvider();
    expect(resolved.provider).toBe("gemini");
    expect(resolved.apiKey).toBe("sk-gemini");
  });

  it("falls through to OPENROUTER_API_KEY when earlier env keys are absent", () => {
    const caller = createLLMCaller({
      configPath: path.join(tmpDir, "missing.yaml"),
      checkBinary: () => false,
      env: { OPENROUTER_API_KEY: "sk-or" },
      exec: makeExec("ok"),
    });

    const resolved = caller.resolveProvider();
    expect(resolved.provider).toBe("openrouter");
    expect(resolved.apiKey).toBe("sk-or");
  });

  it("uses options.model as the highest-priority model override", () => {
    const configPath = path.join(tmpDir, "config.yaml");
    writeFileSync(configPath, "provider: claude-cli\nmodel: claude-haiku-4-5\n", "utf8");

    const caller = createLLMCaller({
      configPath,
      checkBinary: () => true,
      env: {},
      exec: makeExec("ok"),
    });

    const resolved = caller.resolveProvider({ model: "claude-opus-4-6" });
    expect(resolved.provider).toBe("claude-cli");
    expect(resolved.model).toBe("claude-opus-4-6");
  });

  it("config apiKey overrides env API key for the same provider", () => {
    const configPath = path.join(tmpDir, "config.yaml");
    writeFileSync(configPath, "provider: anthropic\napiKey: sk-config\n", "utf8");

    const caller = createLLMCaller({
      configPath,
      checkBinary: () => false,
      env: { ANTHROPIC_API_KEY: "sk-env" },
      exec: makeExec("ok"),
    });

    const resolved = caller.resolveProvider();
    expect(resolved.provider).toBe("anthropic");
    expect(resolved.apiKey).toBe("sk-config");
  });

  it("throws a descriptive error when no providers are available", () => {
    const caller = createLLMCaller({
      configPath: path.join(tmpDir, "missing.yaml"),
      checkBinary: () => false,
      env: {},
      exec: makeExec("ok"),
    });

    expect(() => caller.resolveProvider()).toThrow("No LLM provider available");
    expect(() => caller.resolveProvider()).toThrow("claude");
    expect(() => caller.resolveProvider()).toThrow("ANTHROPIC_API_KEY");
  });
});

describe("llm unified caller", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "tool-docs-llm-call-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("calls claude CLI with expected args and stdin", () => {
    let capturedArgs: ReadonlyArray<string> = [];
    let capturedInput = "";

    const exec: ExecFn = (_cmd, args, options) => {
      capturedArgs = args;
      capturedInput = options.input;
      return { stdout: "claude output", stderr: "", status: 0 };
    };

    const caller = createLLMCaller({
      configPath: path.join(tmpDir, "missing.yaml"),
      checkBinary: (name) => name === "claude",
      env: {},
      exec,
    });

    const output = caller.callLLM("hello from prompt", { model: "claude-test-model" });
    expect(output).toBe("claude output");
    expect(capturedArgs).toEqual([
      "-p",
      "--output-format",
      "text",
      "--model",
      "claude-test-model",
      "--no-session-persistence",
    ]);
    expect(capturedInput).toBe("hello from prompt");
  });

  it("calls codex CLI with expected args", () => {
    let capturedCommand = "";
    let capturedArgs: ReadonlyArray<string> = [];
    let capturedInput = "";

    const exec: ExecFn = (cmd, args, options) => {
      capturedCommand = cmd;
      capturedArgs = args;
      capturedInput = options.input;
      return { stdout: "codex output", stderr: "", status: 0 };
    };

    const caller = createLLMCaller({
      configPath: path.join(tmpDir, "missing.yaml"),
      checkBinary: (name) => name === "codex",
      env: {},
      exec,
    });

    const output = caller.callLLM("prompt");
    expect(output).toBe("codex output");
    expect(capturedCommand).toBe("codex");
    expect(capturedArgs).toEqual(["exec", "--model", "o4-mini"]);
    expect(capturedInput).toBe("prompt");
  });

  it("calls gemini CLI with prompt argument instead of stdin", () => {
    let capturedArgs: ReadonlyArray<string> = [];
    let capturedInput = "not-set";

    const exec: ExecFn = (_cmd, args, options) => {
      capturedArgs = args;
      capturedInput = options.input;
      return { stdout: "gemini output", stderr: "", status: 0 };
    };

    const caller = createLLMCaller({
      configPath: path.join(tmpDir, "missing.yaml"),
      checkBinary: (name) => name === "gemini",
      env: {},
      exec,
    });

    const output = caller.callLLM("prompt text");
    expect(output).toBe("gemini output");
    expect(capturedArgs).toEqual(["-p", "prompt text"]);
    expect(capturedInput).toBe("");
  });

  it("surfaces CLI errors with stderr", () => {
    const exec: ExecFn = () => ({ stdout: "", stderr: "model not found", status: 1 });

    const caller = createLLMCaller({
      configPath: path.join(tmpDir, "missing.yaml"),
      checkBinary: (name) => name === "claude",
      env: {},
      exec,
    });

    expect(() => caller.callLLM("prompt")).toThrow("claude exited with code 1");
    expect(() => caller.callLLM("prompt")).toThrow("model not found");
  });

  it("routes API providers through the node fetch runner", () => {
    let capturedCommand = "";
    let capturedArgs: ReadonlyArray<string> = [];
    let capturedProvider = "";
    let capturedModel = "";
    let capturedApiKey = "";

    const exec: ExecFn = (cmd, args, options) => {
      capturedCommand = cmd;
      capturedArgs = args;
      capturedProvider = options.env?.LLM_PROVIDER ?? "";
      capturedModel = options.env?.LLM_MODEL ?? "";
      capturedApiKey = options.env?.LLM_API_KEY ?? "";
      return { stdout: "api output", stderr: "", status: 0 };
    };

    const caller = createLLMCaller({
      configPath: path.join(tmpDir, "missing.yaml"),
      checkBinary: () => false,
      env: { OPENAI_API_KEY: "sk-openai" },
      exec,
    });

    const output = caller.callLLM("prompt", { model: "gpt-4.1-mini" });
    expect(output).toBe("api output");
    expect(capturedCommand).toBe("node");
    expect(capturedArgs[0]).toBe("--input-type=module");
    expect(capturedArgs[1]).toBe("-e");
    expect(capturedProvider).toBe("openai");
    expect(capturedModel).toBe("gpt-4.1-mini");
    expect(capturedApiKey).toBe("sk-openai");
  });

  it("throws when API provider is selected without an API key", () => {
    const configPath = path.join(tmpDir, "config.yaml");
    writeFileSync(configPath, "provider: openai\n", "utf8");

    const caller = createLLMCaller({
      configPath,
      checkBinary: () => false,
      env: {},
      exec: makeExec("unused"),
    });

    expect(() => caller.callLLM("prompt")).toThrow("Missing API key for openai");
  });
});
