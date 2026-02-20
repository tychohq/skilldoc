# jq — Troubleshooting

## Quote Escaping in Filters
**Symptom:** jq parse error or unexpected input
**Fix:** Wrap filter in single quotes, escape inner quotes: `jq '.x | select(.y == "value")'` not `jq '.x | select(.y == 'value')'`

## -r vs -R Confusion
**Symptom:** Output wrong or jq rejects input
**Fix:** `-r` (raw output) removes quotes from strings; `-R` (raw input) treats file as text lines, not JSON

## Exit Status Not Reflecting Output
**Symptom:** Script can't detect false/null results
**Fix:** Add `-e` flag: `jq -e '.found' data.json` exits 1 if result is false/null/0/empty

## Null Propagation in Chains
**Symptom:** `.field.subfield` fails when .field is null
**Fix:** Use optional: `jq '.field?.subfield'` or `jq '.field // empty'`

## Common LLM Mistakes
- Using `||` instead of `//` (logical OR vs null-coalesce)
- Forgetting pipes: `.items.[]` should be `.items | .[]`
- Using `=` for variable binding instead of `as`: use `.[] as $x`, not `.[] = $x`
- Assuming `@csv` matches all CSV dialects—it's RFC 4180 compliant but may need post-processing
- Building complex filters without testing intermediate stages