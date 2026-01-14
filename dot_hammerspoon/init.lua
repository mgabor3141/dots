---@diagnostic disable: undefined-global

hs.ipc.cliInstall()

hs.hotkey.bind({"ctrl"}, "X", function()
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

KEY = hs.keycodes.map
Log = hs.logger.new("KeyRemap", "debug")
hs.logger.setGlobalLogLevel("debug")
-- hs.logger.setGlobalLogLevel("info")

function EventToString(event)
    local type = event:getType() == hs.eventtap.event.types.keyDown and "DOWN" or
              event:getType() == hs.eventtap.event.types.keyUp and "UP" or
              tostring(event:getType())
    local key = KEY[event:getKeyCode()] or tostring(event:getKeyCode())

    local flags = {}
    if event:getFlags().cmd   then table.insert(flags, "cmd") end
    if event:getFlags().alt   then table.insert(flags, "alt") end
    if event:getFlags().ctrl  then table.insert(flags, "ctrl") end
    if event:getFlags().shift then table.insert(flags, "shift") end

    return string.format("[%s] %s%s", type, #flags>0 and table.concat(flags,"+").." +" or "", key)
end

-- --- Remap definitions ---
Rules = {
    -- Cmd + left/right/backspace/delete mapped to Option equivalents
    {key=KEY.left,          mandatory={"cmd"}, optional={"shift"}, output={mods={"alt"}, key=KEY.left}},
    {key=KEY.right,         mandatory={"cmd"}, optional={"shift"}, output={mods={"alt"}, key=KEY.right}},
    {key=KEY.delete,        mandatory={"cmd"}, optional={}, output={mods={"alt"}, key=KEY.delete}},
    {key=KEY.forwarddelete, mandatory={"cmd"}, optional={}, output={mods={"alt"}, key=KEY.forwarddelete}},

    -- Option + left/right mapped to F keys so that they're still available to bind to
    {key=KEY.left,  mandatory={"alt"}, optional={}, output={mods={"alt"}, key=KEY.f18}},
    {key=KEY.right, mandatory={"alt"}, optional={}, output={mods={"alt"}, key=KEY.f19}},

    -- Home/End → Cmd+Left/Right
    {key=KEY.home,   mandatory={}, optional={"shift"}, output={mods={"cmd"}, key=KEY.left}},
    {key=KEY["end"], mandatory={}, optional={"shift"}, output={mods={"cmd"}, key=KEY.right}},
}

-- --- Build lookup table keyed by key + mandatory mods ---
-- Format: lookup[keyCode] = {list of rules}
RuleMap = {}
for _, rule in ipairs(Rules) do
    local key = rule.key
    RuleMap[key] = RuleMap[key] or {}
    table.insert(RuleMap[key], rule)
end

function Apply(rule, originalEvent)
    local event = originalEvent:copy()
    local flags = event:getFlags()

    for _, mod in ipairs(rule.mandatory) do
        if not flags[mod] then return false end
        flags[mod] = false
    end

    for mod, enabled in pairs(flags) do
        if enabled and not hs.fnutils.contains(rule.optional, mod) and mod ~= "fn"
        then
            return false
        end
    end

    if not rule.output.key then
        Log.ef("Keycode not found (event: %s)", EventToString(originalEvent))
        return false
    end
    event:setKeyCode(rule.output.key)

    for _, mod in ipairs(rule.output.mods) do
        flags[mod] = true
    end

    event:setFlags(flags)

    Log.df(
        "%s → %s",
        EventToString(originalEvent),
        EventToString(event)
    )

    return true, event
end

Remapper = hs.eventtap.new(
    {hs.eventtap.event.types.keyDown, hs.eventtap.event.types.keyUp},
    function(event)
        local rules = RuleMap[event:getKeyCode()]

        if rules then
            for _, rule in ipairs(rules) do
                local applies, remappedEvent = Apply(rule, event)
                if applies then
                    return true, { remappedEvent }
                end
            end
        end

        return false
    end
)

Remapper:start()
