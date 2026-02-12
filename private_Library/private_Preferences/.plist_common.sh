# Shared boilerplate for chezmoi modify_ plist scripts.
# Source this at the top of each script (after shebang and set -euo pipefail).
#
# Provides:
#   $tmp           — temp file with current plist contents (converted to XML)
#   pb             — PlistBuddy wrapper (stdout→stderr to protect binary output)
#   set_bool       — upsert a boolean key
#   set_int        — upsert an integer key
#   set_real       — upsert a real/float key
#   set_string     — upsert a string key (simple values only)
#   pl_set_string  — upsert a string key via plutil (handles tricky quoting)
#   set_data_json  — upsert a data key from a JSON string (base64-encoded at apply time)
#   plist_finalize — convert back to binary and write to stdout (call at end)

set -euo pipefail

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
cat > "$tmp"

# Initialize empty plist if target doesn't exist yet
if [ ! -s "$tmp" ]; then
    cat > "$tmp" <<'INIT'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict/>
</plist>
INIT
fi

plutil -convert xml1 "$tmp"

# PlistBuddy writes errors to stdout (not stderr!), so redirect all its output
# to stderr. Set/Add/Delete produce no useful stdout on success.
pb() { /usr/libexec/PlistBuddy "$@" "$tmp" >&2; }

# Upsert helpers: Set (update) with fallback to Add (create)
set_bool()    { pb -c "Set :$1 $2"  2>/dev/null || pb -c "Add :$1 bool $2"; }
set_int()     { pb -c "Set :$1 $2"  2>/dev/null || pb -c "Add :$1 integer $2"; }
set_real()    { pb -c "Set :$1 $2"  2>/dev/null || pb -c "Add :$1 real $2"; }
set_string()  { pb -c "Set :$1 $2"  2>/dev/null || pb -c "Add :$1 string $2"; }

# plutil-based upsert for values that need tricky quoting (literal quotes, etc.)
pl_set_string() {
    plutil -replace "$1" -string "$2" "$tmp" 2>/dev/null ||
        plutil -insert "$1" -string "$2" "$tmp"
}

# Upsert a <data> key from a JSON string. The JSON is base64-encoded at apply
# time, so the source file stays human-readable.
set_data_json() {
    local b64
    b64=$(printf '%s' "$2" | base64)
    plutil -replace "$1" -data "$b64" "$tmp" 2>/dev/null ||
        plutil -insert "$1" -data "$b64" "$tmp"
}

# Call at end of script to convert back to binary and output
plist_finalize() {
    plutil -convert binary1 "$tmp"
    cat "$tmp"
}
