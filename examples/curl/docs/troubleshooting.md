# curl — Troubleshooting

## SSL Certificate Verification Failed
**Symptom:** `curl: (60) SSL certificate problem`
**Fix:** Use `-k` to skip (dev only) or provide CA: `curl --cacert ca.pem https://...`

## POST Request Silently Ignored
**Symptom:** Request succeeds but server received no data
**Fix:** Use `-d` flag. `curl -X POST <url>` without `-d` sends empty body.

## JSON Parse Errors from Server
**Symptom:** `Unexpected token <` — server returned HTML error page
**Fix:** Check URL, headers, and auth. Use `-v` to see actual request/response.

## Common LLM Mistakes

1. **Unnecessary `-X GET`:** Don't use it—GET is default
2. **Unquoted JSON:** `curl -d {key:value}` fails; quote: `curl -d '{"key":"value"}'`
3. **Quote escaping:** Use `'...'` for literal strings, escape backslashes in double quotes
4. **Missing `-d` with POST:** `-X POST` alone sends empty body
5. **Forgotten URL encoding:** Special chars (`?`, `&`, `#`) need escaping in URLs