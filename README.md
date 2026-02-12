# agent-tool-docs

Deterministic CLI that generates static Markdown docs (plus JSON/YAML sidecars) from CLI `--help` output.

## Output Layout

Each tool is written to:

```
~/.agents/docs/tool-docs/<tool-id>/
  tool.md
  tool.yaml
  tool.json
  commands/
    <command-slug>/
      command.md
      command.yaml
      command.json
```

An `index.md` is generated at `~/.agents/docs/tool-docs/index.md`.

## Registry

Registry is a YAML file describing how to invoke each tool's help command.

Example `~/.agents/tool-docs/registry.yaml`:

```yaml
version: 1
tools:
  - id: git
    binary: git
    displayName: Git
    helpArgs: ["-h"]
    commandHelpArgs: ["help", "{command}"]
  - id: rg
    binary: rg
    displayName: ripgrep
    helpArgs: ["--help"]
```

## Usage

```text
tool-docs

Usage:
  tool-docs generate [--registry <path>] [--out <path>] [--only <id1,id2>]
  tool-docs init [--registry <path>] [--force]
  tool-docs --help

Commands:
  generate   Generate markdown + JSON docs for tools in the registry
  init       Create a starter registry file

Options:
  --registry <path>   Path to registry YAML (default: ~/.agents/tool-docs/registry.yaml)
  --out <path>        Output directory (default: ~/.agents/docs/tool-docs)
  --only <ids>        Comma-separated list of tool ids to generate
  --force             Overwrite registry on init
  -h, --help          Show this help
```

## Development

- `bun install`
- `bun test`
- `bun run build`

## Notes

- Help output is captured with `LANG=C`, `LC_ALL=C`, and `NO_COLOR=1` for stable, deterministic output.
