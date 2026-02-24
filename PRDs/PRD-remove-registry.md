# PRD: Remove Registry, Enhance Lock File + Help Detection

## Overview

Remove the registry (`~/.skilldoc/registry.yaml`) as a concept. The lock file (`~/.skills/skilldoc-lock.yaml`) becomes the single source of truth for all tool metadata. Also fix help detection for CLIs that use non-standard help invocations (e.g., `aws help` instead of `aws --help`).

## Motivation

- The registry duplicates what the lock file already tracks
- Users shouldn't need to maintain a YAML config file to batch-process tools
- `skilldoc add <tool>` / `skilldoc list` / `skilldoc update` already use the lock file
- The registry's extra fields (`helpArgs`, `commandHelpArgs`, `useCases`, `complexity`) should either move to the lock file or be auto-detected

## Tasks

### Phase 1: Help Detection Fallback

When `--help` produces empty/minimal output (no commands AND no options detected), automatically try fallback help invocations:

- [ ] **1.1** After running `<binary> --help`, check if result has zero commands AND zero options
- [ ] **1.2** If so, try these fallbacks in order: `<binary> help`, `<binary> -h`, `<binary>` (no args, for tools that print help with no args)
- [ ] **1.3** Use whichever produces the most content (most commands + options)
- [ ] **1.4** Store the winning `helpArgs` in the lock file entry so future `update`/`refresh` reuses it
- [ ] **1.5** For subcommand help, try: `<binary> <cmd> --help`, `<binary> help <cmd>`, `<binary> <cmd> -h`
- [ ] **1.6** Store the winning `commandHelpArgs` pattern in the lock file entry
- [ ] **1.7** Add tests for aws-style CLIs that use `help` instead of `--help`

### Phase 2: Migrate Registry Fields to Lock File

- [ ] **2.1** Add optional fields to `LockEntry` type in `src/lock.ts`:
  ```typescript
  helpArgs?: string[];           // e.g. ["help"] for aws
  commandHelpArgs?: string[];    // e.g. ["help", "{command}"] for aws
  useCases?: string[];           // hints for distillation
  complexity?: "simple" | "complex";
  ```
- [ ] **2.2** When `skilldoc add <tool>` or `skilldoc run <tool>` runs, store discovered helpArgs/commandHelpArgs in the lock entry
- [ ] **2.3** On `skilldoc update`, read helpArgs from lock entry instead of registry

### Phase 3: Remove Registry

- [ ] **3.1** Remove `src/config.ts` (registry loading) — or gut it to only handle `~/.skilldoc/config.yaml` (LLM config)
- [ ] **3.2** Remove `handleInit` from `src/cli.ts` (creates sample registry)
- [ ] **3.3** Remove `init` command from CLI help text
- [ ] **3.4** Change batch commands (`skilldoc run` with no arg, `skilldoc generate` with no arg, `skilldoc distill` with no arg) to iterate lock file entries instead of registry
- [ ] **3.5** Remove `--registry` flag from all commands
- [ ] **3.6** Remove `--only` flag (or repurpose as a filter on lock file entries)
- [ ] **3.7** Remove `DEFAULT_REGISTRY` constant
- [ ] **3.8** Update all tests that reference registry — either delete or convert to lock-file-based
- [ ] **3.9** Remove registry references from README.md
- [ ] **3.10** Update AGENTS.md

### Phase 4: Config Cleanup

- [ ] **4.1** If `src/config.ts` still exists, it should only handle `~/.skilldoc/config.yaml` (LLM provider config) and `~/.skilldoc/distill-config.yaml` (distill prompt config)
- [ ] **4.2** Remove `RegistryTool` type from `src/types.ts` if no longer needed
- [ ] **4.3** Remove `Registry` type from `src/types.ts`

## Validation

```bash
bun test        # all tests pass
bun run build   # builds clean

# Functional:
skilldoc run jq          # single tool still works
skilldoc add aws         # auto-detects aws uses 'help' not '--help'
skilldoc list            # shows installed tools from lock file
skilldoc update          # re-runs all lock file entries
skilldoc run             # batch runs all lock file entries (was registry)
```

## Non-Goals

- Don't change the LLM config (`~/.skilldoc/config.yaml`) — that stays
- Don't change the distill config (`~/.skilldoc/distill-config.yaml`) — that stays
- Don't change the output format (SKILL.md + docs/)

## Notes

- The `complexity` field (simple/complex) affects token limits in distillation. If not stored in lock, use a heuristic: tools with >5 subcommands = complex, else simple.
- The `useCases` field was only used as hints in the distill prompt. Can be dropped — the LLM infers use cases from the help text.
- `--only` flag could be kept as a glob/filter on `skilldoc run` to process a subset of locked tools.
