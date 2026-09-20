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
| Linux | `build-essential`, `libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `libsoup-3.0-dev`, `libssl-dev` |

Full list: https://tauri.app/start/prerequisites/

### Icons

Production icons are committed under `src-tauri/icons/`. To regenerate the fallback sizes from new artwork:

```bash
cd shells/tauri-desktop
npx @tauri-apps/cli icon path/to/icon-1024.png
```

This writes all required sizes and formats (`32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`, `icon.ico`, etc.) to `src-tauri/icons/`.

The macOS bundle also carries the branded asset catalog and document icon. Keep these consistent with any replacement artwork.

### Development

```bash
cd shells/tauri-desktop
pnpm run dev
# or from repo root:
pnpm run dev:desktop
```

Tauri opens a native window. The Vite dev server runs in the background; hot reload works. The state bridge uses the filesystem override (`bridge-overrides/state.ts`) - saved states go to `$APPDATA/Lolly/saved-state/`.

### Production build

Provide `LOLLY_CATALOG_SIGNING_KEY` and `VITE_CATALOG_PUBLIC_KEY_JWK` through your private credential store. These sign the catalog embedded in the app; operating-system code signing uses a separate identity.

```bash
export LOLLY_PROFILE=lolly-start
export LOLLY_EMBED_CATALOG=profile
cd shells/tauri-desktop
pnpm run build
# or from repo root:
pnpm run build:desktop
```

Tauri first builds and signs its frontend, builds the native CLI sidecar, and builds the Quick Look extensions on macOS. It then compiles and packages the application. Output:

| Platform | Artifact | Location |
|---|---|---|
| macOS | `.app` + `.dmg` | `src-tauri/target/release/bundle/macos/` and `bundle/dmg/` |
| Windows | `.msi` + `.exe` NSIS installer | `src-tauri/target/release/bundle/` |
| Linux | `.deb` + `.AppImage` | `src-tauri/target/release/bundle/` |

The complete macOS package requires macOS 13.5 or later, matching the bundled Node CLI runtime. Set `APPLE_SIGNING_IDENTITY` for a Developer ID build, then notarise and staple the app and DMG before distribution.

For Intel Macs, use `.github/workflows/macos-intel.yml`. It builds the pinned ONNX Runtime 1.28.0 from source, verifies API 28, and bundles the resulting x86_64 library with the application. The matching Node CLI and native SVG addon are built on the Intel runner. The collected app still needs distribution signing and notarisation.

For a rebuild using the same runtime, supply `runtime_run_id` from a previous successful Intel build and `runtime_sha256` for its bundled `libonnxruntime.dylib`. The workflow checks that digest, the x86_64 architecture, runtime version and API before reuse. Leave both inputs empty to compile the runtime again.

### Cross-compilation

Tauri does not support cross-compilation out of the box. Build each platform on its native OS, or use a CI matrix (GitHub Actions `macos-latest` / `windows-latest` / `ubuntu-latest`).

---

[Back to Build Guide](/info/build-guide.html).
