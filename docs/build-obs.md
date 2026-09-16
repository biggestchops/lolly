# Build with Open Build Service

Plan OBS recipes for Lolly artifacts and their dependencies.

Part of [Build Guide](/info/build-guide.html).

## Open Build Service (OBS)

[Open Build Service](https://openbuildservice.org) is SUSE's source-to-package build system. It compiles a single source definition into native packages for many distributions at once, in clean and reproducible network-isolated chroots, and publishes them through signed, hosted repositories. One Lolly package definition on OBS can target the whole Linux matrix below from the same source.

### What OBS can build for Lolly

| Format | Distributions | Lolly artifact packaged |
|---|---|---|
| RPM | <!--l:opensuse-->openSUSE Leap / Tumbleweed, SLE / SLES, <!--l:fedora-->Fedora, RHEL / CentOS / Alma / Rocky, Mageia, openEuler | CLI binary and/or Tauri desktop app |
| DEB | <!--l:debian-->Debian, <!--l:ubuntu-->Ubuntu, Raspbian | CLI binary and/or Tauri desktop app |
| Arch | <!--l:arch-->Arch Linux (`PKGBUILD`) | CLI binary / desktop app |
| <!--l:flatpak-->Flatpak | distro-agnostic sandboxed desktop app | Tauri desktop app |
| AppImage | distro-agnostic portable app | reuses Tauri's `.AppImage` output |
| Container images | OCI / <!--l:docker-->Docker (built via Kiwi or a `Dockerfile`) | CLI as a container image |
| Appliance / disk images | ISO, VM and cloud images (built via Kiwi) | full preloaded image |

The local Tauri build already emits a `.deb` and an `.AppImage` (see the Desktop table above). OBS does not replace that - its value is **fan-out across the rest of the matrix** (every RPM- and deb-based distro, Arch, Flatpak, containers, appliances) plus **signed, hosted repositories** that users can add and update from like any other system package.

### How it fits Lolly's artifacts

OBS packages one of the two Linux artifacts this guide already produces:

- **The standalone CLI binary** - the esbuild + `@yao-pkg/pkg` output from the CLI section above. The `tools/` and `catalog/` directories must ship alongside the binary (the CLI resolves them relative to its own location), so that layout carries straight into the package's `%files` (RPM) or `debian/install` (deb) list.
- **The Tauri desktop app** - the `tauri build` output, packaged as RPM / DEB / Flatpak / AppImage for desktop delivery.

### Build-environment constraints

> **No network at build time.** OBS builds inside clean, network-isolated chroots, so every build input must be present up front. For a Node + Vite + Rust/Tauri app this is the main porting effort: vendor the npm and Cargo dependencies (an offline npm cache / `cargo vendor`) or supply them through OBS source services, and declare the toolchain as `BuildRequires` - e.g. `nodejs>=20`, `npm`, `rust`, `cargo`, plus the desktop build's GTK/WebKit `-devel` packages (`libgtk-3-dev`, `libwebkit2gtk-4.1-dev`, `libappindicator3-dev` and equivalents).

### Illustrative project layout

The snippets below are **illustrative starting points, not a production-tested recipe** - they show what an OBS package for Lolly looks like.

A `_service` file fetches and versions the source from git at build time:

```ini
<services>
  <service name="obs_scm" mode="manual">
    <param name="scm">git</param>
    <param name="url">https://github.com/lolly-tools/lolly.git</param>
    <param name="revision">v1.0.0</param>
    <param name="versionformat">@PARENT_TAG@</param>
  </service>
  <service name="set_version" mode="buildtime"/>
  <service name="tar" mode="buildtime"/>
</services>
```

A trimmed RPM `.spec` declares the toolchain, builds the artifact and installs it with the required `tools/` + `catalog/` layout:

```spec
Name:           lolly
Version:        1.0.0
Release:        0
Summary:        Lolly - template-driven creative asset generator
License:        MPL-2.0
URL:            https://lolly.tools
Source0:        %{name}-%{version}.tar.gz

BuildRequires:  nodejs >= 20
BuildRequires:  npm
BuildRequires:  rust
BuildRequires:  cargo

%build
pnpm install --frozen-lockfile --offline
# CLI binary: bundle with esbuild, then wrap with @yao-pkg/pkg (see CLI » Standalone binary above).
# For the desktop app instead, run `pnpm run build:desktop`.
pnpm exec esbuild shells/cli/bin/lolly.ts --bundle --platform=node \
  --target=node20 --format=cjs --outfile=shells/cli/dist/lolly.cjs
npx @yao-pkg/pkg shells/cli/dist/lolly.cjs \
  --targets node20-linux-x64 --output shells/cli/dist/lolly

%install
install -Dm0755 shells/cli/dist/lolly %{buildroot}%{_bindir}/lolly
cp -a tools   %{buildroot}%{_datadir}/lolly/tools
cp -a catalog %{buildroot}%{_datadir}/lolly/catalog

%files
%license LICENSE
%{_bindir}/lolly
%{_datadir}/lolly/
```

A matching `debian/` directory (`control`, `rules`, `install`) produces the `.deb` from the same OBS package, and OBS's per-repository configuration maps that single package onto every distribution target you enable.

A Flatpak manifest wraps the Tauri desktop bundle:

```yaml
app-id: org.lolly.Lolly
runtime: org.gnome.Platform
runtime-version: '46'
sdk: org.gnome.Sdk
command: lolly
modules:
  - name: lolly
    buildsystem: simple
    build-commands:
      - pnpm install --frozen-lockfile --offline && pnpm run build:desktop
      - install -Dm0755 src-tauri/target/release/lolly /app/bin/lolly
    sources:
      - type: archive
        path: lolly-1.0.0.tar.gz
```

For readers wiring this up for real, see the [OBS documentation](https://openbuildservice.org/help/) and the [openSUSE packaging guidelines](https://en.opensuse.org/openSUSE:Packaging_guidelines).

[Back to Build Guide](/info/build-guide.html).
