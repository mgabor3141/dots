# Wait until the session is unlocked
while [[ "$(stat -f '%Sg' /dev/console)" != "staff" ]]; do
    sleep 5
done

# Set wallpaper
osascript -e "tell application \"System Events\" to tell every desktop to set picture to \"$IMAGE\""
