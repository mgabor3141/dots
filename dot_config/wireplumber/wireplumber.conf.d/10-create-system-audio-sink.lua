-- Create a virtual "system-audio" sink for streaming via Sunshine
-- This allows independent volume control for system audio vs Discord

-- Load the spa-node-factory module
table.insert(alsa_monitor.rules, {
  matches = {
    {
      { "node.name", "equals", "system-audio" },
    },
  },
  apply_properties = {},
})

-- Create virtual sink on startup
default_access.properties["node.name"] = "system-audio"
default_access.properties["node.description"] = "System Audio (Streamable)"
default_access.properties["media.class"] = "Audio/Sink"
default_access.properties["audio.position"] = "FL,FR"
