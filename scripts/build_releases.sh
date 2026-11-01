#!/usr/bin/env bash
# Build WebDeck release artifacts into ./releases
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/releases"
mkdir -p "$OUT"

cd "$ROOT"
flutter pub get

echo "==> macOS release"
flutter build macos --release
MAC_APP="$ROOT/build/macos/Build/Products/Release/webdeck.app"
if [[ -d "$MAC_APP" ]]; then
  ditto -c -k --sequesterRsrc --keepParent "$MAC_APP" "$OUT/WebDeck-macos-arm64.zip"
  echo "Wrote $OUT/WebDeck-macos-arm64.zip"
fi

echo "==> Android APK + App Bundle"
flutter build apk --release
flutter build appbundle --release
cp -f "$ROOT/build/app/outputs/flutter-apk/app-release.apk" "$OUT/WebDeck-android-release.apk"
cp -f "$ROOT/build/app/outputs/bundle/release/app-release.aab" "$OUT/WebDeck-android-release.aab"
echo "Wrote Android APK/AAB"

echo "==> iOS (no codesign — sign in Xcode for App Store / device install)"
flutter build ios --release --no-codesign
IOS_APP="$ROOT/build/ios/iphoneos/Runner.app"
if [[ -d "$IOS_APP" ]]; then
  ditto -c -k --sequesterRsrc --keepParent "$IOS_APP" "$OUT/WebDeck-ios-unsigned.zip"
  echo "Wrote $OUT/WebDeck-ios-unsigned.zip"
fi

if [[ "$(uname -s)" == "MINGW"* ]] || [[ "$(uname -s)" == "MSYS"* ]] || [[ "$(uname -s)" == "CYGWIN"* ]] || [[ "${OS:-}" == "Windows_NT" ]]; then
  echo "==> Windows release"
  flutter build windows --release
  WIN_DIR="$ROOT/build/windows/x64/runner/Release"
  if [[ -d "$WIN_DIR" ]]; then
    (cd "$WIN_DIR/.." && zip -r "$OUT/WebDeck-windows-x64.zip" Release)
    echo "Wrote $OUT/WebDeck-windows-x64.zip"
  fi
else
  echo "==> Windows skipped (build on a Windows machine): flutter build windows --release"
  cat > "$OUT/Windows-build-instructions.txt" <<'EOF'
Build on Windows with Flutter installed:

  flutter pub get
  flutter build windows --release

Output folder:
  build\windows\x64\runner\Release\

Zip that Release folder as WebDeck-windows-x64.zip for distribution.
EOF
fi

echo ""
echo "Done. Artifacts in: $OUT"
ls -lh "$OUT"
