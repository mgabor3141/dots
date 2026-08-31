# pacman and paru

https://wiki.archlinux.org/title/Pacman
https://wiki.archlinux.org/title/Pacman/Tips_and_tricks
https://github.com/graysky2/lostfiles

## IgnorePkg

`.pacman-ignorepkg.txt` lists packages to hold back (one per line).
An onchange script updates `/etc/pacman.conf`'s `IgnorePkg` line via sudo.

To unpin: remove the package from the file, then `chezmoi apply ~/pacman/`.

## Package state

Package state is deliberately not reconciled by `chezmoi apply`. Package
transactions made outside chezmoi therefore do not cause a later apply to
upgrade, reinstall, or remove packages.

A pacman post-transaction hook automatically captures installed package state
into the chezmoi source after installs and removals. It only updates the source;
it does not apply package state back to the system.

Package state can also be captured explicitly:

```sh
~/pacman/capture-system-packages.sh
```

Review and commit the resulting changes before applying them elsewhere. To
explicitly make a system match the package lists in the repository, run:

```sh
~/pacman/apply-system-packages.sh
```

The apply command performs a full system upgrade and may install or remove
packages. AUR installation remains interactive so changes can be reviewed.

## Useful commands

Get details about a package (such as what depends on it):

```sh
pacman -Qi package-name
```
