# Flatpak

Secondary application source for packages that have issues with Arch/CachyOS native packages (e.g. sdl2-compat breakage).

## Usage

- Add/remove app IDs in `.flatpak-pkglist.txt` (one per line, `#` for comments)
- Run `chezmoi apply` to sync
- Run `./update-package-files.sh` to capture current state from system

## Finding app IDs

```sh
flatpak search moonlight
# or browse https://flathub.org
```
