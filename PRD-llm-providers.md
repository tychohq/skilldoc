# PRD: LLM Provider Abstraction

**Goal:** Implement the provider resolution chain documented in README Prerequisites. Create a unified `src/llm.ts` module that supports CLI backends (Claude Code, Codex, Gemini) and direct API calls (Anthropic, OpenAI, Gemini, OpenRouter), with config file support.

**Repo:** `~/projects/agent-tool-docs`

---

## Context

The README now documents a full provider resolution chain:
1. Config file (`~/.agent-tool-docs/config.yaml`) — if set, use it
2. CLIs on PATH — Claude Code → Codex → Gemini (first found wins)
3. Environment variables — `ANTHROPIC_API_KEY` → `OPENAI_API_KEY` → `GEMINI_API_KEY` → `OPENROUTER_API_KEY`

Currently only `claude` and `gemini` CLIs are supported, hardcoded in `src/distill.ts` and `src/validate.ts`.

### Key files to modify
- `src/llm.ts` — NEW: unified LLM caller module
- `src/distill.ts` — replace `callLLM()` to use new module
- `src/validate.ts` — replace `getModelCommand()` and `callLLM()` to use new module
- `src/config.ts` — add config file loading for LLM settings
- `test/llm.test.ts` — NEW: tests for provider resolution
- `test/distill.test.ts` — update mocks
- `test/validate.test.ts` — update mocks

### No new dependencies
Use Node built-in `fetch()` for HTTP. Use existing `yaml` devDependency for config parsing.

---

## Tasks

