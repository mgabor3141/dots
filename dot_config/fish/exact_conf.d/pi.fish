# pi coding agent configuration
# Model selection for pi-librarian subagent (ordered failover, falls back to ctx.model)
# Format: provider/model:thinking — see https://github.com/default-anton/pi-librarian
set -gx PI_LIBRARIAN_MODELS "anthropic/claude-sonnet-4-6:low"
