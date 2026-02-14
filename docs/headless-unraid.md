# Headless Server Setup (Unraid)

This repo supports headless deployment via chezmoi's `headless` variable. The primary target is Unraid, which has unusual filesystem constraints that require special handling.

## Unraid Filesystem Constraints

Unraid's root filesystem is **tmpfs** — everything under `/root` is wiped on every reboot. Persistent storage is split across two locations:

| Path | Filesystem | Persistent? | Notes |
|---|---|---|---|
| `/root` | rootfs (tmpfs) | ❌ | Wiped on reboot |
| `/boot/config` | vfat (USB stick) | ✅ | No symlinks, no unix permissions |
| `/mnt/user` | fuse.shfs (array) | ✅ | Full POSIX, only available after array starts |
| `/usr`, `/lib` | squashfs | Read-only | Overlaid with tmpfs upper layer |
| `/etc` | tmpfs | ❌ | Writable but wiped on reboot |

This means:
- Anything installed to `/root`, `/usr/local`, or `/etc` disappears on reboot
- `/boot/config` is persistent but vfat (can't store git repos, symlinks, or unix permissions)
- `/mnt/user` is the only persistent POSIX storage, but it's **not available at early boot** — it mounts only after the array starts

## Persistent Storage Layout

Everything that needs to survive reboots lives on the array:

```
/mnt/user/appdata/
├── chezmoi/
│   ├── bin/chezmoi          # chezmoi binary
│   ├── source/              # git clone of this repo
│   ├── config.toml          # chezmoi config (headless=true)
│   ├── .env                 # API keys (BRAVE_API_KEY, etc.)
│   └── .pi/                 # pi agent runtime data (extensions, binaries, settings)
└── node/
    ├── bin/pi               # pi binary (npm global)
    └── lib/node_modules/    # npm global packages
```

## Boot Sequence

Unraid's boot script is `/boot/config/go` (on the persistent USB stick). Here's what happens in order:

### Phase 1: Early boot (array NOT mounted)

1. **`/usr/local/sbin/emhttp`** starts — this is Unraid's management utility that eventually mounts the array. It runs in the foreground briefly, then the script continues.

2. **`sed` patches `/etc/profile`** — Unraid's default `/etc/profile` contains a hard-coded `cd $HOME` that forces every login shell into `/root`, breaking SSH directory arguments and Zed remote terminals. Since `/etc` is tmpfs, we comment this out on every boot:
   ```bash
   sed -i 's/^cd $HOME/#cd $HOME/' /etc/profile
   ```

3. **Background subshell starts** — a `(...)&` block that waits for the array.

### Phase 2: Array available (background, async)

The background subshell polls until `/mnt/user/appdata/chezmoi` exists (array mounted), then:

4. **Copies `~/.env`** from persistent storage — contains API keys (`BRAVE_API_KEY`, etc.) that `.profile` sources via `set -a; [ -f "$HOME/.env" ] && . "$HOME/.env"; set +a`.

5. **Creates `.pi` symlink** — `ln -sfn /mnt/user/appdata/chezmoi/.pi ~/.pi` so pi's runtime data (extensions, downloaded binaries like `rg`/`fd`, session state) persists across reboots without chezmoi needing to manage it.

6. **Runs `chezmoi apply`** — regenerates all managed dotfiles in `/root` from the persistent source repo. This populates `.bashrc`, `.bash_profile`, `.profile`, `.gitconfig`, `.editorconfig`, and CLI tool configs (btop, direnv, fastfetch, jj, lesskey).

### The go script

```bash
#!/bin/bash
# Start the Management Utility
/usr/local/sbin/emhttp 

# Remove the forced 'cd $HOME' from /etc/profile (tmpfs, safe to edit)
sed -i 's/^cd $HOME/#cd $HOME/' /etc/profile

# Apply dotfiles and restore secrets once array is available
(while [ ! -d /mnt/user/appdata/chezmoi ]; do sleep 5; done
 cp /mnt/user/appdata/chezmoi/.env ~/
 ln -sfn /mnt/user/appdata/chezmoi/.pi ~/.pi
 /mnt/user/appdata/chezmoi/bin/chezmoi apply --config /mnt/user/appdata/chezmoi/config.toml) &
```

## Headless chezmoi Config

The `headless` variable controls what gets deployed. The `.chezmoiignore` uses a whitelist approach — ignore everything with `*` and `**/*`, then un-ignore specific paths with `!` patterns. chezmoi's `!` (exclude) patterns always take priority over includes.

### What's managed on headless

| Category | Files |
|---|---|
| Shell | `.bashrc`, `.bash_profile`, `.profile` |
| Git | `.gitconfig` |
| CLI tools | `.editorconfig`, btop, direnv, fastfetch, jj, lesskey |
| Pi agent | `.pi/**` (settings only — runtime data via symlink) |

Fish shell is **not** available on Unraid (only bash), so fish configs are excluded from the headless whitelist.

### Template guards

Several templates have headless-aware conditionals:

- **`.profile`** — `VISUAL="zed --wait"` and all desktop env vars (Wayland, GTK, Qt, gaming) are gated behind `not .headless`. The headless-specific `npm_config_prefix` points to `/mnt/user/appdata/node` for persistent npm global installs.
- **`.pi/agent/settings.json`** — `pi-interactive-shell` package is excluded on headless (requires python/gcc for `node-pty` compilation, unavailable on Unraid).
- **`.bashrc`** — `direnv hook bash` is guarded with `command -v direnv` since direnv may not be installed.

## Initial Setup

Run the bootstrap script (available in `~/.local/bin/` after chezmoi apply on any machine):

```bash
scp ~/.local/bin/bootstrap-chezmoi-headless root@unraid.local:/tmp/
ssh root@unraid.local /tmp/bootstrap-chezmoi-headless /mnt/user/appdata/chezmoi https://github.com/mgabor3141/dots.git
```

Then install pi to persistent storage:

```bash
ssh root@unraid.local 'npm_config_prefix=/mnt/user/appdata/node npm install -g @mariozechner/pi-coding-agent'
```

Create `~/.env` with API keys and persist it:

```bash
ssh root@unraid.local 'echo "BRAVE_API_KEY=your-key" > ~/.env && cp ~/.env /mnt/user/appdata/chezmoi/.env'
```

Set up the go script as shown above, then reboot to verify everything comes back.

## Updating

To pull config changes:

```bash
ssh root@unraid.local 'cd /mnt/user/appdata/chezmoi/source && git pull && /mnt/user/appdata/chezmoi/bin/chezmoi apply --config /mnt/user/appdata/chezmoi/config.toml'
```
