# Claude — Recipes

## Non-Interactive Output for Automation

```bash
claude --print --model sonnet < analyze_code.txt
echo 'fix this bug' | claude --print
```

Use `--print` in scripts; output is plain text without session saves or interactive prompts.

## Resume and Continue Conversations

```bash
claude --resume                    # Pick from recent sessions
claude --resume abc123def456       # Resume specific session
claude --continue                  # Continue in current directory
claude --fork-session --resume     # Resume as new session
```

## Restrict Tool Access

```bash
claude --tools 'Bash,Edit,Read'         # Only these tools available
claude --allowedTools 'Bash(git:*)Edit' # Bash only for git, all Edit allowed
claude --disallowedTools 'Bash'         # Block Bash
claude --disable-slash-commands         # No skills
```

## Debug and Custom Instructions

```bash
claude --system-prompt 'Prefer Python 3.12, type hints required'
claude --debug api,hooks                # Log API + hooks only
claude --debug '!file,!1p'              # Log everything except file and 1p
```

## Model Selection and Fallback

```bash
claude --model sonnet                              # Short alias
claude --model claude-sonnet-4-6                   # Full model ID
claude --print --model sonnet --fallback-model opus  # Switch to opus if sonnet busy
```