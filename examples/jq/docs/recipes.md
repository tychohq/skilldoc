# jq — Recipes

## Extract Specific Fields
```
jq '.[] | {id, name, email}' users.json
```
Picks only those fields from each object.

## Filter and Count
```
jq '[.items[] | select(.status == "active")] | length' data.json
```

## Flatten and Deduplicate
```
jq -s 'add | unique_by(.id)' file1.json file2.json
```

## Transform Nested Structure
```
jq '.data | map({user: .author, text: .message})' source.json
```

## Group By Category
```
jq -s 'group_by(.type) | map({type: .[0].type, count: length})' items.json
```

## Convert to CSV
```
jq -r '.[] | [.id, .name, .email] | @csv' users.json
```
Output is properly escaped CSV format.