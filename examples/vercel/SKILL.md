---
name: vercel
description: Deploy and manage applications on Vercel from the command line
generated-from: skilldoc
tool-id: vercel
tool-binary: vercel
tool-version: 50.9.5
generated-at: 2026-02-20T14:25:55.955Z
---
# Vercel

Deploy and manage applications on Vercel from the command line.

## Quick Reference

```
vercel              # Deploy current directory
vercel --prod       # Deploy to production
vercel dev          # Start local dev server
vercel link         # Link directory to Vercel project
vercel ls           # List all deployments
vercel logs <url>   # View deployment logs
vercel rollback     # Revert to previous deployment
```

## Key Commands

| Command | Purpose |
|---------|----------|
| `deploy [path]` | Deploy directory (default) |
| `dev` | Start local dev server |
| `link [path]` | Link project to Vercel |
| `ls/list` | List deployments |
| `logs [url]` | View deployment logs |
| `env` | Manage environment variables |
| `rollback [url\|id]` | Revert to previous deployment |
| `inspect [id]` | Show deployment details |
| `build` | Build locally to ./vercel/output |
| `open` | Open project in dashboard |

## Key Flags

| Flag | Purpose |
|------|----------|
| `--prod` | Create production deployment |
| `-e/--env KEY=VALUE` | Set runtime environment variable |
| `-b/--build-env KEY=VALUE` | Set build-time environment variable |
| `-f/--force` | Force deployment despite no changes |
| `-y/--yes` | Skip all confirmation prompts |
| `--cwd <DIR>` | Set working directory |
| `--listen <URI>` | Dev server address (e.g., `127.0.0.1:8080`) |
| `--token <TOKEN>` | Use authentication token |
| `--debug` | Enable debug output |

## Common Patterns

```bash
# Deploy with environment variables
vercel -e NODE_ENV=production -e API_URL=https://api.example.com

# Production deployment with no prompts
vercel --prod -y

# Dev server on custom port
vercel dev --listen 8080

# Force redeploy
vercel --force

# Capture deployment URL to file
vercel > deployment-url.txt
```