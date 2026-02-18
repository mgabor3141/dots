---@diagnostic disable: undefined-global

hs.ipc.cliInstall()

hs.hotkey.bind({"ctrl"}, "escape", function()
    hs.spaces.toggleMissionControl()
end)

-- Hold ⌘Q to quit: shows an alert and only sends the real Cmd+Q if held for 0.5s.
local cmdQTimer = nil
local cmdQAlert = nil
local cmdQHotkey
cmdQHotkey = hs.hotkey.bind({"cmd"}, "q",
    function() -- pressed
        cmdQAlert = hs.alert.show("Hold ⌘Q to quit", "indefinite")
        cmdQTimer = hs.timer.doAfter(0.5, function()
            hs.alert.closeSpecific(cmdQAlert)
            cmdQAlert = nil
            cmdQHotkey:disable()
            hs.eventtap.keyStroke({"cmd"}, "q")
            hs.timer.doAfter(0.1, function()
                cmdQHotkey:enable()
            end)
        end)
    end,
    function() -- released
        if cmdQTimer then
            cmdQTimer:stop()
            cmdQTimer = nil
        end
        if cmdQAlert then
            hs.alert.closeSpecific(cmdQAlert)
            cmdQAlert = nil
        end
    end
)

hs.hotkey.bind({"ctrl"}, "X", function()
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
--
-- When the Scarlett is disconnected, mute/unmute operates directly on the
-- built-in mic. An audiodevice watcher automatically restores the Scarlett
-- as the default input when it reconnects (unless currently muted).
local muted = false
local BUILTIN_MIC = "MacBook Pro Microphone"
local preferredInputName = "Scarlett 8i6 USB"

-- Detect initial state: if we start with the built-in mic muted, we're muted.
-- This handles Hammerspoon restarts while muted.
local function detectInitialMuteState()
    local current = hs.audiodevice.defaultInputDevice()
    if current and current:name() == BUILTIN_MIC and current:inputMuted() then
        muted = true
    end
end

local function isFluidVoiceDictating()
    local fluid = hs.application.find("com.FluidApp.app")
    if fluid then
        for _, w in ipairs(fluid:allWindows()) do
            if w:subrole() == "AXSystemDialog" then
                return true
            end
        end
    end
    return false
end

local function findPreferredInput()
    return hs.audiodevice.findInputByName(preferredInputName)
end

local function findBuiltInMic()
    return hs.audiodevice.findInputByName(BUILTIN_MIC)
end

local function notifySketchybar()
    hs.execute("/opt/homebrew/bin/sketchybar --trigger mic_change", true)
end

local function toggleMute()
    muted = not muted

    if muted then
        -- Guard: don't switch devices while FluidVoice is dictating
        if isFluidVoiceDictating() then
            hs.alert.show("Dictation active — can't mute")
            muted = false
            return
        end

        local current = hs.audiodevice.defaultInputDevice()
        if not current then
            hs.alert.show("No input device found")
            muted = false
            return
        end

        -- Remember the preferred device if it's something other than the built-in
        if current:name() ~= BUILTIN_MIC then
            preferredInputName = current:name()
        end

        local builtIn = findBuiltInMic()
        if builtIn then
            -- Switch to built-in mic and mute it (works whether Scarlett is
            -- connected or not — if already on built-in, just mutes it)
            if current:name() ~= BUILTIN_MIC then
                builtIn:setDefaultInputDevice()
            end
            builtIn:setInputMuted(true)
        else
            hs.alert.show("Mute failed: built-in mic not found")
            muted = false
            return
        end
    else
        -- Unmute: restore preferred device if available, otherwise unmute built-in
        local preferred = findPreferredInput()
        if preferred then
            preferred:setDefaultInputDevice()
        else
            -- Scarlett not connected — just unmute the built-in mic
            local builtIn = findBuiltInMic()
            if builtIn then
                builtIn:setInputMuted(false)
            end
        end
    end

    notifySketchybar()
end

hs.hotkey.bind({"ctrl", "shift", "alt", "cmd"}, "m", toggleMute)

-- Audio device watcher: auto-restore the preferred input when it reconnects.
-- The "dev#" event fires when an audio device is added or removed.
hs.audiodevice.watcher.setCallback(function(event)
    if event ~= "dev#" then return end

    local preferred = findPreferredInput()
    if preferred then
        -- Preferred device just (re)appeared
        if not muted then
            -- Restore it as default input
            local current = hs.audiodevice.defaultInputDevice()
            if current and current:name() ~= preferredInputName then
                preferred:setDefaultInputDevice()
                notifySketchybar()
            end
        end
        -- If muted, do nothing — the Scarlett is available but we stay on
        -- the muted built-in mic. Unmute will switch to it.
    end
end)
hs.audiodevice.watcher.start()

detectInitialMuteState()

-- Key remapping (Cmd+arrows, Home/End, etc.) is handled by kanata defoverrides
-- in dot_config/kanata/1-configs/shared/common.kbd
