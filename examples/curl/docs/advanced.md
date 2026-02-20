# curl — Advanced Usage

## Power-User Flags

| Flag | Usage |
|------|-------|
| `--data-raw <data>` | Send data without URL encoding |
| `--json` | Auto-set Content-Type and send JSON (curl 7.82+) |
| `-w "<format>"` | Output custom format (times, response code, headers) |
| `--max-time <seconds>` | Timeout for entire operation |
| `--connect-timeout <seconds>` | Connection timeout only |
| `--retry <num>` | Retry on transient errors |
| `--max-redirs <num>` | Limit redirect count |
| `--cert <file> --key <file>` | Client certificate authentication |
| `--cacert <file>` | Custom CA certificate |
| `--compressed` | Request gzip/deflate compression |
| `-c <file>` | Save cookies to file |
| `-b <file>` | Read cookies from file |

## Edge Cases

- **URL encoding:** `-d` auto-encodes; `--data-raw` sends literally
- **POST redirects:** `-L` converts POST→GET on 303; use `-X POST` to force POST through redirects
- **SSL self-signed:** Use `-k` or provide CA with `--cacert`
- **Streaming:** No built-in stream processing; redirect to file with `-o` for large downloads