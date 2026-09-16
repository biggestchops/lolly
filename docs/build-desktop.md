# Build the desktop app

Set up and package the Tauri desktop shell.

Part of [Build Guide](/info/build-guide.html).

## Desktop app (macOS / Windows / Linux)

### Prerequisites

<!--l:rust-->**Rust toolchain:**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup update
```

<!--l:tauri-->**Tauri CLI (Node package - installed per-shell):**

```bash
cd shells/tauri-desktop
pnpm install
```

**Platform build tools:**

| Platform | Required |
|---|---|
| macOS | Xcode Command Line Tools (`xcode-select --install`) |
| Windows | Microsoft C++ Build Tools or Visual Studio with C++ workload |
| Linux | `build-essential`, `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libappindicator3-dev` |

Full list: https://tauri.app/start/prerequisites/

### Icons

Tauri requires icon files at `src-tauri/icons/`. Generate them from a 1024×1024 source PNG (the build will fail with a missing-file error if this step is skipped):

```bash
cd shells/tauri-desktop
npx @tauri-apps/cli icon path/to/icon-1024.png
```

This writes all required sizes and formats (`32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico`, etc.) to `src-tauri/icons/`.

> Placeholder icons committed to the repo are solid-green squares - replace them with production artwork before releasing.

### Development

```bash
cd shells/tauri-desktop
pnpm run dev
# or from repo root:
pnpm run dev:desktop
```

Tauri opens a native window. The Vite dev server runs in the background; hot reload works. The state bridge uses the filesystem override (`bridge-overrides/state.ts`) - saved states go to `$APPDATA/Lolly/saved-state/`.

### Production build

```bash
cd shells/tauri-desktop
pnpm run build
# or from repo root:
pnpm run build:desktop
```

This runs `vite build` (producing `dist/`) then `tauri build`. Output:

| Platform | Artifact | Location |
|---|---|---|
| macOS | `.app` + `.dmg` | `src-tauri/target/release/bundle/macos/` |
| Windows | `.msi` + `.exe` NSIS installer | `src-tauri/target/release/bundle/` |
| Linux | `.deb` + `.AppImage` | `src-tauri/target/release/bundle/` |

### Cross-compilation

Tauri does not support cross-compilation out of the box. Build each platform on its native OS, or use a CI matrix (GitHub Actions `macos-latest` / `windows-latest` / `ubuntu-latest`).

---

[Back to Build Guide](/info/build-guide.html).
