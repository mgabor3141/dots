local wezterm = require("wezterm")
local config = wezterm.config_builder()

-- Font
config.font = wezterm.font({
	family = "Fira Code",
	weight = 450,
	harfbuzz_features = { "liga", "calt", "cv02", "ss01", "ss03" },
})
config.font_size = 11

-- Appearance
config.window_background_opacity = 0.9
config.window_padding = { left = 8, right = 8, top = 8, bottom = 8 }
config.window_decorations = "RESIZE"
config.default_cursor_style = "SteadyBar"
config.hide_tab_bar_if_only_one_tab = true
config.window_close_confirmation = "NeverPrompt"

-- Nord color scheme
config.colors = {
	foreground = "#D8DEE9",
	background = "#2E3440",

	cursor_bg = "#D8DEE9",
	cursor_fg = "#2E3440",
	cursor_border = "#D8DEE9",

	selection_fg = "none",
	selection_bg = "rgba(136, 192, 208, 0.3)",

	ansi = {
		"#3B4252", -- black
		"#BF616A", -- red
		"#A3BE8C", -- green
		"#EBCB8B", -- yellow
		"#81A1C1", -- blue
		"#B48EAD", -- magenta
		"#88C0D0", -- cyan
		"#E5E9F0", -- white
	},
	brights = {
		"#98969e", -- bright black (matches kitty color8)
		"#BF616A", -- bright red
		"#A3BE8C", -- bright green
		"#EBCB8B", -- bright yellow
		"#81A1C1", -- bright blue
		"#B48EAD", -- bright magenta
		"#8FBCBB", -- bright cyan
		"#ECEFF4", -- bright white
	},
}

-- SSH domain for unraid
config.ssh_domains = {
	{
		name = "unraid",
		remote_address = "unraid.local",
		assume_shell = "Posix",
		multiplexing = "None",
	},
}

-- Keyboard: enable kitty keyboard protocol so modifier+key combos
-- (like Shift+Enter) are properly encoded and distinguishable.
config.enable_kitty_keyboard = true

-- Key mappings
config.keys = {
	-- Spawn a tab without tmux (for TUI apps like pi that flicker in tmux)
	{
		key = "t",
		mods = "CTRL|SHIFT|ALT",
		action = wezterm.action.SpawnCommandInNewTab({
			set_environment_variables = { TMS_SKIP = "1" },
		}),
	},
}

-- macOS
config.send_composed_key_when_left_alt_is_pressed = false
config.send_composed_key_when_right_alt_is_pressed = false

return config
