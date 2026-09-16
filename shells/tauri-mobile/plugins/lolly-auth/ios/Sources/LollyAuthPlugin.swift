// SPDX-License-Identifier: MPL-2.0

// The iOS half of lolly-auth: runs one ASWebAuthenticationSession and returns
// the callback URL. No Info.plist entry is needed; the session catches the
// redirect to the callback scheme itself.

import AuthenticationServices
import SwiftRs
import Tauri
import UIKit
import WebKit

struct AuthenticateArgs: Decodable {
  let url: String
  let callbackScheme: String
  var ephemeral: Bool?
}

/// The web caller matches the word "cancelled", so keep it in this sentence.
private let cancelledMessage = "Sign-in cancelled."

/// One sign-in attempt. `settle` answers the invoke once, however many times
/// the system or the start path reports an outcome.
private final class Attempt {
  let invoke: Invoke
  let scheme: String
  let anchor: ASPresentationAnchor
  var session: ASWebAuthenticationSession?
  private var settled = false

  init(invoke: Invoke, scheme: String, anchor: ASPresentationAnchor) {
    self.invoke = invoke
    self.scheme = scheme
    self.anchor = anchor
  }

  func settle(url: URL?, error: Error?) {
    if settled { return }
    settled = true
    session = nil
    if let url = url {
      if url.scheme?.lowercased() == scheme.lowercased() {
        invoke.resolve(["url": url.absoluteString])
      } else {
        invoke.reject("The sign-in returned to an unexpected address.")
      }
      return
    }
    if let authError = error as? ASWebAuthenticationSessionError,
      authError.code == .canceledLogin
    {
      invoke.reject(cancelledMessage, code: "cancelled")
    } else if let error = error {
      invoke.reject("Sign-in failed: \(error.localizedDescription)")
    } else {
      invoke.reject("Sign-in failed: the sheet closed without an address.")
    }
  }

  func fail(_ message: String) {
    if settled { return }
    settled = true
    session = nil
    invoke.reject(message)
  }
}

class LollyAuthPlugin: Plugin, ASWebAuthenticationPresentationContextProviding {
  /// The running attempt. Read and written on the main queue only.
  private var current: Attempt?

  @objc public func authenticate(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AuthenticateArgs.self)
    // The Rust command has already checked both values; check again here so
    // this class is safe on its own.
    guard LollyAuthPlugin.isPlainHttpsText(args.url),
      let url = URL(string: args.url), url.scheme?.lowercased() == "https",
      let host = url.host, !host.isEmpty
    else {
      invoke.reject("The sign-in address must be an https URL.")
      return
    }
    guard LollyAuthPlugin.isCallbackScheme(args.callbackScheme) else {
      invoke.reject(
        "The callback scheme must be a URI scheme with at least one dot, such as tools.lolly.mobile."
      )
      return
    }
    let ephemeral = args.ephemeral ?? false
    // Commands arrive on Tauri's IPC queue; the session must start on the main one.
    DispatchQueue.main.async { [weak self] in
      guard let self = self else {
        invoke.reject("Sign-in failed: the plugin is not loaded.")
        return
      }
      self.start(invoke: invoke, url: url, scheme: args.callbackScheme, ephemeral: ephemeral)
    }
  }

  private func start(invoke: Invoke, url: URL, scheme: String, ephemeral: Bool) {
    if current != nil {
      invoke.reject("Another sign-in is already open.")
      return
    }
    guard let anchor = presentationWindow() else {
      invoke.reject("Sign-in failed: there is no window to show the sign-in sheet on.")
      return
    }
    let attempt = Attempt(invoke: invoke, scheme: scheme, anchor: anchor)
    current = attempt

    // The completion handler holds the attempt, not the plugin, and hops to
    // the main queue before touching `current`.
    let completion: (URL?, Error?) -> Void = { [weak self] callbackURL, error in
      DispatchQueue.main.async {
        attempt.settle(url: callbackURL, error: error)
        if let self = self, self.current === attempt {
          self.current = nil
        }
      }
    }

    let session: ASWebAuthenticationSession
    if #available(iOS 17.4, *) {
      session = ASWebAuthenticationSession(
        url: url, callback: .customScheme(scheme), completionHandler: completion)
    } else {
      session = ASWebAuthenticationSession(
        url: url, callbackURLScheme: scheme, completionHandler: completion)
    }
    session.presentationContextProvider = self
    session.prefersEphemeralWebBrowserSession = ephemeral
    // Keep a strong reference until the completion handler runs, or the
    // session is released and the sheet closes at once.
    attempt.session = session

    if !session.start() {
      attempt.fail("Sign-in failed: the sign-in sheet could not open.")
      if current === attempt {
        current = nil
      }
    }
  }

  // ASWebAuthenticationPresentationContextProviding. The system calls this on
  // the main thread while `start()` runs.
  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    if let anchor = current?.anchor {
      return anchor
    }
    return presentationWindow() ?? ASPresentationAnchor()
  }

  /// The web view's window, else the key window of a foreground scene.
  private func presentationWindow() -> UIWindow? {
    if let window = manager.viewController?.view.window {
      return window
    }
    let scenes = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .filter { $0.activationState == .foregroundActive }
    for scene in scenes {
      if let key = scene.windows.first(where: { $0.isKeyWindow }) {
        return key
      }
    }
    return scenes.first?.windows.first
  }

  /// The same plain-form rule as the Rust command: a literal `https://`
  /// followed by the host, with no spaces, control characters or backslashes.
  static func isPlainHttpsText(_ text: String) -> Bool {
    let bytes = Array(text.utf8)
    let prefix = Array("https://".utf8)
    guard bytes.count > prefix.count, bytes.count <= 16 * 1024 else {
      return false
    }
    for (index, expected) in prefix.enumerated() {
      let byte = bytes[index]
      let lowered = (byte >= 0x41 && byte <= 0x5A) ? byte + 0x20 : byte
      if lowered != expected {
        return false
      }
    }
    if bytes[prefix.count] == UInt8(ascii: "/") {
      return false
    }
    return !bytes.contains { $0 < 0x20 || $0 == 0x7F || $0 == 0x20 || $0 == UInt8(ascii: "\\") }
  }

  /// RFC 3986 scheme, given without the colon, with at least one dot.
  static func isCallbackScheme(_ scheme: String) -> Bool {
    let bytes = Array(scheme.utf8)
    guard let first = bytes.first, bytes.count <= 128, isAsciiLetter(first) else {
      return false
    }
    var sawDot = false
    for byte in bytes {
      if byte == UInt8(ascii: ".") {
        sawDot = true
      } else if !(isAsciiLetter(byte) || isAsciiDigit(byte) || byte == UInt8(ascii: "+")
        || byte == UInt8(ascii: "-"))
      {
        return false
      }
    }
    return sawDot
  }

  private static func isAsciiLetter(_ byte: UInt8) -> Bool {
    return (byte >= 0x41 && byte <= 0x5A) || (byte >= 0x61 && byte <= 0x7A)
  }

  private static func isAsciiDigit(_ byte: UInt8) -> Bool {
    return byte >= 0x30 && byte <= 0x39
  }
}

@_cdecl("init_plugin_lolly_auth")
func initPlugin() -> Plugin {
  return LollyAuthPlugin()
}
