#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

uuid=$(python3 -c 'import json; print(json.load(open("metadata.json"))["uuid"])' 2>/dev/null || echo "focus-tasks@hassandev.me")

echo "==> Packaging GNOME Shell Extension: $uuid"

# 1. Compile GSettings schemas locally
echo "==> Compiling schemas..."
if command -v glib-compile-schemas >/dev/null 2>&1; then
    glib-compile-schemas schemas/
fi

# 2. Package using the official gnome-extensions tool
echo "==> Creating extension package..."
if command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions pack \
        --extra-source=lib \
        --extra-source=schemas \
        --force \
        --out-dir="$script_dir" \
        "$script_dir"
else
    # Fallback to python zipfile if gnome-extensions CLI is not found
    python3 -c '
import zipfile, os
uuid = "'"${uuid}"'"
out_file = f"{uuid}.shell-extension.zip"
with zipfile.ZipFile(out_file, "w", zipfile.ZIP_DEFLATED) as z:
    for f in ["metadata.json", "extension.js", "prefs.js"]:
        if os.path.exists(f): z.write(f)
    for folder in ["lib", "schemas"]:
        for root, _, files in os.walk(folder):
            for file in files:
                p = os.path.join(root, file)
                z.write(p)
print(f"Packaged via python zipfile to {out_file}")
'
fi

zip_name="${uuid}.shell-extension.zip"

echo "==> Package created successfully: ${zip_name}"
echo ""
echo "--- Archive Contents ---"
python3 -c "
import zipfile
with zipfile.ZipFile('${zip_name}', 'r') as z:
    for info in z.infolist():
        if not info.filename.endswith('/'):
            print(f'  ✓ {info.filename}')
"
echo "------------------------"
echo ""
echo "Ready to upload ${zip_name} to https://extensions.gnome.org/upload/"
