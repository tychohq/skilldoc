# jq — Advanced Usage

## Power-User Flags

**Streaming mode (avoid memory overhead on huge files):**
```
jq --stream 'select(length==2) | {(.[0]|join(".")): .[1]}' huge.json
```
Parse in streaming fashion instead of loading entire file.

**Load JSON from separate file:**
```
jq --slurpfile data file.json '.users as $u | . + {imported: $data}'
```

**Read file contents as string:**
```
jq --rawfile text file.txt '.content = $text'
```

**Custom formatting:**
```
jq --tab '.'           # Use tabs for indentation
jq --indent 4 '.'      # Use N spaces (max 7)
jq -S '{b,a}' << 'EOF'
{"a": 1, "b": 2}
EOF
# Output: {"a": 1, "b": 2}  (sorted)
```

**Positional arguments:**
```
jq -n --args '.[$n]' arg1 arg2  # $ARGS.positional contains args
```

## Edge Cases

- **Division by zero** returns `null`, not error
- **Integer precision:** numbers > 2^53 lose precision
- **Recursive descent** (`..'`) deep filters; slow on large structures
- **`as $var` creates scope**, not persistent assignment