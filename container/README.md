# Universal headless dev container

One mutable container for everything that doesn't need a GUI. The image is a
thin, generic toolchain (nix + devbox + chezmoi + tini); your actual
environment is **applied inside the container, by you, at run time**.
Identity (dotfiles repo, git name/email) is never baked into the image and
never injected via env vars: you bootstrap once via `chezmoi init` inside the
container, then everything is just normal dotfile editing from then on.

## Bootstrap (one time per container/volume)

```sh
# 1. Bring the container up (compose / `docker run` / whatever).
# 2. Shell in:
docker exec -it devbox bash

# 3. Inside the container, initialize chezmoi from your dotfiles repo:
chezmoi init --apply https://github.com/<you>/dotfiles

# 4. Install the declared package set:
devbox global install
```

That's it. On subsequent container restarts the entrypoint auto-starts
`gmuxd` (if devbox installed it via `devbox.json`); your dotfiles stay
exactly as last applied (no surprise `git pull` on restart).

## How the pieces split

| Concern | Managed by | Where the source lives |
|---|---|---|
| Packages | **devbox** global profile | `private_dot_local/share/devbox/global/default/devbox.json` |
| Dotfiles (shell, git, jj, gh, pi…) | **chezmoi** (`container` flag) | the rest of this repo |
| Build recipe | docker | `container/` (this dir: Dockerfile, entrypoint, README) |
| Process supervision | **tini** as PID 1 | baked into the image |

> **Why isn't `devbox.json` in this folder?** chezmoi's source path *is* the
> target path, and devbox only reads its global config from
> `~/.local/share/devbox/global/default/` (no override exists). So for chezmoi
> to manage the file where devbox reads it, the source must live at the
> matching path. `container/` holds the build recipe; the managed dotfile
> lives at its canonical location.

## Process model

```
tini (PID 1)
└── entrypoint.sh → exec sleep infinity   ← container's lifeline
    [gmuxd reparents here after double-fork]
└── gmuxd (background, if installed)
    └── session shells (gmux, docker exec, etc.)
```

The container's lifetime is decoupled from gmuxd's. `gmuxd restart` (e.g. to
upgrade the daemon) does not restart the container, so existing gmux sessions
survive. tini reaps zombies and forwards SIGTERM for clean `docker stop`.

The `container` chezmoi flag has its own allowlist in `.chezmoiignore` and is
independent of `headless` (which is a different host). On a host where
`container=false` the devbox profile is ignored, so nothing leaks onto
non-container machines.

## Day-to-day: edit and apply from inside

**Author-first (declarative):**

```sh
chezmoi edit ~/.local/share/devbox/global/default/devbox.json
chezmoi apply
devbox global install
```

**Live-first (ad hoc), then capture back into the repo:**

```sh
devbox global add cowsay
chezmoi add ~/.local/share/devbox/global/default/devbox.json
# commit + push from the chezmoi source dir to persist
```

Pull upstream dotfile changes when *you* want them, not on container restart:

```sh
chezmoi update --apply
```

> `devbox.json` is *authored*, not a snapshot of system state — the profile
> only ever contains exactly what you wrote down. Find names with
> `devbox search <name>` (nixpkgs attrs); pin with `name@x.y`.

## Build the image

This image is built and run locally (no registry round-trip):

```sh
docker build -t devbox container/
```

Or via the apps repo's compose stack (`stacks/devbox/compose.yaml`), which
`build:` points at this directory.

## Alternative base: from-scratch Debian

If you'd rather not depend on `jetpackio/devbox`, build on `debian:stable-slim`
and install the toolchain yourself (same FHS/glibc benefits, fully owned):

```dockerfile
FROM debian:stable-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git sudo tini xz-utils locales \
 && rm -rf /var/lib/apt/lists/*
RUN useradd -m -s /bin/bash devbox \
 && echo "devbox ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/devbox
USER devbox
WORKDIR /home/devbox
# Determinate Nix installer, no systemd (container):
RUN curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix \
      | sh -s -- install linux --init none --no-confirm
ENV PATH=/nix/var/nix/profiles/default/bin:/home/devbox/.local/bin:$PATH
RUN curl -fsSL https://get.jetify.com/devbox | bash -s -- -f
# ...then install chezmoi + the same entrypoint.sh, ENTRYPOINT via tini.
```

The nix-in-container details (single-user vs daemon, `--init none`) are the
fiddly part; that's what the `jetpackio/devbox` base saves you.
