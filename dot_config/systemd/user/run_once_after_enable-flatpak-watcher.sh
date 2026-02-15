#!/bin/bash
systemctl --user daemon-reload
systemctl --user enable --now update-flatpak-package-files.path
