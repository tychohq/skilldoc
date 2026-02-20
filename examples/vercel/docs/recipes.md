# Vercel — Recipes

## Deploy to Production
```bash
vercel --prod
```

## Deploy with Environment Variables
```bash
vercel --env NODE_ENV=production --env API_KEY=secret_key --env DB_URL=postgres://...
```

## Build Locally, Deploy Pre-built
```bash
vercel build
vercel deploy --prebuilt
```

## Set Up New Project
```bash
vercel login
cd /path/to/project
vercel link
vercel
```

## View Deployment Logs
```bash
vercel logs https://my-project.vercel.app
```

## Rollback to Previous Deployment
```bash
vercel rollback <url-or-id>
```

## Start Dev Server on Custom Port
```bash
vercel dev --listen 8080
```

## Force Redeploy Without Changes
```bash
vercel --force
```

## Deploy with Build-Time Variables
```bash
vercel --build-env API_ENDPOINT=https://api.prod.com
```