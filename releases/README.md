# WebDeck release artifacts

Built with Flutter on macOS. Regenerate via:

```bash
./scripts/build_releases.sh
```

| Artifact | Platform | Notes |
| :--- | :--- | :--- |
| `WebDeck-macos-arm64.zip` | macOS Apple Silicon | Unzip → `webdeck.app` |
| `WebDeck-android-release.apk` | Android | Sideload / internal testing |
| `WebDeck-android-release.aab` | Android | Play Console upload |
| `WebDeck-ios-unsigned.zip` | iOS | Unsigned `Runner.app` — sign in Xcode before device/App Store |
| `Windows-build-instructions.txt` | Windows | Build on Windows; see file |

**Note:** These binaries are large. Prefer GitHub Releases for distribution if the git repo grows too big; keep this folder for local packaging.
