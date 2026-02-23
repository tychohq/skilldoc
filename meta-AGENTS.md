# meta-AGENTS.md — Distillation Prompt Engineering Lessons

This document captures what we learned building the distillation pipeline: taking raw CLI `--help` output (often 20–50KB) and producing lean, agent-optimized skill files that score 9/10+ on practical task completion.

## The Core Problem

Raw CLI docs are written for humans skimming a man page, not agents executing one-shot tasks. They're exhaustive, alphabetically sorted, and bury the 5 most common patterns under 80 rarely-used flags. Agents reading raw docs hallucinate flags, miss quoting requirements, and produce syntactically wrong commands.

The distillation goal: **compress to the 20% of information that covers 80% of real use cases**, formatted specifically for how agents read and use documentation.

---

## Lesson 1: SKILL.md is the Only File That Matters (Most of the Time)

Agents load SKILL.md first on ~90% of requests. Everything else (advanced.md, recipes.md, troubleshooting.md) is supplementary. When in doubt, put essential information in SKILL.md.

**Prompt language that works:**
> "SKILL.md is the most important file — agents read it first on 90% of requests. When in doubt, put essential information in SKILL.md."

This explicit prioritization prevents the model from distributing content evenly across all files. Without it, it spreads flags uniformly and SKILL.md becomes a useless summary.

---

## Lesson 2: Hard Size Budgets Enforce Ruthless Compression

Size limits per file (enforced post-generation with byte-level checks):
- `SKILL.md`: ≤ 2000 bytes
- `advanced.md`: ≤ 2000 bytes
- `recipes.md`: ≤ 2000 bytes
- `troubleshooting.md`: ≤ 1000 bytes

**The prompt must state these limits explicitly and tell the model to prefer returning less:**
> "Per-file size targets (strict — return less content rather than exceed these)"

The phrase "return less content rather than exceed these" is critical. Without it, models pad content to fill space. With it, they learn that compression is the correct behavior, not a failure.

Troubleshooting gets the tightest budget (1000 bytes) because it's the most-padded section in raw docs and the least-read by agents.

---

## Lesson 3: Prioritization Order Drives Quality

Tell the model explicitly what to prioritize across all files, in order:

1. Most-used flags/commands first — the 20% covering 80% of real-world use
2. Real-world usage patterns over exhaustive flag lists
3. Agent-specific gotchas — quoting, escaping, common errors, LLM misuse patterns, output format surprises
4. Concrete runnable examples over abstract descriptions

The 80/20 framing is not decoration — it changes what the model selects. Without it, models default to exhaustive coverage in alphabetical order (how man pages are structured). With it, they front-load the commands users actually run.

---

## Lesson 4: Specify Format Structure Per File

Each output file needs an explicit format template in the prompt. Without format specs, models invent their own structure and produce inconsistent output that's harder for agents to parse.

**What works:**

```
SKILL.md format:
# <tool display name>
<one-line description>
## Quick Reference
```<binary> <most common usage>```
## Key Commands / Flags
<concise table or list of 5-10 most important commands/flags>
## Common Patterns
<3-5 concrete examples covering the most common use cases>
```

The `## Quick Reference` → `## Key Commands / Flags` → `## Common Patterns` ordering matches how agents actually use docs: they check if they have the right tool first, then look for the specific flag, then look for a usage pattern.

For troubleshooting, the **Symptom/Fix** structure is critical. It maps directly to how agents encounter errors and search for solutions. The "Common LLM Mistakes" section is unique to agent-optimized docs — it's the section that directly prevents hallucinations.

---

## Lesson 5: Demand JSON Output, Strip Markdown Fences Defensively

Requesting JSON output gives you structured, parseable output across all 4 files in one LLM call. The alternative (4 separate prompts, one per file) is 4× the cost and creates consistency problems.

**What models do wrong:**
- Wrap JSON in markdown fences (` ```json ... ``` `)
- Sometimes add prose before or after the JSON

