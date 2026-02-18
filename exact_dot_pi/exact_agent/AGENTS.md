# Global Agent Instructions

Keep this and any other AGENTS.md files brief. Add critical learnings to the relevant files as you encounter them.

## Planning

When you encounter a complex problem, **plan first**. Think about whether there's a simpler approach, weigh tradeoffs between solutions. Experiment with commands and config changes directly first for fast iteration, then make your changes idempotent and declarative using established systems.

## Tool Usage

### interactive_shell

Use `interactive_shell` instead of `bash` when:
- **`sudo` commands** — the user needs to enter their password
- **Interactive prompts** — you need to see and respond to yes/no confirmations, selection menus, etc.
- **GUI apps and long-running processes** — they run indefinitely and need to be backgrounded (bash `&` doesn't work)

Common patterns:

```typescript
// sudo / interactive commands: hands-free, wait for completion
interactive_shell({
  command: 'sudo pacman -S --needed --noconfirm foo',
  mode: "hands-free",
  handsFree: { autoExitOnQuiet: true, quietThreshold: 15000 }
})

// Desktop apps: launch then background
interactive_shell({
  command: 'flatpak run com.example.App',
  mode: "hands-free"
})
interactive_shell({ sessionId: "<id>", background: true })

// Fire-and-forget delegation (notified on completion):
interactive_shell({
  command: 'pi "Fix all lint errors"',
  mode: "dispatch"
})
```

Refer to the `interactive-shell` skill for complex operations (multi-turn sessions, sending input, querying output).

### Web Search and Research

**Prefer `brave_search` and `librarian`** over assumptions when dealing with external tools, libraries, system configuration, or error messages. Training data may be outdated — verify with live sources first.

## System Configuration

System-level config (packages, PAM, systemd drop-ins, etc.) is managed via chezmoi in `~/.local/share/chezmoi/`. Look there before making ad-hoc system changes. Key areas:
- See the repo's `AGENTS.md` and `README.md` for chezmoi conventions.
