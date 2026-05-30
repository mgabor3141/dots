# syntax=docker/dockerfile:1
#
# Universal headless dev container.
#
# Thin by design: the image ships only the *toolchain* (nix + devbox + chezmoi
# + tini). Your actual environment is applied at run time, from *inside* the
# container, by you (one-time `chezmoi init --apply` + `devbox global
# install`). The image carries no identity, no dotfiles repo URL, no git
# config; restart-time auto-updates are deliberately absent so you can edit
# dotfiles inside the container without surprise pulls.
#
# Base: jetpackio/devbox already ships nix + devbox on a Debian (glibc/FHS)
# base, so random prebuilt binaries mostly just run.
#
# Process model: tini (PID 1) → entrypoint.sh → `sleep infinity` foreground.
# gmuxd (if installed) runs as a backgrounded child of tini, so `gmuxd
# restart` doesn't restart the container.

FROM jetpackio/devbox:latest

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl git ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && sh -c "$(curl -fsLS get.chezmoi.io)" -- -b /usr/local/bin
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Stash the image's populated home dir so the entrypoint can seed an empty
# bind-mounted $HOME on first run. Without this, mounting a fresh host dir over
# /home/devbox hides the image's .profile / .bashrc / .nix-profile symlink and
# nix never makes it onto PATH.
RUN cp -a /home/devbox /opt/home-skel \
 && chown -R devbox:devbox /opt/home-skel

USER devbox
WORKDIR /home/devbox

# jetpackio/devbox sets DEVBOX_USER but not USER. Without USER, login shells
# source ~/.profile → nix.sh, which short-circuits when USER is empty and
# never adds /home/devbox/.nix-profile/bin to PATH. Non-login shells inherit
# the image's ENV PATH (which has nix), so this only bites ssh-style logins.
ENV USER=devbox

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
