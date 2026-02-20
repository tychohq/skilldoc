# Future PRD — Distribution & Packaging

## Tasks
- [ ] Add `bun build --compile` step to produce standalone binaries (darwin-arm64, darwin-x64, linux-x64, linux-arm64)
- [ ] Set up GitHub Actions to build binaries on tag/release
- [ ] Create a Homebrew tap repo (`brennerspear/homebrew-tap`) with a `tool-docs` formula pointing to GitHub release assets
- [ ] Add `curl | sh` installer script that detects platform and downloads the right binary
- [ ] Update README with installation instructions (brew, curl, npx fallback)
