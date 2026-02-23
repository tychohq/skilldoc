# AGENTS.md — skilldoc

## What This Is
CLI that auto-generates agent-optimized skill documentation from CLI `--help` output. Two-step pipeline: extract raw docs → distill into lean (~2KB) skills.

## Architecture
- `src/parser.ts` — Parses raw `--help` text into structured sections (commands, flags, env, examples)
- `src/render.ts` — Renders parsed data to markdown/JSON/YAML
- `src/cli.ts` — CLI entry point (`generate`, `init`, `distill`, `validate`)
- `src/config.ts` — Registry loading and config
- `src/types.ts` — TypeScript types
- `src/usage.ts` — Usage line parsing
- `src/utils.ts` — String utilities
- `bin/skilldoc.js` — CLI binary

## Key Paths
- **Registry:** `~/.agents/skilldoc/registry.yaml` — defines tools to document
- **Raw output:** `~/.agents/docs/skilldoc/<tool-id>/` — extracted md/json/yaml
- **Skill output:** `~/.agents/skills/<tool-id>/` — distilled agent-optimized skills

## PRD
See `PRD.md` for the full task checklist. Work through tasks in order.

## Conventions
- TypeScript, built with `bun`
- Tests in `test/` — run with `bun test`
- Build with `bun run build`
- Help output captured with `LANG=C LC_ALL=C NO_COLOR=1` for determinism
- Don't overwrite skills that have `generated-from: skilldoc` marker absent (hand-written skills)

## Quality Bar
Generated skills must score 9/10+ across multiple LLMs on practical task completion. See PRD Phase 4 for validation details.
