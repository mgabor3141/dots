# Global Agent Instructions

## Tool Usage

### interactive_shell

Use `interactive_shell` instead of `bash` when:
- **`sudo` commands** — the user needs to enter their password
- **Commands with prompts** — you need to respond to yes/no confirmations, selection menus, etc.
- **Desktop/GUI apps** — they run indefinitely and need to be backgrounded

Common patterns:

```typescript
// sudo / interactive commands: hands-free, wait for completion
interactive_shell({
  command: 'sudo pacman -S --needed --noconfirm foo',
  mode: "hands-free",
  handsFree: { autoExitOnQuiet: true, quietThreshold: 15000 }
})

// Desktop apps: launch and background immediately
interactive_shell({
  command: 'flatpak run com.example.App',
  mode: "hands-free"
})
// Then background it:
interactive_shell({ sessionId: "<id>", background: true })

// Fire-and-forget delegation (notified on completion, no polling):
interactive_shell({
  command: 'pi "Fix all lint errors"',
  mode: "dispatch"
})
```

For complex operations (multi-turn sessions, sending input, querying output, dispatch subagents), refer to the `interactive-shell` skill.

### Web Search and Research

**Prefer `brave_search` and `librarian`** over assumptions when dealing with external tools, libraries, system configuration, or error messages. Training data may be outdated — verify with live sources first.
