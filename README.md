# dots

Managed using [chezmoi](https://www.chezmoi.io/)

Apply this config anywhere:

```sh
sh -c "$(curl -fsLS get.chezmoi.io)" -- init --apply mgabor3141/dots
```

You will be asked for your password to perform some of the steps.

Reboot when prompted, and after the script successfully completes.

Tested on CachyOS and MacOS

## Headless / Server Deployment

This repo supports headless deployment with a minimal subset of configs (shell, git, CLI tools). See [docs/headless-unraid.md](docs/headless-unraid.md) for Unraid-specific setup, including how to handle its tmpfs root filesystem.
