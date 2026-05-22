# xremap

Per-application keyboard remapping on Niri Wayland. Sits after Kanata in the
input chain:

```
Physical keyboard -> Kanata -> xremap -> Niri
```

## Setup

Install with Niri support (required for app-specific remapping):

```bash
cargo install xremap --features niri
```

Then enable the systemd user service:

```bash
chezmoi apply
systemctl --user enable --now xremap.service
```

## Device Selection

xremap reads from Kanata's virtual device (name: `kanata`), not the physical
keyboard. This means xremap sees the *already-remapped* output from Kanata,
and applies per-app rules on top. The `--device kanata` flag in the service
ensures only this device is used.

## App Names

xremap matches apps by their window/app name as reported by Niri's toplevel
management protocol. To discover the exact names your apps report, run xremap
with debug logging:

```bash
# Temporarily stop the service, run with debug, then restart
systemctl --user stop xremap.service
RUST_LOG=debug /home/mg/.cargo/bin/xremap --device kanata ~/.config/xremap/config.yml
# Switch between your apps in the background, then Ctrl+C
systemctl --user start xremap.service
```

Common Niri app names (verify with debug output above):
- `Kitty`
- `Zed`
- `Firefox`
- `Google-chrome`
- `org.wezfurlong.wezterm` (wezterm)
- `zen-browser-bin` (Zen)

## Config

Config is at `~/.config/xremap/config.yml`. It supports:
- `modmap` - always-on key remapping
- `keymap` - combo-based remapping, can be scoped per-app
- `application.only` / `application.not` - restrict remaps to specific apps

See `config.yml` for the current rules and the xremap README for full syntax.
