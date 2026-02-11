---@diagnostic disable: undefined-global

hs.ipc.cliInstall()

hs.hotkey.bind({"ctrl"}, "Z", function()
    hs.window.focusedWindow():close()
end)

hs.hotkey.bind({"ctrl"}, ".", function()
    hs.eventtap.keyStroke({"ctrl", "cmd"}, "space")
end)

hs.hotkey.bind({"ctrl", "cmd", "shift"}, "Q", function()
    -- Delay the sleep so it's not immediately woken up by the keyup
    hs.timer.doAfter(0.5, function()
        hs.caffeinate.systemSleep()
    end)
end)

-- Key remapping (Cmd+arrows, Home/End, etc.) is handled by kanata defoverrides
-- in dot_config/kanata/1-configs/shared/common.kbd
