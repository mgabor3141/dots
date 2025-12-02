# Portable zed settings and keymap

1. Downloads defaults for the current version from GitHub
2. Replaces `ctrl` with `secondary` in bindings => `cmd` on MacOS, `ctrl` otherwise

Notes:

- Vim bindings are only active if Helix or Vim mode is enabled in settings
- Since the Linux keymap contains actions that are not available on MacOS, Zed shows an error
    on MacOS whenever the keymap is reloaded. This error is safe to ignore.
