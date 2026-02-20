# curl — Recipes

## Download File with Redirects
```
curl -L -o output.zip https://example.com/download
```

## POST JSON to API
```
curl -X POST -H "Content-Type: application/json" \
  -d '{"name":"John","age":30}' \
  https://api.example.com/users
```

## API with Bearer Token
```
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.example.com/endpoint
```

## Submit Form Data
```
curl -X POST -d "username=john&password=secret" \
  https://example.com/login
```

## Upload File (multipart)
```
curl -F "file=@/path/to/file.txt" \
  -F "description=My file" \
  https://example.com/upload
```

## Multiple Headers and Verbose
```
curl -v \
  -H "X-API-Key: secret123" \
  -H "Accept: application/json" \
  https://api.example.com/data
```