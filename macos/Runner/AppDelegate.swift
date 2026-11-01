import Cocoa
import FlutterMacOS
import WebKit

class WebDeckDefaultUIDelegate: NSObject, WKUIDelegate {
  static let shared = WebDeckDefaultUIDelegate()
}

class WebDeckFilePickerDelegate: NSObject, WKUIDelegate {
  @objc func webView(
    _ webView: WKWebView,
    runOpenPanelWith parameters: WKOpenPanelParameters,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping ([URL]?) -> Void
  ) {
    let openPanel = NSOpenPanel()
    openPanel.canChooseFiles = true
    if #available(macOS 10.13.4, *) {
      openPanel.canChooseDirectories = parameters.allowsDirectories
    } else {
      openPanel.canChooseDirectories = false
    }
    openPanel.allowsMultipleSelection = parameters.allowsMultipleSelection
    openPanel.title = "Select File"
    openPanel.prompt = "Choose"

    NSApplication.shared.activate(ignoringOtherApps: true)

    let window = webView.window ?? NSApplication.shared.keyWindow ?? NSApplication.shared.mainWindow
    if let window = window {
      openPanel.beginSheetModal(for: window) { response in
        if response == .OK {
          completionHandler(openPanel.urls)
        } else {
          completionHandler(nil)
        }
      }
    } else {
      openPanel.begin { response in
        if response == .OK {
          completionHandler(openPanel.urls)
        } else {
          completionHandler(nil)
        }
      }
    }
  }
}

extension WKWebView {
  private static var hasSwizzledUIDelegate = false

  static func enableFilePickerSupport() {
    guard !hasSwizzledUIDelegate else { return }
    hasSwizzledUIDelegate = true

    let originalSelector = #selector(setter: WKWebView.uiDelegate)
    let swizzledSelector = #selector(WKWebView.webdeck_setUIDelegate(_:))

    if let originalMethod = class_getInstanceMethod(WKWebView.self, originalSelector),
       let swizzledMethod = class_getInstanceMethod(WKWebView.self, swizzledSelector) {
      method_exchangeImplementations(originalMethod, swizzledMethod)
    }

    let origInit = #selector(WKWebView.init(frame:configuration:))
    let swizzInit = #selector(WKWebView.webdeck_initWithFrame(_:configuration:))
    if let origInitMethod = class_getInstanceMethod(WKWebView.self, origInit),
       let swizzInitMethod = class_getInstanceMethod(WKWebView.self, swizzInit) {
      method_exchangeImplementations(origInitMethod, swizzInitMethod)
    }
  }

  @objc func webdeck_initWithFrame(_ frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
    let webView = webdeck_initWithFrame(frame, configuration: configuration)
    if webView.uiDelegate == nil {
      webView.uiDelegate = WebDeckDefaultUIDelegate.shared
    }
    return webView
  }

  @objc func webdeck_setUIDelegate(_ delegate: WKUIDelegate?) {
    let effectiveDelegate = delegate ?? WebDeckDefaultUIDelegate.shared
    let openPanelSelector = #selector(WKUIDelegate.webView(_:runOpenPanelWith:initiatedByFrame:completionHandler:))
    if let delegateClass: AnyClass = object_getClass(effectiveDelegate) {
      if !effectiveDelegate.responds(to: openPanelSelector) {
        if let hookMethod = class_getInstanceMethod(WebDeckFilePickerDelegate.self, openPanelSelector) {
          class_addMethod(
            delegateClass,
            openPanelSelector,
            method_getImplementation(hookMethod),
            method_getTypeEncoding(hookMethod)
          )
        }
      }
    }
    webdeck_setUIDelegate(effectiveDelegate)
  }
}

@main
class AppDelegate: FlutterAppDelegate {
  override func applicationDidFinishLaunching(_ notification: Notification) {
    WKWebView.enableFilePickerSupport()
    super.applicationDidFinishLaunching(notification)
  }

  override func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    return true
  }

  override func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
    return true
  }
}
