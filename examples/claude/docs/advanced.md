# Claude — Advanced Usage

## Power-User Flags

**Streaming:** `--input-format stream-json --output-format stream-json --include-partial-messages` — Realtime streaming chunks

**Custom agents:** `--agents '{"reviewer":{"description":"Code reviewer","prompt":"Review code"}}' --agent reviewer`

**MCP servers:** `--mcp-config /path/config.json` or `--mcp-config '{...}'` (space-separated for multiple)

**Strict MCP:** `--strict-mcp-config` — Use ONLY specified MCP servers, ignore all others

**Model fallback:** `--fallback-model opus` (with --print) — Auto-switch if primary is overloaded

**JSON output:** `--json-schema '{"type":"object",...}'` — Validate response against schema

**Fork sessions:** `--fork-session --resume` — Create new session instead of reusing on resume

**Budget limit:** `--max-budget-usd 5.00` (--print only) — Stop at cost limit

**Worktrees:** `--worktree [name] --tmux` — Create git worktree with tmux session (iTerm2 native by default; `--tmux=classic` for traditional)

## Edge Cases

**Workspace trust:** `--print` bypasses trust dialog — use only in trusted directories

**Disable persistence:** `--no-session-persistence` (--print only) — Don't save sessions

**Dangerous bypass:** `--dangerously-skip-permissions` disables ALL checks — sandboxes only

**Tool subcommand syntax:** `Bash(git:*)` restricts Bash to git only; `Edit(*.md)` restricts Edit to markdown

**Setting sources:** `--setting-sources user,project,local` — Load in order, last wins

**Additional dirs:** `--add-dir /path1 /path2` — Extend file access beyond current dir