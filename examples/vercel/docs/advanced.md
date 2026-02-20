# Vercel — Advanced Usage

## Power-User Flags

**`--prebuilt`**: Deploy pre-built outputs from `vercel build` without rebuilding.
```bash
vercel build
vercel deploy --prebuilt
```

**`--skip-domain`**: Skip automatic domain aliasing on production. Manually promote later with `vercel promote [url]`.

**`--with-cache`**: Retain build cache when using `--force` (avoids cache invalidation).

**`--guidance`**: Receive optimization suggestions after deployment.

**`--no-wait`**: Return immediately without waiting for deployment completion.

**`-m/--meta KEY=VALUE`**: Attach metadata to deployment.

**`--regions <REGION>`**: Deploy to specific regions (multi-region setup).

**`-l/--logs`**: Print full build logs during deployment.

**`--target <TARGET>`**: Specify environment (production/preview/staging).

## Build vs Runtime Variables

- **`--build-env`**: Baked into build output, can't change without rebuild
- **`--env`**: Available to running app, changeable via dashboard without rebuild

## Optimization

Use `--archive <FORMAT>` to compress code before upload (gzip/zip/tar).