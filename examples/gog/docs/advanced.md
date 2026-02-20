# gog — Advanced Usage

## Power-User Flags

**Color control:** `--color auto|always|never` — disable color for log parsing or force it in CI environments.

**Restrict commands:** `--enable-commands gmail,drive` — limit available commands for safety or ACL enforcement.

**Field selection:** `--select` uses dot paths for nested fields (best-effort). Use `--fields` in specific commands for guaranteed support.

**Verbose debugging:** `--verbose` enables detailed logging; useful when OAuth or API calls fail silently.

**Version check:** `gog --version` — verify CLI version for compatibility.

## Edge Cases

- **Multiple accounts:** Always specify `--account`; no default fallback (safer for multi-tenant setups).
- **Client selection:** `--client` selects which OAuth credentials to use; must be pre-registered via `gog auth`.
- **JSON mode without `--results-only`:** Response includes `nextPageToken`, metadata; parse envelope carefully.
- **TSV output (`--plain`):** Tabs used as delimiter; fields containing tabs may break parsing.