# Vercel — Troubleshooting

## Not Authenticated
**Symptom:** "Error: Not authenticated"
**Fix:** Run `vercel login` or pass `--token <TOKEN>` with a valid Vercel authentication token.

## Project Not Linked
**Symptom:** "Error: Project not found"
**Fix:** Run `vercel link` in the project directory to associate it with a Vercel project.

## Environment Variables Missing at Runtime
**Symptom:** `process.env.MY_VAR` is undefined after deployment
**Fix:** Use `-e/--env` for runtime variables (not `-b/--build-env` which is build-time only).

## Deployment Hangs
**Symptom:** `vercel deploy` doesn't return
**Fix:** Use `--no-wait` to return immediately, or Ctrl+C (doesn't cancel deployment).

## Common LLM Mistakes

- **Wrong env var syntax:** Must be `--env KEY=value`, not `--env KEY value`
- **Quotes omitted:** `--env KEY="value with spaces"`
- **Mixing build-env and env:** Build variables can't be changed without rebuild
- **Path issues:** Use `vercel ./path/to/project`, not `vercel path`
- **Not linking project first:** Run `vercel link` before deploying a new project