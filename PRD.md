# agent-tool-docs — PRD

**Goal:** Auto-generate agent-optimized skill documentation from CLI tools, producing lean (~2-5KB) SKILL.md files that any AI agent can consume with minimal token cost.

**Repo:** `~/projects/agent-tool-docs`
**Discord:** `#agent-tool-docs` (Projects category)

---

## Context

We have a working CLI (`tool-docs`) that extracts raw `--help` output into structured md/json/yaml. But the output is way too verbose for agent consumption — ripgrep generates 48KB, which burns ~12K tokens per read. We need a **distillation step** that compresses raw docs into agent-optimized skill format.

### The Architecture

```
CLI --help output → [Step 1: Extract] → raw docs (md/json/yaml)
                                              ↓
                                    [Step 2: Distill] → agent-optimized skill
                                              ↓
                                    [Step 3: Validate] → multi-model quality check
```

### Output Format (per tool)

```
~/.agents/skills/<tool-id>/
  SKILL.md              # ~2KB — core reference (what 90% of agent reads need)
  docs/
    advanced.md         # ~2KB — advanced flags, edge cases
    recipes.md          # ~2KB — common task-oriented recipes
    troubleshooting.md  # ~1KB — known gotchas, error patterns
```

The SKILL.md is the entry point. The `docs/` folder has deeper sections that agents read only when they need them. Each file stays under ~2KB to keep token cost predictable.

---

## Tasks

### Phase 1: Distillation Engine
- [x] Add `tool-docs distill` command that takes raw extracted docs and produces agent-optimized SKILL.md + docs/ folder
- [x] Distillation should use an LLM (via CLI — `claude -p` or similar) to compress raw docs into the skill format
- [x] The distill prompt should produce: (1) SKILL.md with quick reference, key commands/flags, and common patterns, (2) docs/advanced.md for power-user flags, (3) docs/recipes.md for task-oriented examples, (4) docs/troubleshooting.md for gotchas
- [x] Each output file should target ~2KB max, with SKILL.md being the most important
- [x] The distill prompt should instruct the LLM to prioritize: most-used flags/commands first, real-world usage patterns over exhaustive flag lists, agent-specific gotchas (quoting, escaping, common errors)
- [x] Add `--model` flag to distill command (default: claude via `claude -p`)

### Phase 2: Skill Output Format
- [x] Output distilled skills to `~/.agents/skills/<tool-id>/` by default (with `--out` override)
- [ ] Generate proper SKILL.md with description header that matches OpenClaw/ClawHub skill format
- [ ] Include metadata block in SKILL.md: tool binary, version detected, generation date, source (auto-generated)
- [ ] Add a `generated-from: agent-tool-docs` marker so hand-edited skills aren't overwritten

### Phase 3: Registry Expansion
- [ ] Expand the registry.yaml to support richer tool metadata: category (cli/sdk/api), homepage URL, typical use cases
- [ ] Add these tools to the registry (our most-used agent-focused CLIs): `gh` (GitHub CLI), `bird` (Twitter/X CLI), `gog` (Google Workspace), `agentmail` (AgentMail CLI), `claude` (Claude Code CLI), `openclaw` (OpenClaw CLI), `ralphy` (Ralph loop runner), `agent-browser` (browser automation), `memo` (Apple Notes), `remindctl` (Apple Reminders), `gifgrep` (GIF search), `vercel` (Vercel CLI), `supabase` (Supabase CLI), `ffmpeg`, `jq`, `curl`, `uv`/`uvx`
- [ ] Run `tool-docs generate` for all new registry entries to produce raw docs
- [ ] Run `tool-docs distill` for all new registry entries to produce skills

### Phase 4: Multi-Model Validation
- [ ] Add `tool-docs validate <tool-id>` command that tests skill quality
- [ ] Validation sends the generated SKILL.md to multiple models (Sonnet, Opus, Codex, Gemini if available) with test prompts like "Using only this documentation, write a command to [common task]"
- [ ] Each model scores the skill on: (1) Could it complete the task? (2) Was the command correct? (3) Did it hallucinate any flags/options? (4) Was there anything missing it needed?
- [ ] Aggregate scores into a quality report per tool (target: 9/10 average across models)
- [ ] If score < 9/10, automatically re-run distill with feedback from the validation failures

### Phase 5: Iteration & Polish
- [ ] Add `tool-docs refresh [--only <ids>]` that re-runs generate + distill for tools whose `--help` output has changed
- [ ] Add `--diff` flag to refresh that shows what changed in the skill output
- [ ] Write a meta-AGENTS.md for the repo documenting the distillation prompt engineering lessons learned
- [ ] Ensure the final distill prompt template is well-documented and tweakable via a config file

---

## Quality Criteria

A good generated skill should:
1. **Fit in ~2KB** for the main SKILL.md
2. **Prioritize common patterns** — the 20% of commands/flags that cover 80% of use
3. **Be task-oriented** — "How to search for a pattern in Python files" not "The --type flag accepts TYPE"
4. **Include agent-specific notes** — quoting gotchas, common errors, things LLMs get wrong
5. **Not hallucinate** — every flag/command must exist in the actual tool
6. **Stay current** — re-running generate+distill should produce updated skills when tools change
7. **Score 9/10+** across Sonnet, Opus, Codex, and Gemini on practical task completion

## Non-Goals
- Not replacing hand-written skills that have personal/custom context (credentials, workflows)
- Not a runtime MCP server (this is static doc generation, not Context7-style query-time fetching)
- Not covering non-CLI tools (APIs, SDKs) in v1 — just `--help`-parseable CLIs
