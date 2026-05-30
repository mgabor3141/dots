# Universal headless dev container

One mutable container for everything that doesn't need a GUI. The image is a
thin, generic toolchain (nix + devbox + chezmoi); your actual environment is
**applied inside the container at run time** by chezmoi and devbox. You
install/update everything from within the running container — never by
rebuilding the image.

## The one-liner

Pull the image and apply your chezmoi config inside it:

```sh
docker run -it --rm \
  -e DOTFILES_REPO=https://github.com/<you>/dotfiles \
  -e GIT_NAME="<you>" -e GIT_EMAIL="<you@example.com>" \
  -v devbox-home:/home/devbox \
  ghcr.io/<you>/devbox-env
```

On start the entrypoint runs `chezmoi init --apply` (clones the repo, applies
dotfiles with `container=true`) and then `devbox global install` (installs the
declared package set). Re-running just `chezmoi update --apply` + reconverges.
The named volume keeps `$HOME` (and the chezmoi clone) warm across runs.

## How the two halves split

| Concern | Managed by | Where the source lives |
|---|---|---|
| Packages | **devbox** global profile | `private_dot_local/share/devbox/global/default/devbox.json` |
| Dotfiles (shell, git, jj, gh, pi…) | **chezmoi** (`container` flag) | the rest of this repo |
| Build recipe | docker | `container/` (Dockerfile, entrypoint, README) |

> **Why isn't `devbox.json` in this folder?** chezmoi's source path *is* the
> target path, and devbox only reads its global config from
> `~/.local/share/devbox/global/default/` (no override exists). So for chezmoi
> to manage the file where devbox reads it, the source must live at the matching
> path. This `container/` folder holds the build recipe; the managed dotfile
> lives at its canonical location.

## chezmoi flags

The container has its **own** `container` flag with its own allowlist in
`.chezmoiignore` — independent of `headless` (the unraid box, which may go
away). On host/mac (`container=false`) the devbox profile is ignored, so nothing
leaks onto those machines.

## Day-to-day: install / update from inside

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

Update everything:

```sh
devbox global update    # bump locked package versions
chezmoi update --apply  # pull + apply latest dotfiles
```

> `devbox.json` is *authored*, not a snapshot of system state — the profile only
> ever contains exactly what you wrote down. Find names with
> `devbox search <name>` (nixpkgs attrs); pin with `name@x.y`.

## Build & publish the image

```sh
docker build -t ghcr.io/<you>/devbox-env container/
docker push ghcr.io/<you>/devbox-env
```

(The image bakes only the toolchain; `DOTFILES_REPO`/`GIT_*` are runtime env,
so the same image works for anyone.)

## Alternative base: from-scratch Debian

If you'd rather not depend on `jetpackio/devbox`, build on `debian:stable-slim`
and install the toolchain yourself (same FHS/glibc benefits, fully owned):

```dockerfile
FROM debian:stable-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git sudo xz-utils locales \
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
# ...then install chezmoi + the same entrypoint.sh.
```

The nix-in-container details (single-user vs daemon, `--init none`) are the
fiddly part; that's what the `jetpackio/devbox` base saves you.
