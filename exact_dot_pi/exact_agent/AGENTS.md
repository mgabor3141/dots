# Global Agent Instructions

Keep this file brief. Update it with critical learnings as you encounter them.

## Planning

When a fix requires more than two attempts or you're working around tool internals, **stop and plan first**. Think about whether there's a simpler approach before brute-forcing.

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
