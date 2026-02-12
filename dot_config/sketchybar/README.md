# Sketchybar Config

Originally based on: https://github.com/OthinusG/mac-dotfiles/tree/main

## Useful Commands

```console
# View logs
log show --last 10m --predicate 'process == "sketchybar"' --style compact

# Restart (launchctl auto-restarts it)
launchctl stop io.github.felixkratz.SketchyBar

# Query an item's state
sketchybar --query space.1A
```

## Architecture: Workspace Labels

The bar shows aerospace workspaces on the left. Each workspace item (`space.<id>`) displays a highlight (background color when focused) and a label (app icons or Zed project name).

### Workspaces

Defined in `~/.config/aerospace/workspaces.conf` (shared with aerospace scripts):

- **Letter workspaces**: general purpose, labels show app icons from `sketchybar-app-font`
- **Numbered workspaces**: for code editors (Zed), labels show shortest unique prefix of project name

Empty workspaces are hidden unless focused.

### Event Flow

Aerospace fires `exec-on-workspace-change` on every workspace switch, which triggers the custom `aerospace_workspace_change` sketchybar event with `FOCUSED_WORKSPACE` and `PREV_WORKSPACE` env vars.

All workspace label and highlight logic lives in `plugins/space_windows.sh`, attached to `space_separator` (a dummy item). It is also called directly at startup by `items/spaces.sh`. The per-item `plugins/aerospace.sh` only handles mouse hover effects.

### Fast Path vs Full Refresh

`space_windows.sh` has two code paths — this is the core design decision for performance:

- **Fast path** (`aerospace_workspace_change`): Only updates highlight colors for the focused and previous workspace. Zero aerospace CLI calls. If the previous workspace is empty (detected by querying sketchybar for its current label — the fast path has no window data), it hides it. ~19ms.
- **Full refresh** (all other events): Queries all windows with a single `aerospace list-windows --all`, rebuilds all labels, sets all highlights. One batched sketchybar IPC call. ~65ms.

The fast path works because workspace switching doesn't change labels — only which workspace is highlighted. The `front_app_switched` event that follows ~200ms later triggers a full refresh if anything actually changed (e.g., a window moved).

Letter workspace moves (`ctrl-shift-a/w/r/t`) rely on `exec-on-workspace-change` for the sketchybar update. Only numbered workspace moves (`ctrl-shift-1..5`) additionally run `update-editor-mapping.sh` to persist the mapping.

### Styling

`space_styles.sh` is the single source of truth for all workspace item spacing, fonts, and padding. Both `items/spaces.sh` (creation) and `plugins/space_windows.sh` (updates) source it.

### Performance Constraints

Key decisions that keep things fast:

- Everything is idempotent — no lock files, no timing-based debouncing
- `icon_map_fn.sh` is sourced as a function, not forked per window
- All sketchybar updates are batched into a single IPC call
- Whitespace trimming uses bash builtins, not subshells
- `#!/usr/bin/env bash` is required (not `#!/bin/bash`) — macOS `/bin/bash` is Bash 3.2 which silently breaks `declare -A`

### Benchmarking Findings

Measured on an M-series Mac. These costs informed the optimization decisions:

| Operation | Cost |
|---|---|
| Any `aerospace` CLI call | ~17ms |
| Any `sketchybar` IPC call (regardless of payload size) | ~11-15ms |
| `source` a config file | ~6ms |
| `echo "$x" \| xargs` (single call) | ~10ms |
| `read -r x <<< "$x"` (bash builtin trim) | negligible |

The biggest single win was replacing `echo | xargs` whitespace trimming with `read -r` in the parse loop. With ~15 windows and 3 fields each, that was ~45 subshell forks adding ~110ms. The builtin approach costs effectively nothing.

Since sketchybar IPC cost is constant regardless of payload, batching all `--set` calls into one invocation saves ~(N-1)*13ms where N is the number of workspaces.