- [ ] **Task 1: Create `src/llm.ts` — provider resolution and unified caller**

  Create a new module that exports:

  ```typescript
  // The main entry point — resolves provider and calls LLM
  export function callLLM(prompt: string, options?: { model?: string }): string;

  // For testing — resolve which provider would be used without calling it
  export function resolveProvider(options?: { model?: string }): ResolvedProvider;

  // Types
  export type ProviderType = 'claude-cli' | 'codex-cli' | 'gemini-cli' | 'anthropic' | 'openai' | 'gemini' | 'openrouter';
  export type ResolvedProvider = { provider: ProviderType; model: string; apiKey?: string };
  ```

  **Provider resolution order** (first match wins):
  1. Config file at `~/.agent-tool-docs/config.yaml` — if `provider` field is set
  2. CLIs on PATH (check with `which`): `claude` → `codex` → `gemini`
  3. Env vars: `ANTHROPIC_API_KEY` → `OPENAI_API_KEY` → `GEMINI_API_KEY` → `OPENROUTER_API_KEY`
  4. Throw descriptive error listing all options

  **CLI backends** (synchronous via `spawnSync`):
  - `claude-cli`: `spawnSync("claude", ["-p", "--output-format", "text", "--model", model, "--no-session-persistence"], { input: prompt })`
  - `codex-cli`: `spawnSync("codex", ["exec", "--model", model], { input: prompt })`  
  - `gemini-cli`: `spawnSync("gemini", ["-p", prompt], { encoding: "utf8" })` (gemini takes prompt as arg, not stdin)

  **API backends** (synchronous — use `spawnSync` with a small inline Node script that does fetch, to keep everything sync):

  Actually, since the rest of the codebase is sync (spawnSync everywhere), use `child_process.execSync` running a small inline script that does the fetch. Or better: use `spawnSync("node", ["-e", script])` where script does the fetch. This keeps the module sync-compatible with the existing codebase.

  Alternatively, and more cleanly: use `Bun.spawnSync` or just make `callLLM` async and update callers. Check what pattern works best with the existing code — `distillTool` is already async, `callLLM` in validate.ts is sync. The cleanest approach may be to keep CLI calls sync and add an async `callLLMAsync` for API providers, with the sync `callLLM` wrapper doing a sync subprocess for API calls.

  For simplicity, the approach should be: for CLI providers, use spawnSync directly. For API providers, spawn a child node/bun process that does the fetch and writes to stdout. This keeps everything sync and compatible.

  **Default models per provider:**
  - `claude-cli` → `claude-haiku-4-5-20251001`
  - `codex-cli` → `o4-mini` 
  - `gemini-cli` → (no model flag, use gemini's default)
  - `anthropic` → `claude-sonnet-4-5-20250514`
  - `openai` → `gpt-4.1`
  - `gemini` → `gemini-2.5-flash`
  - `openrouter` → `anthropic/claude-sonnet-4-5`

  **API endpoints:**
  - `anthropic` → `https://api.anthropic.com/v1/messages` (Anthropic Messages API format)
  - `openai` → `https://api.openai.com/v1/chat/completions` (OpenAI Chat format)
  - `gemini` → `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` (Gemini API format)
  - `openrouter` → `https://openrouter.ai/api/v1/chat/completions` (OpenAI-compatible format)

  **Error handling:**
  - If no provider found: throw with message listing all options (install a CLI, set an API key, or create config)
  - If API call fails: include status code and error body in message
  - If CLI exits non-zero: include stderr in message

  Keep the existing `ExecFn` type and dependency injection pattern so tests can mock. Export a `createLLMCaller(options?: { exec?: ExecFn, checkBinary?: (name: string) => boolean, env?: Record<string, string | undefined>, configPath?: string })` factory for testability.

- [ ] **Task 2: Add config file loading**

  In `src/llm.ts` (or a helper), add config loading from `~/.agent-tool-docs/config.yaml`:

  ```yaml
  provider: claude-cli
  model: claude-haiku-4-5
  apiKey: sk-ant-...
  ```

  All fields are optional. If file doesn't exist, skip silently. If file is invalid YAML, skip silently (match existing pattern in `loadDistillConfig`). Use the existing `yaml` package for parsing.

  The `provider` field determines the backend. The `model` field overrides the default for that provider. The `apiKey` field overrides env var lookup for API providers.

- [ ] **Task 3: Wire `src/distill.ts` to use the new LLM module**

  Replace the existing `callLLM` function in distill.ts:
  - Import from `src/llm.ts` instead of having its own implementation
  - The `model` parameter from CLI flags should be passed through to the LLM module
  - The `LLMCaller` type and `llmCaller` option in `DistillOptions` must still work for test mocking
  - Remove the `defaultExec` and `ExecFn` type from distill.ts (they move to llm.ts)
  - Keep `detectVersion` using its own exec since it's not an LLM call

  The key change: `distill.ts`'s `callLLM` currently builds the prompt and shells out to claude. After this task, it builds the prompt and calls `llm.callLLM(prompt, { model })`.

- [ ] **Task 4: Wire `src/validate.ts` to use the new LLM module**

  Replace `getModelCommand` and `callLLM` in validate.ts:
  - Import from `src/llm.ts`
  - The `model` parameter in each validation function passes through to `llm.callLLM(prompt, { model })`
  - Remove `getModelCommand` entirely
  - Keep the `ExecFn` type for test injection — the LLM module's factory should accept it
  - When `--models` specifies multiple models, each model string is passed to the LLM module which resolves it

- [ ] **Task 5: Add `test/llm.test.ts`**

  Test the provider resolution logic thoroughly:
  - Config file present with provider → uses config provider
  - Config file missing → falls through to CLI detection
  - Config file invalid YAML → falls through to CLI detection
  - CLI detection: claude on PATH → uses claude-cli
  - CLI detection: only codex on PATH → uses codex-cli
  - CLI detection: only gemini on PATH → uses gemini-cli
  - No CLIs → falls through to env vars
  - `ANTHROPIC_API_KEY` set → uses anthropic
  - Only `OPENAI_API_KEY` set → uses openai
  - Only `OPENROUTER_API_KEY` set → uses openrouter
  - Nothing available → throws descriptive error
  - Model override via options → uses specified model regardless of provider default
  - Config `apiKey` → overrides env var

  Use dependency injection (mock exec, mock binary checker, mock env) — no real API calls in tests.

- [ ] **Task 6: Update `test/distill.test.ts` and `test/validate.test.ts`**

  Update existing tests to work with the new LLM module:
  - Tests that pass mock `LLMCaller` or mock `ExecFn` should still work unchanged
  - If any test directly references the old `callLLM` from distill.ts, update the import
  - If any test references `getModelCommand`, remove those references
  - All existing tests must pass — zero regressions

- [ ] **Task 7: Add `tool-docs config` command**

  Add a `config` subcommand to the CLI:
  ```
  tool-docs config                              # show current resolved provider & config
  tool-docs config --provider anthropic          # set provider in config file
  tool-docs config --model claude-haiku-4-5      # set model in config file
  tool-docs config --api-key sk-ant-...          # set API key in config file
  tool-docs config --reset                       # delete config file
  ```

  Show command (no flags) should display:
  ```
  Provider: claude-cli (auto-detected)
  Model: claude-haiku-4-5-20251001 (default)
  Config: ~/.agent-tool-docs/config.yaml (not found)
  ```

  Update the help text in `src/cli.ts` to include the `config` command.

- [ ] **Task 8: Verify all tests pass and build succeeds**

  Run `bun test`, `bun run build`, and `bun typecheck`. Fix any failures. This is the final validation step.
