# pacman and paru

https://wiki.archlinux.org/title/Pacman
https://wiki.archlinux.org/title/Pacman/Tips_and_tricks
https://github.com/graysky2/lostfiles

## IgnorePkg

`.pacman-ignorepkg.txt` lists packages to hold back (one per line).
An onchange script updates `/etc/pacman.conf`'s `IgnorePkg` line via sudo.

To unpin: remove the package from the file, then `chezmoi apply ~/pacman/`.

## Useful commands

Get details about a package (such as what depends on it)

```sh
pacman -Qi package-name
```
