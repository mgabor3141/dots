#!/usr/bin/env bash
trap 'echo "❌ Error on line $LINENO: $BASH_COMMAND" >&2' ERR
set -Eeuo pipefail

# Passwordless 'reboot-to-windows': a scoped sudoers rule letting the user write
# only Limine's remembered-entry variable via a fixed payload path. Needed
# because efivarfs blocks non-root writes and ignores chmod/chgrp.

if [ "$(id -u)" -ne 0 ]; then
    sudo "$0" "$@"
    exit $?
fi

user="${SUDO_USER:?reboot-to-windows sudoers must be installed via sudo}"
uid="$(id -u "$user")"
efivar_bin="$(command -v efivar || echo /usr/bin/efivar)"
guid="513ee0d0-6e43-cb05-b272-f146a2fcb88a"  # Limine vendor GUID (menu.c)
name="LimineLastBootedEntry"

cat > /etc/sudoers.d/reboot-to-windows <<EOF
# Managed by chezmoi: allows '${user}' to set the next boot entry without a password.
${user} ALL=(root) NOPASSWD: ${efivar_bin} -n ${guid}-${name} -w -f /run/user/${uid}/reboot-to-windows.efivar
EOF
chmod 0440 /etc/sudoers.d/reboot-to-windows
visudo -cf /etc/sudoers.d/reboot-to-windows

echo "✅ passwordless reboot-to-windows enabled for ${user}"
