# AGENTS.md — skilldoc

CLI tool that generates agent-optimized skill documentation from CLI `--help` output.

## Pipeline

```
--help output → generate → raw docs (~10-50KB)
                         → distill (LLM) → SKILL.md + docs/ (~7KB total)
                         → validate (LLM-as-agent, 4 scenarios × N models)
                         → auto-redist if score < threshold
```

## CLI Commands

| Command | Purpose |
|---------|---------|
| `add <tool>` | Full pipeline + lock entry + optional agent symlinks |
| `list` | Show installed skills from lock file |
| `update [tool]` | Rebuild stale skills (version/help changed) |
| `remove <tool>` | Remove skill, lock entry, docs, and symlinks |
| `run <tool>` | generate → distill → validate in one shot |
| `run` (no arg) | Batch run from lock file |
| `generate <tool>` | Parse --help into structured docs |
| `distill <tool>` | LLM-compress raw docs into skill files |
| `refresh` | Re-run generate+distill for changed tools |
| `validate <tool>` | LLM-based scenario evaluation |
| `report` | Aggregate quality report |
| `config` | Show/set LLM provider config |

## Source Layout

| File | Purpose |
|------|---------|
| `src/cli.ts` | CLI entry point, all command handlers, flag parsing, subcommand detection |
| `src/parser.ts` | Parse raw --help output into structured sections |
| `src/render.ts` | Render parsed docs to markdown |
| `src/usage.ts` | Extract usage patterns and flags from usage lines |
| `src/distill.ts` | LLM distillation: prompt building, output parsing, size checks |
| `src/validate.ts` | LLM-as-agent validation: scenarios, scoring, groundedness |
| `src/llm.ts` | Multi-provider LLM abstraction (7 providers: CLI + API) |
| `src/lock.ts` | Lock file (track installed skills, versions, help hashes) |
| `src/agents.ts` | Agent target detection and symlink management |
| `src/types.ts` | Shared type definitions |
| `src/utils.ts` | File I/O helpers (expandHome, ensureDir, writeFileEnsured) |

## Key Paths

| Path | Purpose |
|------|---------|
| `~/.skilldoc/config.yaml` | LLM provider config (provider, model, apiKey) |
| `~/.skilldoc/docs/` | Raw generated docs |
| `~/.skilldoc/distill-config.yaml` | Distillation prompt tuning |
| `~/.skills/` | Canonical skill output directory |
| `~/.skills/skilldoc-lock.yaml` | Lock file tracking installed skills |

## LLM Provider Flow

Both `distill.ts` and `validate.ts` use the shared `llm.ts` abstraction. Provider resolution order:
1. `~/.skilldoc/config.yaml` explicit provider
2. CLI binary detection (claude → codex → gemini)
3. Environment variable API keys (ANTHROPIC_API_KEY → OPENAI_API_KEY → etc.)

## Testing

```bash
bun test              # 723+ tests
bun run build         # bundle to bin/skilldoc.js
bunx tsc --noEmit     # type check
```

Tests use injected `exec` functions — no real LLM calls. The `LLMCaller` type in distill.ts and `ExecFn` in validate.ts allow full mock injection.

## Build

Single-file bundle via `bun build src/cli.ts --outfile bin/skilldoc.js`. Standalone binaries via GitHub Actions release workflow.