Before optimization, a single workspace switch triggered 11 script invocations (9x `aerospace.sh` + 2x `space_windows.sh`) making 11 aerospace CLI calls and 11 sketchybar IPC calls, totaling ~600ms. After: 1 fast path call (~19ms) + 1 full refresh (~65ms).

To re-benchmark with zero overhead, use Bash 5's `EPOCHREALTIME` builtin:

```bash
PS4='+${EPOCHREALTIME} ' bash -x ~/.config/sketchybar/plugins/space_windows.sh 2>/tmp/xtrace.log
```

## Clock Daemon

The clock and calendar items are driven by a background daemon (`helpers/clock_daemon.sh`) instead of `update_freq` polling.

sketchybar's `update_freq` is interval-based, not wall-clock-aligned: `update_freq=60` fires 60 seconds after startup, so the clock could be off by up to 59 seconds from the actual minute boundary. The naive fix (`update_freq=1`) is accurate but forks a shell + runs `date` + makes an IPC call 60 times per minute for a value that changes once.

The daemon sleeps until the next `:00` seconds boundary, then fires a custom `clock_tick` event. Both `clock` and `calendar` items subscribe to this event (and `system_woke` for sleep/wake recovery). Cost: 2 operations/minute vs 60 — a 30x reduction.

The items also keep `update_freq=60` as a fallback. If the daemon dies (nothing supervises it), the interval-based polling kicks in -- slightly drifted but never frozen. When the daemon is healthy, `clock_tick` events fire on the minute boundary and override the timer.

Other approaches considered and rejected:
- **Self-aligning sleep in the plugin script**: sketchybar kills scripts after 60 seconds, so a 58-second sleep could be terminated before updating.
- **Dynamic `update_freq` adjustment**: unclear whether changing `update_freq` resets the internal timer mid-cycle.
- **launchd calendar intervals**: requires 60 `StartCalendarInterval` entries for per-minute wall-clock firing; overkill.

## Meeting Countdown

The `meeting` item shows time until the next calendar event when it's within 30 minutes, hidden otherwise. It subscribes to `clock_tick` so it updates every minute.

Uses `icalBuddy` (Homebrew) to query the macOS Calendar store, excluding all-day events. The work calendar is synced via an ICS subscription in Calendar.app (File > New Calendar Subscription), which handles background fetching and RRULE expansion. This avoids storing any calendar credentials or URLs in the dotfiles repo -- everything lives in the system calendar database.

The ICS URL comes from a Google Apps Script that creates a read-only copy of the work calendar, working around corporate MDM restrictions that block direct Google account access from non-Chrome apps.

The countdown turns red when the meeting is within 5 minutes. One minute before start, a `terminal-notifier` notification fires (once per meeting, guarded by `.meeting_alerted`). Hovering shows the meeting title in a popup pill; clicking the item or the notification opens Google Calendar in Chrome, reusing an existing tab if one is found (`helpers/open_gcal.sh`).

## Mute Indicator

The `mic.core` item displays a glowing red LED strip across the center of the menu bar when the mic is muted. Event-driven only (`update_freq=0`), subscribes to `mic_change` (fired by Hammerspoon on toggle) and `system_woke`.

The indicator is desync-proof: the plugin queries actual system audio state via the `hs` CLI each time, rather than trusting a cached variable. The `hs` CLI returns in ~8ms, fast enough for interactive use.

### LED Glow Image

Sketchybar's shadow system only supports hard offset copies (no blur radius), so CSS-style glow effects aren't possible natively. Instead, the indicator uses a pre-rendered PNG (`images/mic_mute_led.png`) as `background.image`.

The PNG is generated by a chezmoi `modify_` script (`images/modify_mic_mute_led.png`) using ImageMagick: three composited layers (outer glow → mid glow → bright core) with gaussian blur, matching the waybar mute indicator's CSS gradient style (`dot_config/waybar-mute-indicator/style.css`). The image is regenerated on each `chezmoi apply`.

The item's `width` must match the image width (900px) for sketchybar to center it correctly — if the item is narrower than the image, the image anchors from the left edge and shifts off-center.
