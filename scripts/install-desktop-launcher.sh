#!/bin/zsh
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
app_dir="$HOME/Desktop/Terminal Workspace.app"
macos_dir="$app_dir/Contents/MacOS"
resources_dir="$app_dir/Contents/Resources"

mkdir -p "$macos_dir" "$resources_dir"
cp "$repo_dir/assets/TerminalTopology.icns" "$resources_dir/TerminalTopology.icns"

cat > "$app_dir/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>zh_CN</string>
  <key>CFBundleDisplayName</key>
  <string>Terminal Workspace</string>
  <key>CFBundleExecutable</key>
  <string>TerminalWorkspaceLauncher</string>
  <key>CFBundleIconFile</key>
  <string>TerminalTopology</string>
  <key>CFBundleIdentifier</key>
  <string>local.terminal.workspace.launcher</string>
  <key>CFBundleName</key>
  <string>Terminal Workspace</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

cat > "$macos_dir/TerminalWorkspaceLauncher" <<'LAUNCHER'
#!/bin/zsh
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export TERMINAL_WORKSPACE_LAUNCHER=1

cd "__REPO_DIR__"
mkdir -p "$HOME/Library/Logs"

log_file="$HOME/Library/Logs/TerminalWorkspaceLauncher.log"
if [[ -f "$log_file" ]]; then
  log_size=$(stat -f%z "$log_file" 2>/dev/null || echo 0)
  if (( log_size > 5242880 )); then
    mv "$log_file" "$log_file.1"
  fi
fi

exec /bin/zsh -lc "npm run dev" > "$log_file" 2>&1
LAUNCHER

perl -0pi -e 's#__REPO_DIR__#'"$repo_dir"'#g' "$macos_dir/TerminalWorkspaceLauncher"

chmod +x "$macos_dir/TerminalWorkspaceLauncher"
touch "$app_dir"
echo "Installed $app_dir"
