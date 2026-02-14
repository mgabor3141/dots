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

This repo supports headless deployment with a minimal subset of configs (shell, git, CLI tools) via the `headless` chezmoi variable. The `.chezmoiignore` uses a whitelist pattern to deploy only bash configs, git, and a few CLI tools.

Unraid-specific system setup (boot scripts, persistent storage, etc.) is managed in a separate repo.
