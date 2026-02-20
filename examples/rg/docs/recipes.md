# ripgrep — Recipes

## Find TODO comments in code
```
rg -i 'todo|fixme|xxx' --type-list  # See available types first
rg -i 'todo|fixme' --type py src/   # Search Python files
```

## Search excluding directories
```
rg PATTERN -g '!node_modules' -g '!.git' -g '!dist'
rg PATTERN --no-ignore            # Ignore .gitignore entirely
```

## Find all files matching a pattern
```
rg -l 'class MyClass' src/        # List files containing pattern
rg --files | rg '\.js$'          # Find all .js files
```

## Replace text across files (with grep for preview)
```
rg 'oldtext' -l | xargs sed -i '' 's/oldtext/newtext/g'  # macOS
rg 'oldtext' -l | xargs sed -i 's/oldtext/newtext/g'     # Linux
```

## Search with regex capture groups
```
rg '(\w+)@([\w.]+)' --replace '$1 at $2'  # Replace email format
```

## Find in specific file types only
```
rg --type-add 'conf:*.cfg|*.conf' 'setting' --type conf
```