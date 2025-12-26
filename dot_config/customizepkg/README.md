# customizepkg

https://github.com/ava1ar/customizepkg
https://www.supertechcrew.com/customizing-aur-arch-package-with-customizepkg/

Don't forget that you need to clean the build folder after uninstalling the package to trigger a rebuild.

Example:

```sh
paru -R vesktop-git && paru -Sc
paru -S vesktop-git
```
