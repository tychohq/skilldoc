# Ad-Hoc Tool Mode — PRD

**Goal:** Let users generate skills for any CLI tool without touching a registry file. Just pass the binary name.

---

## The Problem

Current UX requires: `tool-docs init` → edit registry YAML → `tool-docs generate --only jq` → `tool-docs distill --only jq`. That's 3 steps of ceremony before anything useful happens.

The ideal first experience is:

```bash
tool-docs generate jq
tool-docs distill jq
tool-docs validate jq
```

Pass a tool name, get a skill. No registry, no config, no init.

---

## Tasks

### Phase 1: Ad-Hoc Mode for `generate`

- [x] Accept a positional argument after `generate`: `tool-docs generate <binary-name>`
- [x] When a positional arg is given (no `--registry` and not in the registry), auto-detect the binary on PATH using `which`
- [x] Create an in-memory tool entry with sensible defaults: `id = binary name`, `helpArgs = ["--help"]`, `displayName = binary name`
- [x] Run generation for that single tool, outputting to the same default location (`~/.agents/docs/tool-docs/<id>/`)
- [x] If the binary isn't found on PATH, print a clear error: `Error: binary "xyz" not found on PATH`
- [x] If a positional arg is given AND the tool exists in the registry, use the registry entry (registry takes precedence for custom helpArgs etc.)
- [x] The `--only` flag still works as before for batch registry operations

### Phase 2: Ad-Hoc Mode for `distill`

- [x] Accept a positional argument: `tool-docs distill <tool-id>`
- [x] When given, distill just that one tool (looks for raw docs in the standard location)
- [x] If raw docs don't exist yet, print: `Error: no raw docs found for "jq". Run "tool-docs generate jq" first.`

### Phase 3: Update Quick Start

- [x] Rewrite README Quick Start to use the simple ad-hoc flow:
  ```bash
  # Install
  git clone https://github.com/BrennerSpear/agent-tool-docs && cd agent-tool-docs
  bun install && bun run build

  # Generate a skill for jq (or any CLI tool)
  tool-docs generate jq
  tool-docs distill jq
  tool-docs validate jq

  # Your agent-optimized skill is at ~/.agents/skills/jq/SKILL.md
  ```
- [x] Keep the registry explanation further down in the README for batch/custom use cases
- [x] Update the --help output to show the positional arg usage

### Phase 4: Update Help Text

- [x] Update the CLI usage text to show both modes:
  ```
  Usage:
    tool-docs generate <tool>                    # generate docs for a single tool
    tool-docs generate [--registry <path>] ...   # generate from registry
    tool-docs distill <tool>                     # distill a single tool
    tool-docs distill [--registry <path>] ...    # distill from registry
  ```

---

### Phase 5: All-in-One Command

- [x] Add `tool-docs run <tool>` command that runs the full pipeline: generate → distill → validate
- [x] On success, print the path to the generated SKILL.md and the validation score
- [x] On validation failure, print the score and suggest `--auto-redist` to retry
- [ ] Also support batch mode: `tool-docs run` (no arg) runs the full pipeline for all registry tools
- [ ] Update help text and README to show `run` as the recommended first command:
  ```
  tool-docs run jq    # generate + distill + validate in one shot
  ```

### Phase 6: Clarify `init`

- [ ] Update `tool-docs init` help text to explain what it creates: "Creates a starter registry file at ~/.agents/tool-docs/registry.yaml with example tool entries (git, ripgrep). Use this to configure batch generation for multiple tools."
- [ ] When `init` runs, print a clear message showing what was created AND what to do next:
  ```
  Created registry: ~/.agents/tool-docs/registry.yaml

  The registry defines tools for batch generation. Edit it to add your tools, then:
    tool-docs generate    # generate docs for all registry tools
    tool-docs distill     # distill all into agent-optimized skills

  Or skip the registry and generate skills for individual tools:
    tool-docs run jq      # full pipeline for a single tool
  ```
- [ ] Update README to move `init` out of the Quick Start — it's for power users doing batch ops, not the first thing you run

---

### Phase 7: Distribution — npm + Homebrew

- [ ] Publish to npm so users can run `npx agent-tool-docs run jq` or `npm install -g agent-tool-docs` with zero setup
- [ ] Verify package.json has all required fields for npm publish: name, version, description, bin, repository, license, keywords, homepage
- [ ] Make sure the `bin` field points to the built CLI entry point and works via `npx`
- [ ] Add `bun run build` to a `prepublishOnly` script so npm publish always ships a fresh build
- [ ] Create a Homebrew tap repo (`homebrew-tap` or `homebrew-agent-tool-docs`) with a formula
- [ ] Use `bun build --compile` to produce standalone binaries (darwin-arm64, darwin-x64, linux-x64, linux-arm64) that don't require Node/Bun at runtime
- [ ] Set up a GitHub Actions release workflow: on git tag → build binaries → create GitHub release → update Homebrew formula SHA
- [ ] Update README Quick Start to show install options as an inline stack (all variants visible, copy-pasteable):
  ```bash
  # npm
  npx agent-tool-docs run jq

  # pnpm
  pnpx agent-tool-docs run jq

  # bun
  bunx agent-tool-docs run jq

  # Homebrew (macOS / Linux)
  brew tap BrennerSpear/tap
  brew install agent-tool-docs
  tool-docs run jq
  ```

---

## Non-Goals

- Not removing registry support — it's still the right UX for batch operations
