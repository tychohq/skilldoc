# README Polish + Marketing Prep — PRD

**Goal:** Transform the current minimal README into a compelling, marketing-grade landing page for developers. Also prep example outputs and ensure zero-install works.

**Marketing plan reference:** `~/.openclaw/workspace/research/agent-tool-docs/marketing/plan.md`

---

## Context

agent-tool-docs is a CLI that auto-generates agent-optimized skill documentation from CLI `--help` output. The pipeline: extract raw docs → LLM-distill to ~2KB skills → multi-model validate.

The current README is bare-bones. We need it to sell the tool on first glance — a developer should understand the problem, see the solution, and know how to try it in under 60 seconds of reading.

**Key selling points to emphasize:**
- Agents hallucinate CLI flags because they guess from training data
- 48KB of raw `--help` → 2KB verified skill doc
- Multi-model validation (scores 9/10+ across Claude, Codex, Gemini)
- One command: `tool-docs generate && tool-docs distill`
- Works with any CLI that has `--help`
- Output format works with AGENTS.md, CLAUDE.md, OpenClaw skills, or any agent system

---

## Tasks

### Phase 1: README Rewrite

- [x] Rewrite README.md following this structure:
  1. **Title + badges** — name, version, license, "works with" badges (Claude Code, Codex, Gemini CLI, OpenClaw)
  2. **One-liner tagline** — "Auto-generate agent-optimized CLI docs from `--help` output — verified, compressed, ready for AGENTS.md"
  3. **The Problem** (2-3 sentences) — "Your AI agent hallucinates CLI flags because it's guessing from training data. Hand-writing tool docs is tedious and goes stale. 48KB of raw `--help` burns 12K tokens."
  4. **The Solution** — Pipeline diagram (text-based, not image): `--help → extract → distill → validate → SKILL.md`
  5. **Quick Start** — 4-5 commands max: install, generate, distill, see output. Must feel effortless.
  6. **Example Output** — Show a real generated SKILL.md inline (use `jq` or `curl` — something universally known). Truncate if needed but show enough to demonstrate quality.
  7. **How It Works** — Brief explanation of each pipeline stage (extract, distill, validate). Keep it concise.
  8. **Supported Tools** — List the registry with checkmarks. Group by category.
  9. **Validation** — Explain multi-model scoring, show example scores table
  10. **Output Format** — Show the directory structure and explain SKILL.md + docs/ split
  11. **Configuration** — Registry format, how to add custom tools
  12. **Contributing** — How to add tools, run tests, etc.
  13. **License** — MIT
- [x] Keep total README under 400 lines — dense but scannable
- [x] Use clear section headers, bullet points, and code blocks
- [x] NO marketing fluff or superlatives — let the tool speak for itself

### Phase 2: Example Skills

- [x] Create an `examples/` directory in the repo
- [x] Copy 3-5 of the best generated skills into `examples/` (pick from existing generated output at `~/.agents/skills/`):
  - `jq` — universally known, shows compression value
  - `curl` — everyone uses it, complex `--help`
  - `gh` — popular with the target audience
  - `ffmpeg` — massive `--help`, impressive compression
  - `rg` (ripgrep) — developer favorite
- [ ] Each example should include the full SKILL.md + docs/ subfolder as generated
- [ ] Add a brief `examples/README.md` explaining these are real generated output

### Phase 3: Package & Install Polish

- [ ] Ensure `package.json` has proper fields: description, keywords, homepage, repository, license
- [ ] Add `keywords` to package.json: `["ai-agents", "cli", "documentation", "agents-md", "claude-code", "llm", "skill-generation"]`
- [ ] Verify `bun install && bun run build` produces a working `bin/tool-docs.js`
- [ ] Test that the CLI runs correctly from a fresh clone: `node bin/tool-docs.js --help`
- [ ] Add GitHub repo description via `gh`: "Auto-generate agent-optimized CLI docs from --help output"
- [ ] Add GitHub topics via `gh`: ai-agents, cli, documentation, agents-md, claude-code, llm-tools, skill-generation

---

## Quality Criteria

- A developer should understand what this tool does within 10 seconds of landing on the README
- The Quick Start should be copy-pasteable and work
- Example output should demonstrate the quality of generated skills
- No broken links, no placeholder text
- README renders correctly on GitHub (test with `gh repo view`)
