# Build the mobile apps

Set up, develop and package Android and iOS shells.

Part of [Build Guide](/info/build-guide.html).

## Mobile apps (iOS / Android)

### Prerequisites

Install the [Rust toolchain and Tauri CLI](/info/build-desktop.html#prerequisites), then add the prerequisites for your target:

#### Android

1. <!--l:android-->Install [Android Studio](https://developer.android.com/studio)
2. In SDK Manager, install:
   - Android SDK Platform (API 33 or higher)
   - NDK (Side by side) - version 26+
   - Android SDK Command-line Tools
3. Set environment variables:

```bash
export ANDROID_HOME=$HOME/Library/Android/sdk   # macOS
export NDK_HOME=$ANDROID_HOME/ndk/$(ls $ANDROID_HOME/ndk | tail -1)
```

4. Add Android Rust targets:

```bash
rustup target add \
  aarch64-linux-android \
  armv7-linux-androideabi \
  i686-linux-android \
  x86_64-linux-android
```

#### iOS (macOS only)

1. <!--l:apple-->Install Xcode from the App Store (the full app, not just the Command Line Tools)
2. Accept the license: `sudo xcodebuild -license accept`
3. Install CocoaPods - `tauri ios init` generates a Podfile and runs `pod install`: `brew install cocoapods`
4. Add iOS Rust targets:

```bash
rustup target add \
  aarch64-apple-ios \
  aarch64-apple-ios-sim \
  x86_64-apple-ios
```

See [Building for iOS](/info/ios-build.html) for the full iOS walkthrough - prerequisites, one-time init, the simulator dev loop, code signing and camera permissions.

### First-time platform init

Run once to generate the native project files (`gen/android/` or `gen/apple/`):

```bash
cd shells/tauri-mobile
pnpm install

# Android
pnpm run tauri android init

# iOS
pnpm run tauri ios init
```

The `gen/` directory contains the generated Gradle / Xcode projects. It is gitignored - regenerate it with the init command on a fresh checkout.

### Icons (mobile)

```bash
cd shells/tauri-mobile
npx @tauri-apps/cli icon path/to/icon-1024.png
```

### Development

**Android** (emulator or connected device with USB debugging enabled):

```bash
cd shells/tauri-mobile
pnpm run dev:android
# or from repo root:
pnpm run dev:android
```

**iOS** (macOS only - requires Simulator or provisioned device):

```bash
cd shells/tauri-mobile
pnpm run dev:ios
# or from repo root:
pnpm run dev:ios
```

### Production build

```bash
# Android - outputs APK + AAB
pnpm run build:android
# or: pnpm run build:android from repo root

# iOS - outputs .ipa
pnpm run build:ios
# or: pnpm run build:ios from repo root
```

**Android signing** - set these env vars before building for release:

```bash
export ANDROID_KEY_STORE=/path/to/keystore.jks
export ANDROID_KEY_STORE_PASSWORD=...
export ANDROID_KEY_ALIAS=...
export ANDROID_KEY_PASSWORD=...
```

**iOS signing** - configure your Development Team in Xcode:

```bash
cd gen/apple
open Lolly.xcodeproj
```

Set the team in the project's Signing & Capabilities tab, then build from CLI or Xcode.

---

[Back to Build Guide](/info/build-guide.html).
