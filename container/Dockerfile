# syntax=docker/dockerfile:1
#
# Universal headless dev container.
#
# Thin by design: the image ships only the *toolchain* (nix + devbox + chezmoi).
# Your actual environment is applied at *run time* by chezmoi (dotfiles) and
# devbox (packages), so:
#   - the image stays generic/shareable (no personal config baked in), and
#   - you install/update everything from *inside* the running container,
#     never rebuilding the image.
#
# Base: jetpackio/devbox already ships nix + devbox on a Debian (glibc/FHS)
# base, so random prebuilt binaries mostly just run.

FROM jetpackio/devbox:latest

# Defaults bake into the image; override per `docker run -e ...`.
ENV DOTFILES_REPO="https://github.com/CHANGE-ME/dotfiles" \
    GIT_NAME="CHANGE ME" \
    GIT_EMAIL="changeme@example.com"

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && sh -c "$(curl -fsLS get.chezmoi.io)" -- -b /usr/local/bin
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER devbox
WORKDIR /home/devbox

# On start: apply dotfiles (chezmoi) + converge packages (devbox), then shell.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["bash", "-l"]
