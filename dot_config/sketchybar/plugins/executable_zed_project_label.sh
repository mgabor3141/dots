#!/bin/bash
#
# Computes the shortest unique prefix for a Zed project name.
# Uses full hyphen-delimited words to determine uniqueness.
#
# Usage: zed_project_label.sh "window_title"
# Example: zed_project_label.sh "core-apps — main.rs"
# Output: "core" (if unique) or "core-apps" (if "core-backend" also exists)

window_title="$1"

if [ -z "$window_title" ]; then
  echo ":zed:"
  exit 0
fi

# Extract project name (part before " — " if present)
project_name="${window_title%% — *}"

# Get all Zed project names (unique)
all_projects=$(aerospace list-windows --all 2>/dev/null | \
  awk -F'|' '$2 ~ /Zed/ {gsub(/^ *| *$/, "", $3); sub(/ — .*/, "", $3); print $3}' | \
  sort -u)

# Compute shortest unique prefix using hyphen-delimited words
IFS='-' read -ra words <<< "$project_name"
candidate=""

for word in "${words[@]}"; do
  if [ -z "$candidate" ]; then
    candidate="$word"
  else
    candidate="$candidate-$word"
  fi

  # Check if this candidate is unique among all projects
  is_unique=true
  while IFS= read -r other; do
    if [ "$other" != "$project_name" ]; then
      # Check if other project starts with candidate (as a word prefix)
      if [ "$other" = "$candidate" ] || [[ "$other" == "$candidate-"* ]]; then
        is_unique=false
        break
      fi
    fi
  done <<< "$all_projects"

  if [ "$is_unique" = true ]; then
    break
  fi
done

# Aliases for display
case "$candidate" in
  chezmoi) echo "dots" ;;
  *)       echo "$candidate" ;;
esac
