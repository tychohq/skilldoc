# Parser Fix PRD — Handle All Help Output Formats

## Context
The parser (`src/parser.ts`) fails on ~50% of registered tools because it only handles one help format. The pipeline produces empty/broken raw docs for these tools, which means the LLM distill step hallucinates from training data instead of distilling actual output.

## Problem
The section header regex requires a trailing colon: `^([A-Z][A-Za-z0-9 /_-]*):\s*$`
The section name list is too narrow (only matches `Commands`, `Available Commands`, etc.)

This breaks on:
- **gh**: Uses `CORE COMMANDS`, `ADDITIONAL COMMANDS`, `GITHUB ACTIONS COMMANDS` (no trailing colon, multi-word headers)
- **vercel**: Uses `Commands:` header but with sub-groupings (`Basic`, `Advanced`)
- **ffmpeg**: Lowercase `usage:`, non-standard format, no section headers
- **curl**: Shows abbreviated help by default (needs `--help all`)
- **rg**: Options are the main content, no "Commands" section (expected — it's not a subcommand tool)
- **jq**: No subcommands (expected — it's a filter language)

## Failing Tools (from audit)
- ⚠️ agentmail — binary not found (skip for now)
- ⚠️ curl — No commands detected (expected for curl, but options should parse)
- ⚠️ ffmpeg — No usage, no commands, no options
- ⚠️ gh — No usage, no commands, no options
- ⚠️ jq — No commands detected (expected)
- ⚠️ remindctl — No options detected
- ⚠️ rg — No commands detected (expected)
- ⚠️ uvx — No commands detected (expected)
- ⚠️ vercel — No usage, no commands, no options

## Tasks

- [ ] Fix section header regex to match headers WITHOUT trailing colons (e.g. `CORE COMMANDS`, `USAGE`, `FLAGS`)
- [ ] Add fuzzy section name matching for commands: match any header containing "command" or "subcommand" (case-insensitive)
- [ ] Add fuzzy section name matching for options: match any header containing "option" or "flag" (case-insensitive)
- [ ] Handle `gh`-style command lines with trailing colons: `auth:   description` → command name `auth`
- [ ] Handle `vercel`-style grouped commands with sub-headers (Basic, Advanced, etc.)
- [ ] Handle `ffmpeg`-style lowercase usage line: `usage: ffmpeg [options]...`
- [ ] Handle `curl` registry entry: update helpArgs to `["--help", "all"]` in registry.yaml so we capture the full help
- [ ] Update existing parser tests to not break
- [ ] Add parser test cases for gh, vercel, ffmpeg, and curl help output formats
- [ ] Re-run `tool-docs generate` on all tools and verify the 9 previously-failing tools now produce non-empty raw docs
- [ ] Re-run `tool-docs distill` on tools that had broken raw docs and verify the output improves

- [ ] Fix the distill prompt to PROHIBIT hallucination: add explicit instruction that the LLM must ONLY use information present in the raw docs. If raw docs are empty/insufficient, the skill should say "Insufficient raw docs — re-run generate after fixing parser" instead of inventing content from training data.
- [ ] Update the distill prompt in `distill-config.yaml` (or wherever the prompt template lives) to include: "Do NOT add commands, flags, examples, or behavior from your training knowledge. Only distill what appears in the provided documentation. If the input docs contain no useful content, output a stub skill that says 'raw docs incomplete'."
- [ ] Fix the validate step to check for hallucination/groundedness: the validator should compare the generated skill against the raw docs and flag any commands, flags, or behaviors that appear in the skill but NOT in the raw docs. This should be a scored dimension alongside accuracy/completeness/formatting.
- [ ] Add a "groundedness" score to validation output that specifically measures whether skill content is traceable to the raw docs

## Non-Goals
- Don't fix agentmail (binary not installed)
- Tools like jq, rg, uvx that correctly have no subcommands — "No commands detected" is fine for those. Focus on making sure their options/usage ARE captured.

## Testing
Run `bun test` — all existing tests must pass plus new ones for the formats above.

## Files to Modify
- `src/parser.ts` — main parser logic
- `test/parser.test.ts` — add test cases
- `test/fixtures/` — add fixture files for gh, vercel, ffmpeg, curl help output
- `~/.agents/tool-docs/registry.yaml` — update curl helpArgs
