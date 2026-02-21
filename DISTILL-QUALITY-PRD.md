# PRD: Distill Quality Improvements

Feedback from real-world usage of `tool-docs run railway` revealed the auto-generated SKILL.md is too thin to be useful. The manually-rewritten version at `~/.agents/skills/railway/SKILL.md` is the quality bar. This PRD addresses 4 concrete gaps.

## Reference

- **Good output (hand-written):** `~/.agents/skills/railway/SKILL.md` — has critical distinctions, subcommand depth, opinionated guidance, rich flag docs
- **Bad output (auto-generated):** what `tool-docs run` produces today — flat command table, no confusion callouts, no subcommand detail, no workflow patterns

## Tasks

### 1. Recursive subcommand help capture in generate step

The `generate` step only captures top-level `--help` output. Tools like `railway` have nested subcommands (`variable list/set/delete`, `environment new/link/delete`, `service status/redeploy/restart`) whose flags and usage only appear in `<cmd> <subcmd> --help`.

- [x] In `cli.ts` `generateCommandDocs()`, for each top-level command that has its own subcommands (detected by parsing the command's `--help` output), recursively capture `<binary> <cmd> <subcmd> --help`
- [x] Store nested command docs at `commands/<cmd>/<subcmd>/command.md` (one level deeper)
- [x] In `gatherRawDocs()` (`distill.ts`), recursively read all nested command docs so the LLM sees the full subcommand tree
- [x] Add a `maxDepth` option to registry entries (default: 2) to prevent infinite recursion on deeply nested CLIs
- [x] Add tests: verify that a tool with 2-level subcommands produces nested command docs

### 2. Add "Critical Distinctions" / "Confusion Points" section to distill prompt

The hand-written Railway skill has a "Critical Distinctions" section that prevents the most common mistake (using `deploy` instead of `up`). The auto-generated version lists both without explaining the difference.

- [x] Update `buildPrompt()` in `distill.ts` to add a new section to the SKILL.md format template: `## Critical Distinctions` — commands/flags that are easily confused with each other
- [x] Add a priority rule: "**Confusion prevention** — call out commands or flags that look similar but do different things, or that have misleading names"
- [x] The prompt should instruct the LLM: "If two or more commands could plausibly be confused (similar names, overlapping purposes), add a ## Critical Distinctions section at the TOP of SKILL.md explaining the differences"
- [x] Add test: verify `buildPrompt` output contains "Critical Distinctions" instruction

### 3. Include significant flags in subcommand reference table

The auto-generated output lists commands with one-line descriptions but omits key flags. The hand-written version notes things like `--skip-deploys` on `variable set`, `-b` on `login`, `-d` on `up`.

- [x] Update the distill prompt's SKILL.md format to show that the Key Commands/Subcommand Reference table should include the most important flags inline: e.g. `variable set KEY=VAL` with note about `--skip-deploys`
- [x] Add a priority: "**Behavior-changing flags** — flags that significantly alter a command's behavior (like `--skip-deploys`, `--dry-run`, `--force`) should appear alongside their commands, not buried in a separate flags section"
- [x] Update the example format in the prompt to show inline flag notes in the command table

### 4. Increase SKILL.md size limit for complex CLIs

The current 2KB limit forces aggressive compression that drops critical information for tools with many subcommands. The hand-written Railway SKILL.md is ~3.5KB and needs every byte.

- [x] Change the default `sizeLimits.skill` from 2000 to 4000 bytes in `DEFAULT_PROMPT_CONFIG`
- [x] Update the prompt to say "≤ 4000 bytes" for skill
- [x] Update tests that assert on the old 2000 byte limit
- [x] Consider adding a `complexity` field to registry entries: `simple` (single-command tools like jq, rg) get 2KB, `complex` (multi-subcommand tools like gh, railway, wrangler) get 4KB. If implemented, pass the limit dynamically to `buildPrompt`.

## Non-Goals
- Changing the validation scoring system (already improved in previous PRD)
- Adding interactive mode or user prompts during generation
- Supporting non-CLI tools (APIs, libraries)

## Success Criteria
- `tool-docs run railway` produces a SKILL.md that includes:
  - A "Critical Distinctions" section explaining `up` vs `deploy` vs `run` vs `dev`
  - Subcommand details for `variable`, `environment`, `service`, `deployment`
  - Key flags like `--skip-deploys`, `-b`, `-d`, `--filter` visible in the command reference
  - At least 3KB of content (not compressed to uselessness)
- The quality should be comparable to the hand-written `~/.agents/skills/railway/SKILL.md`
