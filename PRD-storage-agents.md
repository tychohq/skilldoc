# PRD: Storage Overhaul — .skills/ + Lock File + Multi-Agent Symlinks

## Overview
Migrate skilldoc from the current `~/.agents/skills/` + `~/.agents/tool-docs/registry.yaml` storage model to a `~/.skills/` canonical store with a `skilldoc-lock.yaml` lock file and per-agent symlink support.

## Background
Currently skills go to `~/.agents/skills/<tool>/SKILL.md` and tool configs live in `~/.agents/tool-docs/registry.yaml`. This is tightly coupled to one agent system. The new model (inspired by skilld) uses `~/.skills/` as the universal store, with opt-in symlinks into any agent's skill directory.

## Tasks

### Phase 1: Storage Migration

- [ ] **1.1** Change `DEFAULT_SKILLS_DIR` from `~/.agents/skills` to `~/.skills` in `src/distill.ts`
- [ ] **1.2** Change `DEFAULT_DOCS_DIR` from `~/.agents/docs/tool-docs` to `~/.skilldoc/docs` (raw docs cache)
- [ ] **1.3** Change `DEFAULT_REGISTRY` in `src/cli.ts` from `~/.agents/tool-docs/registry.yaml` to `~/.skilldoc/registry.yaml`
- [ ] **1.4** Change `DEFAULT_LLM_CONFIG_PATH` (in `src/llm.ts`) from whatever it currently is to `~/.skilldoc/config.yaml`
- [ ] **1.5** Change `DEFAULT_DISTILL_CONFIG_PATH` from `~/.agents/tool-docs/distill-config.yaml` to `~/.skilldoc/distill-config.yaml`
- [ ] **1.6** Update all help text, README references, and comments that reference old paths
- [ ] **1.7** Update tests — fix any hardcoded path expectations

### Phase 2: Lock File (skilldoc-lock.yaml)

- [ ] **2.1** Create `src/lock.ts` with types and read/write functions:
  ```typescript
  type LockEntry = {
    cliName: string;        // binary name
    version: string;        // from <tool> --version at generation time
    helpHash: string;       // SHA-256 of --help output at generation time
    source: string;         // "help" | "man" | "docs"
    syncedAt: string;       // ISO date (YYYY-MM-DD)
    generator: "skilldoc";
  };
  type LockFile = {
    skills: Record<string, LockEntry>;  // keyed by tool id
  };
  ```
- [ ] **2.2** Lock file lives at `~/.skills/skilldoc-lock.yaml`
- [ ] **2.3** After successful distill, write/update lock entry with current version + helpHash
- [ ] **2.4** `skilldoc update` command: read lock, for each entry run `<binary> --version`, compare against lock version. If version changed, regenerate. Also compare helpHash for tools where --version doesn't change but help text did.
- [ ] **2.5** `skilldoc list` command: read lock, pretty-print installed skills with version + syncedAt
- [ ] **2.6** `skilldoc remove <tool>` command: remove skill dir + lock entry + any symlinks
- [ ] **2.7** Write tests for lock read/write/update cycle

### Phase 3: Multi-Agent Symlinks

- [ ] **3.1** Create `src/agents.ts` with agent target registry:
  ```typescript
  type AgentTarget = {
    name: string;          // "claude", "cursor", "codex", "gemini", "openclaw", etc.
    flag: string;          // "--claude", "--cursor", etc.
    globalSkillsDir: string; // e.g. "~/.claude/skills", "~/.cursor/rules", "~/.openclaw/workspace/skills"
    detect: () => boolean; // check if agent is installed
  };
  ```
  Supported agents (at minimum):
  - `--claude` → `~/.claude/skills/<tool>/` (symlink to `~/.skills/<tool>/`)
  - `--cursor` → `~/.cursor/rules/<tool>/` (symlink)
  - `--codex` → `~/.codex/skills/<tool>/` (symlink)
  - `--openclaw` → `~/.openclaw/workspace/skills/<tool>/` (symlink) — note: this is the actual openclaw skills path, verify with `ls ~/.openclaw/workspace/skills/` at runtime
  - `--global` → symlink to ALL detected/installed agents
- [ ] **3.2** Add `--dir <path>` flag: creates a symlink from `<path>/<tool>/` → `~/.skills/<tool>/`
- [ ] **3.3** Wire agent flags into `skilldoc add` (the new name for `skilldoc run` single-tool mode, or add as post-generation step)
- [ ] **3.4** Store active symlinks in the lock entry so `skilldoc remove` can clean them up:
  ```yaml
  skills:
    jq:
      cliName: jq
      version: "jq-1.7.1"
      helpHash: "abc123..."
      source: help
      syncedAt: 2026-02-23
      generator: skilldoc
      links:
        - ~/.claude/skills/jq
        - ~/.openclaw/workspace/skills/jq
  ```
- [ ] **3.5** `skilldoc remove <tool>` removes all tracked symlinks too
- [ ] **3.6** Write tests: symlink creation, removal, --global detection

### Phase 4: CLI Interface Updates

- [ ] **4.1** Add `skilldoc add <tool>` as the primary entry point (alias for `run` single-tool). Supports: `--claude`, `--cursor`, `--codex`, `--openclaw`, `--global`, `--dir <path>`
- [ ] **4.2** Add `skilldoc update [tool]` — version-check + regenerate stale skills
- [ ] **4.3** Add `skilldoc list` — show installed skills from lock file
- [ ] **4.4** Add `skilldoc remove <tool>` — remove skill + lock entry + symlinks
- [ ] **4.5** Keep `skilldoc run`, `skilldoc generate`, `skilldoc distill` working (backwards compat)
- [ ] **4.6** Update help text to reflect new commands and flags
- [ ] **4.7** Update README.md

### Phase 5: Validation

- [ ] **5.1** `bun test` passes
- [ ] **5.2** `bun run build` succeeds
- [ ] **5.3** Manual test: `skilldoc add jq --claude` creates `~/.skills/jq/SKILL.md` + symlink at `~/.claude/skills/jq/`
- [ ] **5.4** Manual test: `skilldoc list` shows jq with version
- [ ] **5.5** Manual test: `skilldoc remove jq` cleans up everything

## Non-Goals
- Semantic search / sqlite-vec indexing (v2)
- Project-level `.skills/` directory (v2 — for now, always global `~/.skills/`)
- Auto-detection of which agents to symlink to (explicit flags only, except `--global`)

## Notes
- The `registry.yaml` concept still works for batch operations but moves to `~/.skilldoc/registry.yaml`
- The lock file is the source of truth for what's installed, the registry is for batch config
- Symlinks are relative where possible for portability, absolute where needed
- Don't break existing `skilldoc run <tool>` — it should still work, just output to the new location
