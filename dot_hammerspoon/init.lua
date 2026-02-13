---@diagnostic disable: undefined-global

hs.ipc.cliInstall()

hs.hotkey.bind({"ctrl"}, "Z", function()
    hs.window.focusedWindow():close()
end)

hs.hotkey.bind({"ctrl"}, ".", function()
    hs.eventtap.keyStroke({"ctrl", "cmd"}, "space")
end)

-- Sleep trigger (Hyper+S via kanata).
-- Razer: physical Break key → kanata @sleep alias → Hyper+S
-- Go60: ZMK sends C_SLEEP (Linux) + F21 (macOS) → kanata defoverride → Hyper+S
hs.hotkey.bind({"ctrl", "shift", "alt", "cmd"}, "s", function()
    -- Delay the sleep so it's not immediately woken up by the keyup
    hs.timer.doAfter(0.5, function()
        hs.caffeinate.systemSleep()
    end)
end)

-- Global mute toggle (F13 → Hyper+M via kanata defoverrides)
-- F13 is produced by kanata (physical key on Razer, chord on other keyboards)
-- On Linux this is handled by niri; on macOS, kanata remaps F13 to Hyper+M
-- because macOS sends bare F13 as a system event that hs.hotkey can't catch.
--
-- The Scarlett 8i6 (primary input) doesn't expose mute/volume to CoreAudio,
-- so we mute by switching the default input to the built-in mic (muted),
-- and unmute by switching back to the real device.
local muted = false
local unmutedDeviceName = nil

local function toggleMute()
    muted = not muted

    if muted then
        local current = hs.audiodevice.defaultInputDevice()
        if not current then
            hs.alert.show("No input device found")
            muted = false
            return
        end

        -- Guard: don't switch devices while FluidVoice is dictating —
        -- it shows an AXSystemDialog overlay during active dictation and
        -- crashes if the default input device changes mid-stream.
        local fluid = hs.application.find("com.FluidApp.app")
        if fluid then
            for _, w in ipairs(fluid:allWindows()) do
                if w:subrole() == "AXSystemDialog" then
                    hs.alert.show("Dictation active — can't mute")
                    muted = false
                    return
                end
            end
        end

        unmutedDeviceName = current:name()
        local builtIn = hs.audiodevice.findInputByName("MacBook Pro Microphone")
        if builtIn then
            builtIn:setDefaultInputDevice()
            builtIn:setInputMuted(true)
        else
            hs.alert.show("Mute failed: built-in mic not found")
            muted = false
            return
        end
    else
        if unmutedDeviceName then
            local original = hs.audiodevice.findInputByName(unmutedDeviceName)
            if original then
                original:setDefaultInputDevice()
            end
        end
    end

    -- Notify sketchybar immediately (it also queries actual system state)
    hs.execute("/opt/homebrew/bin/sketchybar --trigger mic_change", true)
end

hs.hotkey.bind({"ctrl", "shift", "alt", "cmd"}, "m", toggleMute)

-- Key remapping (Cmd+arrows, Home/End, etc.) is handled by kanata defoverrides
-- in dot_config/kanata/1-configs/shared/common.kbd
