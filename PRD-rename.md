# PRD: Rename agent-tool-docs → skilldoc

## Context
Renaming the project from `agent-tool-docs` to `skilldoc`. Moving GitHub repo from `BrennerSpear/agent-tool-docs` to `tychohq/skilldoc`. npm package name changes from `agent-tool-docs` to `skilldoc`.

## Rules
- The CLI command becomes `skilldoc` (no aliases like `tool-docs`)
- The npm package name becomes `skilldoc`
- The GitHub repo becomes `tychohq/skilldoc`
- Config directory: `~/.skilldoc/` (was `~/.agent-tool-docs/`)
- Raw docs output path stays at `~/.agents/docs/tool-docs/` (this is a user-facing convention, don't change)
- Registry path stays at `~/.agents/tool-docs/registry.yaml` (same reason)
- Skill output stays at `~/.agents/skills/<tool>/` (same reason)
- The `generated-from:` marker in skills changes to `generated-from: skilldoc`
- Do NOT create the GitHub repo or push — just update all local files

## Tasks

### Task 1: Update package.json
- `name`: `"skilldoc"`
- `description`: update to mention skilldoc
- `homepage`: `https://github.com/tychohq/skilldoc`
- `repository.url`: `git+https://github.com/tychohq/skilldoc.git`
- `bin`: `{ "skilldoc": "bin/skilldoc.js" }` (single entry, new filename)
- `files`: update `bin/tool-docs.js` → `bin/skilldoc.js`

### Task 2: Rename bin/tool-docs.js → bin/skilldoc.js
- Rename the file
- Update the build script in package.json: `--outfile bin/skilldoc.js`
- Update postbuild: `chmod +x bin/skilldoc.js`

### Task 3: Update src/cli.ts
- All help text: replace `tool-docs` with `skilldoc`
- Config template comment: `# skilldoc LLM configuration`
- GitHub URL references: `tychohq/skilldoc`
- Config path references: `~/.skilldoc/config.yaml`

### Task 4: Update src/llm.ts
- Config path: `~/.agent-tool-docs/config.yaml` → `~/.skilldoc/config.yaml`
- Error messages referencing the old path

### Task 5: Update src/distill.ts
- `GENERATED_MARKER`: `"generated-from: skilldoc"`

### Task 6: Update all test files
- Any references to `agent-tool-docs`, `tool-docs` CLI commands, or old paths
- The binary name in test assertions

### Task 7: Update README.md
- All `npx agent-tool-docs` → `npx skilldoc`
- All `tool-docs` CLI examples → `skilldoc`
- GitHub URLs → `tychohq/skilldoc`
- npm badge URLs
- Any old name references

### Task 8: Update AGENTS.md
- Project description and references
- The bin entry path

### Task 9: Update other markdown files
- `meta-AGENTS.md`, `PRD.md`, `PRD-llm-providers.md`, `FUTURE-PRD.md`, `PARSER-FIX-PRD.md`
- `examples/README.md` and any example SKILL.md files with old references

### Task 10: Update example SKILL.md files
- Change `generated-from: agent-tool-docs` to `generated-from: skilldoc` in all example skills

### Task 11: Rebuild
- Run `bun run build` to regenerate the binary
- Run `bun test` — all tests must pass

## Validation
- `grep -rn "agent-tool-docs\|tool-docs" src/ test/ bin/ package.json README.md AGENTS.md` should return ZERO results (except the raw docs output path `~/.agents/docs/tool-docs/` and registry path `~/.agents/tool-docs/` which intentionally stay)
- `bun test` passes
- `bun run build` succeeds
- `node bin/skilldoc.js --help` works and shows `skilldoc` branding
