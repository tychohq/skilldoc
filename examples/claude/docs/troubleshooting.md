# Claude — Troubleshooting

## Tool List Format Errors

**Symptom:** Tool restrictions ignored, tools available when they shouldn't be

**Fix:** Quote entire list and use correct separators:
- ✓ `--tools 'Bash,Edit,Read'` or `--tools 'Bash Edit Read'`
- ✗ `--tools Bash,Edit,Read` (missing quotes)
- Use subcommand filter: `--allowedTools 'Bash(git:*)'` allows only git for Bash

## Model Not Found or Wrong Model Used

**Symptom:** "Model not available" or session uses unexpected model

**Fix:** Use alias ('sonnet', 'opus', 'haiku') or full ID ('claude-sonnet-4-6'). Check model availability in settings.

## Permission Mode Not Working

**Symptom:** Still getting permission prompts despite `--permission-mode acceptEdits`

**Fix:** Valid modes are: acceptEdits, bypassPermissions, default, dontAsk, plan (hyphens, not underscores)

## Common LLM Mistakes

1. **Missing --print:** Without it, session is saved interactively; use `--print` for scripts
2. **Unquoted tool lists:** `--tools Bash,Edit` breaks; must quote: `--tools 'Bash,Edit'`
3. **--continue vs --resume:** `--continue` only in current dir; `--resume` picks any recent session
4. **Wrong model syntax:** Use 'sonnet' or 'claude-sonnet-4-6', not 'sonnet-4-6' alone
5. **Workspace trust:** `--print` bypasses trust dialog — only safe in trusted dirs
6. **--dangerously-skip-permissions:** High risk; only for isolated sandboxes