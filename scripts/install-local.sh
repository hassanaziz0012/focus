#!/usr/bin/env bash
set -euo pipefail

uuid='focus-tasks@hassan.local'
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target_dir="$HOME/.local/share/gnome-shell/extensions/$uuid"
was_enabled=false

if gnome-extensions list --enabled 2>/dev/null | grep -Fxq "$uuid"; then
    was_enabled=true
fi

mkdir -p "$target_dir"
find "$source_dir" -maxdepth 1 -type f -name '*.js' -o -name metadata.json | while read -r file; do
    install -Dm644 "$file" "$target_dir/$(basename "$file")"
done
if [ -d "$source_dir/lib" ]; then
    mkdir -p "$target_dir/lib"
    find "$source_dir/lib" -type f -name '*.js' | while read -r file; do
        install -Dm644 "$file" "$target_dir/lib/$(basename "$file")"
    done
fi
install -Dm644 "$source_dir/schemas/org.gnome.shell.extensions.focus-tasks.gschema.xml" "$target_dir/schemas/org.gnome.shell.extensions.focus-tasks.gschema.xml"
glib-compile-schemas "$target_dir/schemas"
echo "Installed $uuid to $target_dir"

if "$was_enabled"; then
    gnome-extensions disable "$uuid"
    gnome-extensions enable "$uuid"
    echo "Reloaded $uuid."
else
    echo "Enable it with: gnome-extensions enable $uuid"
fi
