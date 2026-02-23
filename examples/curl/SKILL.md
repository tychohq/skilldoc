---
name: curl
description: Transfer data and files using URLs, supporting HTTP, HTTPS, and other protocols
generated-from: skilldoc
tool-id: curl
tool-binary: curl
tool-version: curl 8.16.0 (Darwin) libcurl/8.16.0 OpenSSL/3.0.18 zlib/1.3.1 zstd/1.5.7 libidn2/2.3.8 libssh2/1.11.1 nghttp2/1.67.1
generated-at: 2026-02-20T05:15:20.630Z
---
# curl

Transfer data using URLs with support for HTTP, HTTPS, and many other protocols.

## Quick Reference

```
curl [OPTIONS] <url>
curl -X POST -H "Content-Type: application/json" -d '{"key":"value"}' https://example.com
curl -o filename.txt https://example.com/file
```

## Key Flags

| Flag | Purpose |
|------|----------|
| `-X METHOD` | HTTP method (GET, POST, PUT, DELETE, PATCH) |
| `-H "Header: value"` | Add HTTP header |
| `-d <data>` | Send POST data (form-encoded by default) |
| `-o <file>` | Save response to file |
| `-O` | Save as remote filename |
| `-b <cookies>` | Send cookies |
| `-u user:password` | HTTP Basic authentication |
| `-A <agent>` | Set User-Agent header |
| `-L` | Follow redirects |
| `-s` | Silent mode (no progress bar) |
| `-v` | Verbose (show headers and debug info) |
| `-k` | Skip SSL certificate verification |

## Common Patterns

**Basic GET:**
```
curl https://example.com
```

**POST JSON:**
```
curl -X POST -H "Content-Type: application/json" -d '{"key":"value"}' https://example.com
```

**POST form data:**
```
curl -X POST -d "field1=value1&field2=value2" https://example.com
```

**Download file:**
```
curl -o myfile.txt https://example.com/file.txt
```

**With authentication:**
```
curl -u username:password https://example.com
curl -H "Authorization: Bearer TOKEN" https://example.com
```