**Parse defensively:**
```typescript
const stripped = output.trim()
  .replace(/^```(?:json)?\n?/, "")
  .replace(/\n?```$/, "")
  .trim();
```

Always validate the presence of all required keys before using the output. Missing keys are a signal that the model misunderstood the prompt, not a recoverable error.

---

## Lesson 6: Handle Sparse Docs Explicitly

When raw docs are incomplete (e.g., `--help` returns "No commands detected"), naive models return an error or incomplete JSON. Fix this with an explicit instruction:

> "IMPORTANT: Always return valid JSON, even if the raw docs are sparse or show warnings like 'No commands detected.' If the raw docs are incomplete, use your general knowledge of the tool to produce useful documentation. Do not explain the issue in prose — just return the JSON."

This prevents a class of pipeline failures where one sparse tool breaks a batch job.

---

## Lesson 7: Validation Uses the Same LLM-as-Agent Pattern

The validation loop uses two prompts:

**Scenario generation prompt:**
> "You are evaluating skill documentation quality... generate exactly 4 test scenarios that would test whether an AI agent could effectively use this documentation."

4 scenarios is the sweet spot — enough coverage to catch gaps, few enough to run affordably across multiple models.

**Evaluation prompt (critical design):**
> "You are an AI agent that has ONLY been given the following documentation. Do NOT use any prior knowledge about the tool beyond what is in this documentation."

This constraint is what makes the evaluation meaningful. Without "ONLY" and "Do NOT use any prior knowledge", models cheat using their training data and score documentation as if it's perfect even when it's missing critical information.

The 4-criterion scoring (completed, correct, hallucinated, missing) gives structured, actionable feedback rather than just a number.

---

## Lesson 8: Multi-Model Validation Catches Model-Specific Hallucinations

Default validation models: Sonnet + Opus. Scenarios are generated once from the primary model, then each model evaluates independently. This catches cases where one model knows a tool well enough to compensate for missing docs while another hallucinates.

Generate scenarios once, evaluate per model. This ensures all models are tested on the same tasks.

---

## Lesson 9: Feedback Loop Closes the Quality Gap

When a skill scores below 9/10, inject validation feedback directly into the distillation prompt:

```
## Validation Feedback

A previous version of this skill was tested by AI agents and received a failing score. Please address these issues:

<aggregated missing info and hallucination patterns>

Fix the above gaps in your new distillation.
```

The feedback is built from the validation scorecard: aggregated missing-info strings and task names where hallucination occurred. This is not a free-form critique — it's structured signal extracted from the structured scorecard.

One auto-redist pass is usually enough to address specific missing info. Hallucination issues (where the skill documents non-existent flags) require more targeted edits.

---

## Lesson 10: Protect Hand-Written Skills

Generated SKILL.md files get a YAML frontmatter marker:

```yaml
---
generated-from: skilldoc
---
```

Before overwriting any existing SKILL.md, check for this marker. Files without it were written by a human and should never be overwritten by the pipeline. This prevents silent destruction of curated work.

---

## Anti-Patterns to Avoid

- **Exhaustive flag lists** — alphabetical coverage of all flags. Models default to this. Fight it explicitly with the 80/20 framing.
- **Padding with prose** — "This flag is useful when you want to..." style explanations. The size budget eliminates this if enforced.
- **Symmetric content across files** — SKILL.md and advanced.md with similar content. The SKILL.md priority instruction prevents this.
- **Generic examples** — `command --flag value`. Examples must be runnable with real-looking arguments.
- **Missing quoting guidance** — the most common agent error is shell quoting. The agent-specific gotchas section must address this explicitly for any tool that takes regex, glob, or multi-word arguments.
- **Separate LLM calls per file** — 4 calls instead of 1. Use JSON output to get all files in a single call.

---

## Pipeline Summary

```
--help output (raw)
    ↓ generate
tool.md + command docs (~10-50KB)
    ↓ distill (LLM, JSON prompt)
SKILL.md + advanced.md + recipes.md + troubleshooting.md (~7KB total)
    ↓ validate (LLM-as-agent, 4 scenarios × N models)
score report + feedback
    ↓ auto-redist (if score < 9/10)
improved SKILL.md (feedback injected into distill prompt)
```

The pipeline is designed to run unattended. Each step is deterministic enough to be testable (injectable exec functions, parsed structured outputs) and recoverable (sparse docs handled, size warnings surfaced, hand-written skills protected).
