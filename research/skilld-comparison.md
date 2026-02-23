# skilld Comparison — What to Adopt

Source: https://github.com/harlan-zw/skilld (Harlan Wilton)

## Their Architecture

skilld generates agent skills from **npm package docs** — READMEs, llms.txt, crawled doc sites, GitHub issues/discussions/releases. It uses LLMs (Claude Code, Gemini CLI, Codex) to produce curated "API Changes" and "Best Practices" sections.

Our tool (skilldoc) generates skills from **CLI `--help` output** — different input, same output format.

## What We Should Adopt

### 1. `.skills/` as Default Output Dir
- skilld uses a shared `.skills/` directory at project root
- Symlinks into each agent's convention dir (`.claude/skills/`, `.cursor/rules/`, etc.)
- One generation, multi-agent consumption
- **For us:** Default to `~/.skills/` (global) or `.skills/` (project-local), with agent-specific symlinks

### 2. `skilldoc-lock.yaml` (replaces our "registry" concept)
Format from skilld:
```yaml
skills:
  jq:
    cliName: jq
    version: "1.7.1"           # from jq --version
    source: "help"             # or "man", "docs"
    syncedAt: 2026-02-23
    generator: skilldoc
  rg:
    cliName: rg
    version: "14.1.1"
    source: "help"
    syncedAt: 2026-02-23
    generator: skilldoc
```
- Tracks what was generated, when, from what version
- Lives alongside skills in `.skills/skilldoc-lock.yaml`
- Enables `skilldoc update` to detect staleness by comparing lock version vs current `tool --version`

### 3. Version-Based Update Detection
- `skilldoc update` reads lock, runs `<tool> --version`, compares
- If version changed → regenerate
- Hook: `"prepare": "skilldoc update -b"` for auto-update on install

### 4. Multi-Agent Install Targets
skilld supports 11 agents. Their target system:
```
skillsDir: '.claude/skills'          # project-level
globalSkillsDir: '~/.claude/skills'  # user-level (--global)
```

For skilldoc:
- `skilldoc add jq` → generates to `.skills/jq/SKILL.md` + symlinks to detected agents
- `skilldoc add jq --global` → generates to `~/.skills/jq/SKILL.md` + symlinks to `~/.claude/skills/`, etc.
- `skilldoc add jq --agent claude-code` → target specific agent only
- `skilldoc install --dir ~/projects/myapp/.claude/skills` → copy/link into specific project

### 5. `skilldoc search` — Dynamic Context Loading (Not Dynamic Skills)

**This is NOT dynamic skill loading.** Here's what it actually is:

skilld stores raw reference material alongside the SKILL.md:
```
.skills/vue-skilld/
├── SKILL.md              ← the skill (loaded by agent at startup)
└── .skilld/              ← raw references (NOT loaded by agent)
    ├── pkg/              ← package.json, README, .d.ts files
    ├── docs/             ← crawled documentation pages
    ├── issues/           ← GitHub issues as markdown
    ├── releases/         ← release notes
    └── search.db         ← sqlite-vec embeddings of all the above
```

The agent reads SKILL.md at startup (the curated, compressed skill).
When the agent needs **deeper info** during a task, the SKILL.md tells it:
```
## Search
Use `npx -y skilld search` instead of grepping `.skilld/` directories
```

So the agent calls `skilld search "useFetch timeout" -p nuxt` via its Bash tool, gets back
semantic search results from the sqlite-vec index, and uses those as additional context.

**It's a two-tier architecture:**
- **Tier 1:** SKILL.md — always loaded, ~2-6KB, curated best practices + API changes
- **Tier 2:** `skilld search` — on-demand, deeper retrieval from raw docs/issues/releases

This is clever because it keeps the skill small (token-efficient) while still giving
the agent access to the full doc corpus when needed.

**For skilldoc:** We could do the same thing:
- Tier 1: SKILL.md from distilled --help (what we already do)
- Tier 2: Store raw --help, man pages, etc. in `.skilld/` and index with sqlite-vec
- Agent can `skilldoc search "parallel jobs" -p make` for deeper detail

But this is a v2 feature — our v1 already has the distilled skill, and CLI help output
is usually small enough to fit entirely in a good skill file.

## What's NOT Relevant

- npm registry integration (we're CLI-focused)
- Doc site crawling (mdream, ungh proxying)
- GitHub issues/discussions scraping (our input is `--help`)
- LLM-based generation of "API Changes" sections (we extract from help directly)
- Prompt injection sanitization of external docs (our input is local CLI output, trusted)

## Comparison Table

|                     | **skilld**                        | **skilldoc**                    |
|---------------------|-----------------------------------|---------------------------------|
| Input               | npm docs, issues, releases        | CLI `--help` output             |
| LLM use             | Generate best practices sections  | Distill help → compact skill    |
| Storage             | `.skills/` + symlinks             | `.skills/` + symlinks (adopt)   |
| Lock file           | `skilld-lock.yaml`                | `skilldoc-lock.yaml` (adopt)    |
| Version tracking    | npm registry version              | CLI `--version` output (adopt)  |
| Update trigger      | `skilld update` on version bump   | `skilldoc update` (adopt)       |
| Multi-agent         | 11 agent targets                  | Multi-agent via symlinks (adopt)|
| Search              | sqlite-vec semantic search        | v2 maybe                        |
| Scope               | JS/TS ecosystem only              | Any CLI tool                    |
