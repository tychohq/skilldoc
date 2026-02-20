# agent-tool-docs

[![version](https://img.shields.io/badge/version-0.2.0-blue)](package.json)
[![license](https://img.shields.io/badge/license-MIT-green)](#license)
[![works with](https://img.shields.io/badge/works%20with-Claude%20Code-purple)](https://claude.ai/claude-code)
[![works with](https://img.shields.io/badge/works%20with-Gemini%20CLI-orange)](https://github.com/google-gemini/gemini-cli)
[![works with](https://img.shields.io/badge/works%20with-OpenClaw-lightgrey)](https://github.com/brenner/openclaw)

**Auto-generate agent-optimized CLI docs from `--help` output — verified, compressed, ready for AGENTS.md**

---

## The Problem

AI agents guess at CLI flags from training data instead of reading accurate docs. Hand-written tool docs go stale as CLIs change. A typical `--help` page is 48KB — that's ~12K tokens per context load.

## The Solution

A three-stage pipeline turns raw `--help` output into a verified, compressed skill doc:

```
CLI --help
    ↓
extract     →  raw docs + structured JSON  (~48KB)
    ↓
distill     →  agent-optimized SKILL.md    (~2KB)
    ↓
validate    →  multi-model score 9/10+
    ↓
SKILL.md    →  drop into AGENTS.md, CLAUDE.md, OpenClaw skills
```

---

## Quick Start

```bash
# Install
git clone https://github.com/BrennerSpear/agent-tool-docs && cd agent-tool-docs
bun install && bun run build

# Generate a verified skill for jq (or any CLI tool)
tool-docs run jq

# Your agent-optimized skill is at ~/.agents/skills/jq/SKILL.md
```

`run` executes the full pipeline in one shot: generate → distill → validate. Drop `~/.agents/skills/jq/SKILL.md` into your `AGENTS.md`, `CLAUDE.md`, or OpenClaw skills directory. Your agent has verified docs instead of guessing from training data.

You can also run each step individually:

```bash
tool-docs generate jq    # extract raw docs from --help
tool-docs distill jq     # compress into agent-optimized SKILL.md
tool-docs validate jq    # score quality with multi-model evaluation
```

---

## Example Output

The `jq` SKILL.md — distilled from 48KB of `--help` into ~1KB:

```markdown
# jq

JSON processor for filtering, transforming, and extracting data.

## Quick Reference
jq '.field' file.json           # Extract field
jq '.[] | .name' file.json      # Extract from array
jq -r '.email' file.json        # Raw output (unquoted strings)
jq -s 'add' file1.json file2.json  # Merge arrays/objects
jq '.[] | select(.active)' file.json  # Filter elements

## Key Flags
| Flag | Purpose |
|------|----------|
| `-r` | Output strings without quotes (raw mode) |
| `-s` | Slurp: read all inputs into single array |
| `-n` | Start with null input (no file reading) |
| `-c` | Compact output (single line) |
| `--arg x v` | Bind `$x` to string value `v` |

## Common Patterns
Extract nested field: `jq '.user.address.city'`
Filter + transform: `jq '.items[] | select(.qty > 0) | .name'`
Use variables: `jq --arg role admin '.users[] | select(.role == $role)'`
```

See [`examples/`](examples/) for real generated output for `jq`, `gh`, `curl`, `ffmpeg`, and `rg`.

---

## How It Works

### 1. Extract (`generate`)

Runs each tool's `--help` (and subcommand help) with `LANG=C NO_COLOR=1 PAGER=cat` for stable, deterministic output. Parses usage lines, flags, subcommands, examples, and env vars into structured JSON + Markdown. Stores a SHA-256 hash for change detection.

```
~/.agents/docs/tool-docs/<tool-id>/
  tool.json        # structured parse
  tool.md          # rendered markdown
  commands/        # per-subcommand docs
    <command>/
      command.json
      command.md
```

### 2. Distill (`distill`)

Passes raw docs to an LLM (default: `claude-haiku-4-5`) with a task-focused prompt. Output is a `SKILL.md` optimized for agents: quick reference, key flags, common patterns. Target size ~2KB. Skips re-distillation if help output is unchanged.

### 3. Validate (`validate`)

Runs scenario-based evaluation across multiple LLM models. Each model attempts realistic tasks using only the SKILL.md, then scores itself 1–10 on accuracy, completeness, and absence of hallucinations. Threshold: 9/10.

```
tool-docs validate jq --models claude-sonnet-4-6,claude-opus-4-6 --threshold 9
```

### 4. Refresh (`refresh`)

Re-runs generate + distill only for tools whose `--help` output has changed (by hash). Use `--diff` to see what changed in the SKILL.md.

```bash
tool-docs refresh --diff
```

---

## Supported Tools

### Development
| Tool | Binary | Category |
|------|--------|----------|
| ✅ Git | `git` | Version control |
| ✅ GitHub CLI | `gh` | Code review / CI |
| ✅ ripgrep | `rg` | Search |

### Data & APIs
| Tool | Binary | Category |
|------|--------|----------|
| ✅ jq | `jq` | JSON processing |
| ✅ curl | `curl` | HTTP requests |

### Python Tooling
| Tool | Binary | Category |
|------|--------|----------|
| ✅ uv | `uv` | Package management |
| ✅ uvx | `uvx` | Ephemeral tool runner |

### Deployment
| Tool | Binary | Category |
|------|--------|----------|
| ✅ Vercel CLI | `vercel` | Frontend deployment |
| ✅ Supabase CLI | `supabase` | Database / backend |

### Media
| Tool | Binary | Category |
|------|--------|----------|
| ✅ FFmpeg | `ffmpeg` | Video / audio processing |

### AI & Agents
| Tool | Binary | Category |
|------|--------|----------|
| ✅ Claude Code | `claude` | AI coding agent |
| ✅ agent-browser | `agent-browser` | Browser automation |
| ✅ Ralphy | `ralphy` | AI coding loop runner |

Works with any CLI that has `--help` output. Add custom tools via registry entry (see [Configuration](#configuration)).

---

## Validation

Skills are evaluated by asking an LLM to complete realistic tasks using only the generated SKILL.md. Each scenario is graded 1–10 for correctness and absence of hallucinations.

Example report for `jq`:

```
validate jq (claude-sonnet-4-6, claude-opus-4-6)

claude-sonnet-4-6  average: 9.3/10
  Scenario 1: "extract all .name fields from an array of objects" → 9/10
  Scenario 2: "filter objects where .active is true, output .email" → 10/10
  Scenario 3: "merge two JSON files into a single array" → 9/10

claude-opus-4-6    average: 9.7/10
  Scenario 1: "extract all .name fields from an array of objects" → 10/10
  Scenario 2: "filter objects where .active is true, output .email" → 9/10
  Scenario 3: "merge two JSON files into a single array" → 10/10

overall: 9.5/10 — PASSED (threshold: 9)
```

If validation fails, `--auto-redist` re-runs distillation with feedback and you can re-validate.

---

## Output Format

```
~/.agents/skills/<tool-id>/
  SKILL.md          # compressed, agent-optimized (drop into AGENTS.md)
  docs/
    advanced.md     # extended reference
    recipes.md      # common patterns
    troubleshooting.md
```

`SKILL.md` is the primary file — small enough to include inline in any agent system prompt. The `docs/` subfolder holds overflow content for tools with complex help text.

---

## Configuration

For batch operations across many tools, use a registry file at `~/.agents/tool-docs/registry.yaml`:

```bash
tool-docs init        # create a starter registry with common tools
tool-docs generate    # extract docs for all registry tools
tool-docs distill     # distill all into agent-optimized skills
```

Registry format:

```yaml
version: 1
tools:
  - id: jq
    binary: jq
    displayName: jq (JSON processor)
    category: cli
    homepage: https://jqlang.github.io/jq
    useCases:
      - filter and transform JSON data
      - extract fields from API responses

  - id: git
    binary: git
    displayName: Git
    helpArgs: ["-h"]
    commandHelpArgs: ["help", "{command}"]
    useCases:
      - version control and branching
```

**Fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique identifier, used as directory name |
| `binary` | yes | Executable name on PATH |
| `helpArgs` | no | Args to invoke help (default: `["--help"]`) |
| `commandHelpArgs` | no | Args for subcommand help; `{command}` is replaced |
| `useCases` | no | Hints for distillation prompt |
| `enabled` | no | Set `false` to skip a tool without removing it |

Run `tool-docs generate --only jq` to process a single tool.

---

## Contributing

### Add a tool

```bash
tool-docs run <binary>   # full pipeline, score must be ≥ 9/10
```

Or add an entry to `~/.agents/tool-docs/registry.yaml` for batch operations with custom `helpArgs`.

### Run tests

```bash
bun test
```

### Build

```bash
bun run build   # outputs bin/tool-docs.js
```

---

## License

MIT
