// swift-tools-version:5.5
// SPDX-License-Identifier: MPL-2.0
// 5.5 is the first tools version that knows .iOS(.v15).

import PackageDescription

// The product name must equal the Cargo package name: tauri-plugin's build
// step links the static library by that name.
let package = Package(
  name: "tauri-plugin-lolly-auth",
  platforms: [
    .macOS(.v10_13),
    .iOS(.v15),
  ],
  products: [
    .library(
      name: "tauri-plugin-lolly-auth",
      type: .static,
      targets: ["tauri-plugin-lolly-auth"])
  ],
  dependencies: [
    // Copied here by the Rust build script from the tauri crate.
    .package(name: "Tauri", path: "../.tauri/tauri-api")
  ],
  targets: [
    .target(
      name: "tauri-plugin-lolly-auth",
      dependencies: [
        .byName(name: "Tauri")
      ],
      path: "Sources")
  ]
)
