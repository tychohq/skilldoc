# skilldoc

[![npm](https://img.shields.io/npm/v/skilldoc)](https://www.npmjs.com/package/skilldoc)
[![license](https://img.shields.io/badge/license-MIT-green)](#license)
[![works with](https://img.shields.io/badge/works%20with-Claude%20Code-purple)](https://claude.ai/claude-code)
[![works with](https://img.shields.io/badge/works%20with-Gemini%20CLI-orange)](https://github.com/google-gemini/gemini-cli)
[![works with](https://img.shields.io/badge/works%20with-OpenClaw-lightgrey)](https://github.com/openclaw/openclaw)

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

> **Note:** The distill and validate steps require an LLM — either a coding CLI (Claude Code, Codex, or Gemini CLI) logged in, or an API key set. See [LLM Setup](#llm-setup) for details.

### Install

```bash
# Homebrew (macOS / Linux)
brew tap tychohq/tap && brew install skilldoc

# bun
bunx skilldoc run railway

# pnpm
pnpx skilldoc run railway

# npm
npx skilldoc run railway
```

### Generate a skill

```bash
# Full pipeline in one shot: generate → distill → validate
skilldoc run railway

# Your agent-optimized skill is at ~/.agents/skills/railway/SKILL.md
```

Drop `~/.agents/skills/railway/SKILL.md` into your `AGENTS.md`, `CLAUDE.md`, or OpenClaw skills directory. Your agent has verified docs instead of guessing from training data.

You can also run each step individually:

```bash
skilldoc generate railway    # extract raw docs from --help
skilldoc distill railway     # compress into agent-optimized SKILL.md
skilldoc validate railway    # score quality with multi-model evaluation
```

---

## LLM Setup

The `generate` step works without an LLM. The `distill` and `validate` steps require one.

**If you have a coding CLI installed and logged in, it just works — no config needed.** The tool auto-detects Claude Code → Codex → Gemini CLI (first found on PATH wins).

**If you prefer API keys**, set any of these:

```bash
export ANTHROPIC_API_KEY=sk-ant-...     # → Anthropic API
export OPENAI_API_KEY=sk-...            # → OpenAI API
export GEMINI_API_KEY=...               # → Google Gemini API
export OPENROUTER_API_KEY=sk-or-...     # → OpenRouter API
```

API keys are checked only if no CLI is found. Each provider uses a sensible default model.

<details>
<summary><strong>CLI verification commands</strong></summary>

```bash
echo 'say ok' | claude -p --output-format text  # should print "ok"
echo 'say ok' | codex exec                       # should print "ok"
gemini -p 'say ok'                                # should print "ok"
```

</details>

<details>
<summary><strong>Persistent config (pin provider/model)</strong></summary>

Create `~/.skilldoc/config.yaml`:

```yaml
provider: claude-cli    # claude-cli | codex-cli | gemini-cli | anthropic | openai | gemini | openrouter
model: claude-opus-4-6 # optional — overrides the provider's default model
apiKey: sk-ant-...      # optional — overrides env var for this provider
```

Config file takes priority over auto-detection. You can also override per-run with `--model <model>`.

For validation, `--models <m1,m2>` accepts a comma-separated list to test across multiple models.

</details>

---

## Example Output

Railway v4 overhauled its CLI — models trained on v3 still hallucinate `railway run` for deployments and miss the new `variable set` subcommand syntax. Here's the generated SKILL.md (~1.5KB, distilled from 52KB of `--help`):

```markdown
# Railway CLI

Deploy and manage cloud applications with projects, services, environments, and databases.

## Critical Distinctions
- `up` uploads and deploys your code from the current directory
- `deploy` provisions a *template* (e.g., Postgres, Redis) — NOT for deploying your code
- `run` executes a local command with Railway env vars injected — it does NOT deploy anything

## Quick Reference
railway up                          # Deploy current directory
railway up -s my-api                # Deploy to specific service
railway logs -s my-api              # View deploy logs
railway variable set KEY=VAL        # Set env var
railway connect                     # Open database shell (psql, mongosh, etc.)

## Key Commands
| Command | Purpose |
|---------|---------|
| `up [-s service] [-d]` | Deploy from current dir; `-d` to detach from log stream |
| `variable set KEY=VAL` | Set env var; add `--skip-deploys` to skip redeployment |
| `variable list [-s svc]` | List variables; `--json` for JSON output |
| `link [-p project] [-s svc]` | Link current directory to a project/service |
| `service status` | Show deployment status across services |
| `logs [-s service]` | View build/deploy logs |
| `connect` | Open database shell (auto-detects Postgres, MongoDB, Redis) |
| `domain` | Add custom domain or generate a Railway-provided domain |

## Common Patterns
Deploy with message: `railway up -m "fix auth bug"`
Set var without redeploying: `railway variable set API_KEY=sk-123 --skip-deploys`
Stream build logs then exit: `railway up --ci`
Run local dev with Railway env: `railway run npm start`
```

See [`examples/`](examples/) for real generated output for `railway`, `jq`, `gh`, `curl`, `ffmpeg`, and `rg`.

---

## How It Works

### 1. Extract (`generate`)

Runs each tool's `--help` (and subcommand help) with `LANG=C NO_COLOR=1 PAGER=cat` for stable, deterministic output. Parses usage lines, flags, subcommands, examples, and env vars into structured JSON + Markdown. Stores a SHA-256 hash for change detection.

```
~/.agents/docs/skilldoc/<tool-id>/
  tool.json        # structured parse
  tool.md          # rendered markdown
  commands/        # per-subcommand docs
    <command>/
      command.json
      command.md
```

### 2. Distill (`distill`)

Passes raw docs to an LLM with a task-focused prompt. Output is a `SKILL.md` optimized for agents: quick reference, key flags, common patterns. Target size ~2KB. Skips re-distillation if help output is unchanged.

### 3. Validate (`validate`)

Runs scenario-based evaluation across multiple LLM models. Each model attempts realistic tasks using only the SKILL.md, then scores itself 1–10 on accuracy, completeness, and absence of hallucinations. Threshold: 9/10.

```
skilldoc validate railway --models claude-sonnet-4-6,claude-opus-4-6 --threshold 9
```

### 4. Refresh (`refresh`)

Re-runs generate + distill only for tools whose `--help` output has changed (by hash). Use `--diff` to see what changed in the SKILL.md.

```bash
skilldoc refresh --diff
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

### Deployment & Infrastructure
| Tool | Binary | Category |
|------|--------|----------|
| ✅ Railway CLI | `railway` | Cloud deployment |
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

Example report for `railway`:

```
validate railway (claude-sonnet-4-6, claude-opus-4-6)

claude-sonnet-4-6  average: 9.3/10
  Scenario 1: "deploy the current directory to a specific service" → 10/10
  Scenario 2: "set an env var without triggering a redeploy" → 9/10
  Scenario 3: "connect to the project's Postgres database" → 9/10

claude-opus-4-6    average: 9.7/10
  Scenario 1: "deploy the current directory to a specific service" → 10/10
  Scenario 2: "set an env var without triggering a redeploy" → 10/10
  Scenario 3: "connect to the project's Postgres database" → 9/10

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

For batch operations across many tools, use a registry file at `~/.agents/skilldoc/registry.yaml`:

```bash
skilldoc init        # create a starter registry with common tools
skilldoc run         # full pipeline for all registry tools
```

You can also run individual steps across the registry:

```bash
skilldoc generate    # extract docs for all registry tools
skilldoc distill     # distill all into agent-optimized skills
```

<details>
<summary><strong>Registry format</strong></summary>

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

Run `skilldoc generate --only jq` to process a single tool.

</details>

---

## Contributing

### Add a tool

```bash
skilldoc run <binary>   # full pipeline, score must be ≥ 9/10
```

Or add an entry to `~/.agents/skilldoc/registry.yaml` for batch operations with custom `helpArgs`.

### Run tests

```bash
bun test
```

### Build

```bash
bun run build   # outputs bin/skilldoc.js
```

---

## License

MIT
