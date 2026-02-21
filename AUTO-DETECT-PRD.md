# PRD: Auto-Detect Subcommand Help & Token-Based Limits

Two improvements to make `tool-docs run <binary>` "just work" without registry configuration.

## Tasks

### 1. Auto-detect subcommand help pattern

When `commandHelpArgs` is not specified in the registry (or when running in ad-hoc mode), the generate step should auto-detect how the CLI exposes subcommand help.

- [x] After parsing top-level `--help`, identify commands that likely have subcommands (heuristic: description contains "Manage", "Control", or the command's own `--help` lists sub-commands)
- [x] Pick one candidate command and probe these patterns in order:
  1. `<binary> <cmd> --help`
  2. `<binary> <cmd> -h`
  3. `<binary> help <cmd>`
- [x] Whichever returns output containing subcommand-like content (has a "Commands" or "Subcommands" section), that's the detected pattern
- [x] Store the detected pattern as `commandHelpArgs` in the tool's generated `tool.json` so future runs skip probing
- [x] If no pattern works (the CLI has no subcommand help), skip gracefully — just use top-level help
- [x] Use the detected pattern to generate command docs for ALL top-level commands (same as when `commandHelpArgs` is manually specified)
- [x] Add tests: mock a CLI that responds to `<cmd> --help` and verify auto-detection works
- [x] Add tests: mock a CLI where no subcommand help pattern works and verify graceful fallback

### 2. Switch size limits from bytes to tokens

LLMs understand tokens better than bytes, and tokens are what actually matter for context budgets.

- [x] Change `sizeLimits` in `DistillPromptConfig` from bytes to tokens: `skill: 1000`, `advanced: 500`, `recipes: 500`, `troubleshooting: 250`
- [x] Update `DEFAULT_PROMPT_CONFIG` with token-based defaults
- [x] Update `buildPrompt()` to say "≤ 1000 tokens" instead of "≤ 4000 bytes"
- [x] Update `checkSizeLimits()` to estimate tokens instead of counting bytes. Use the heuristic: `tokens ≈ bytes / 4` (good enough for English text/markdown)
- [x] Update size warning messages to say "tokens" instead of "bytes"
- [x] Update all tests that reference byte limits to use token limits
- [x] Update `distill-config.yaml` docs/comments in `distill.ts` to reference tokens
- [ ] For the `complexity` field: `simple` tools get 500 token skill limit, `complex` tools get 1000 tokens

## Non-Goals
- Implementing a real tokenizer (tiktoken etc.) — the bytes/4 heuristic is accurate enough
- Caching detected patterns across runs (just store in tool.json)

## Success Criteria
- `tool-docs run railway` with NO registry entry produces the same quality output as when `commandHelpArgs` is manually configured — subcommand docs are captured automatically
- Size limits in the prompt and warnings are expressed in tokens
- `tool-docs run jq` (simple tool, no subcommands) still works — auto-detection skips gracefully
