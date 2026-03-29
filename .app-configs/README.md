# App Configs

Backup of per-app/game configuration that isn't managed by chezmoi (Steam Cloud doesn't sync these either). Each subdirectory contains config fragments and restore instructions.

## Satisfactory

ESDF keybinds and engine overrides (FXAA instead of TAA).

**Config location:**
```
~/.local/share/Steam/steamapps/compatdata/526870/pfx/drive_c/users/steamuser/AppData/Local/FactoryGame/Saved/Config/Windows/
```

**Restore keybinds:** paste the contents of `keybinds.txt` into `GameUserSettings.ini` under the `[/Script/FactoryGame.FGGameUserSettings]` section.

```bash
# Quick copy (append keybinds to GameUserSettings.ini)
DEST=~/.local/share/Steam/steamapps/compatdata/526870/pfx/drive_c/users/steamuser/AppData/Local/FactoryGame/Saved/Config/Windows
cat "$(chezmoi source-path)/.app-configs/satisfactory/keybinds.txt" >> "$DEST/GameUserSettings.ini"
```

**Restore engine overrides:** append the contents of `engine-overrides.txt` to `Engine.ini`.

```bash
DEST=~/.local/share/Steam/steamapps/compatdata/526870/pfx/drive_c/users/steamuser/AppData/Local/FactoryGame/Saved/Config/Windows
cat "$(chezmoi source-path)/.app-configs/satisfactory/engine-overrides.txt" >> "$DEST/Engine.ini"
```
