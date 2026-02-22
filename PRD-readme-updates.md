# PRD: README Updates — LLM Setup & Better Examples

**Goal:** Update the README to (1) explain the LLM requirement for distill/validate steps and (2) switch the hero example from `jq` to `railway` to better showcase the value prop.

**Repo:** `~/projects/agent-tool-docs`

**Scope:** README.md changes only. No code changes.

---

## Tasks

- [ ] **Task 1: Add LLM setup section to README** — Add a "Setup" or "Prerequisites" section between the badges/intro and Quick Start that explains:

  1. The `generate` step only needs the target CLI installed — no LLM required
  2. The `distill` and `validate` steps call an LLM to compress and evaluate docs
  3. **If you already have Claude Code (`claude`) or Gemini CLI (`gemini`) installed**, it just works — no extra setup needed. These are detected automatically.
  4. The `--model` flag controls which model to use (default: `claude-haiku-4-5-20251001`)
  5. For `validate`, `--models` accepts comma-separated model list

  Also update the "How It Works → Distill" section to mention this (currently it just says "Passes raw docs to an LLM (default: claude-haiku-4-5)" without explaining what that means for setup).

  Keep it concise — 5-8 lines max for the prerequisites section. Don't over-explain.

- [ ] **Task 2: Switch primary example from jq to railway** — Replace `jq` as the hero example with `railway` throughout the README. The pitch: Railway v4 changed substantially — models trained on v3 docs will hallucinate deprecated commands.

  Changes needed:
  - Quick Start: `tool-docs run railway` instead of `tool-docs run jq`
  - Example Output section: show Railway's SKILL.md instead of jq's. **Actually run `tool-docs generate railway` first to get real raw docs, then create a realistic-looking Railway SKILL.md example.** The example in the README is manually curated (not auto-generated) — it's there to show the format. Write a good one that showcases Railway v4 commands, common patterns, and key flags.
  - Validation section example: use `railway` instead of `jq` in the example report
  - Keep `jq` mentioned in passing (e.g., in the Supported Tools table, in the Configuration section's registry example) — just don't lead with it
  - Add Railway to the Supported Tools table under a "Deployment" or "Infrastructure" category
  - Update `examples/` directory mention to include railway

  **Do NOT actually run `tool-docs distill` or generate real SKILL.md** (that requires an LLM). Just write a realistic example for the README by hand based on `railway --help` output and the existing jq example format.
