#!/usr/bin/env bash
#
# Open Google Calendar in Chrome, reusing an existing tab if found.
# Used by the meeting sketchybar plugin and terminal-notifier click action.

osascript -e '
set gcalURL to "calendar.google.com"
set fullURL to "https://calendar.google.com"

if application "Google Chrome" is running then
    tell application "Google Chrome"
        set found to false
        repeat with w in windows
            set tabIndex to 0
            repeat with t in tabs of w
                set tabIndex to tabIndex + 1
                if URL of t contains gcalURL then
                    set active tab index of w to tabIndex
                    set index of w to 1
                    set found to true
                    exit repeat
                end if
            end repeat
            if found then exit repeat
        end repeat
        if not found then
            tell front window to make new tab with properties {URL:fullURL}
        end if
        activate
    end tell
else
    do shell script "open -a \"Google Chrome\" " & quoted form of fullURL
end if
'
