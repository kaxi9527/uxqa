import AppKit
import WebKit

final class Desktop: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    var process: Process?
    var input: Pipe?
    var output = Data()
    var windows: [NSWindow] = []
    var mainOrigin: String?
    var terminating = false
    var english = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        let home = ProcessInfo.processInfo.environment["UXQA_HOME"] ?? NSHomeDirectory() + "/.uxqa"
        if let data = try? Data(contentsOf: URL(fileURLWithPath: home).appendingPathComponent("access-settings.json")),
           let settings = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            english = settings["locale"] as? String == "en"
        }
        updateMenus()
        let resources = Bundle.main.resourceURL!
        let child = Process()
        child.executableURL = resources.appendingPathComponent("runtime/node")
        child.arguments = [resources.appendingPathComponent("app/desktop.mjs").path]
        var env = ProcessInfo.processInfo.environment
        env["UXQA_MODEL_CORE"] = resources.appendingPathComponent("model-core/uxqa-model-core").path
        env.removeValue(forKey: "UXQA_UI_TOKEN")
        child.environment = env
        child.currentDirectoryURL = resources
        let pipe = Pipe()
        input = Pipe()
        child.standardInput = input
        child.standardOutput = pipe
        child.standardError = FileHandle.nullDevice
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if data.isEmpty { handle.readabilityHandler = nil; return }
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.output.append(data)
                if let end = self.output.firstIndex(of: 10) {
                    let line = self.output.prefix(upTo: end)
                    self.output.removeAll()
                    if self.windows.isEmpty,
                       let result = try? JSONSerialization.jsonObject(with: line) as? [String: String],
                       let text = result["url"], let url = URL(string: text), url.host == "127.0.0.1" {
                        self.mainOrigin = "http://127.0.0.1:\(url.port!)"
                        _ = self.window(url: url, title: "UXQA")
                    }
                }
            }
        }
        child.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if self.terminating { NSApp.reply(toApplicationShouldTerminate: true) }
                else { self.error(self.english ? "The local service stopped. Reopen UXQA; your projects and check records remain on this computer." : "本地服务已退出。请重新打开 UXQA；已有项目和检测记录仍保存在本机。") }
            }
        }
        process = child
        do { try child.run() }
        catch { self.error(english ? "The bundled runtime could not start. Extract the complete UXQA.app again." : "无法启动内置运行时，请重新解压完整的 UXQA.app。") }
        DispatchQueue.main.asyncAfter(deadline: .now() + 25) { [weak self] in
            guard let self = self, self.windows.isEmpty, !self.terminating else { return }
            self.error(self.english ? "Startup timed out. Close UXQA and try again." : "应用启动超时，请关闭后重试。")
        }
    }

    func updateMenus() {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: english ? "Quit UXQA" : "退出 UXQA", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        menu.addItem(appItem)
        let editItem = NSMenuItem()
        let edit = NSMenu(title: english ? "Edit" : "编辑")
        for (title, action, key) in [(english ? "Undo" : "撤销", "undo:", "z"), (english ? "Cut" : "剪切", "cut:", "x"), (english ? "Copy" : "复制", "copy:", "c"), (english ? "Paste" : "粘贴", "paste:", "v"), (english ? "Select All" : "全选", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        editItem.submenu = edit
        menu.addItem(editItem)
        NSApp.mainMenu = menu
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "uxqaLanguage", message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host == "127.0.0.1",
              message.frameInfo.securityOrigin.port == URL(string: mainOrigin ?? "")?.port,
              let locale = message.body as? String, ["zh", "en"].contains(locale) else { return }
        english = locale == "en"
        updateMenus()
    }

    @discardableResult func window(url: URL, title: String, configuration: WKWebViewConfiguration = WKWebViewConfiguration()) -> WKWebView {
        configuration.userContentController.removeScriptMessageHandler(forName: "uxqaLanguage")
        configuration.userContentController.add(self, name: "uxqaLanguage")
        let web = WKWebView(frame: .zero, configuration: configuration)
        web.navigationDelegate = self
        web.uiDelegate = self
        let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 820), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        win.title = title
        win.minSize = NSSize(width: 620, height: 500)
        win.contentView = web
        win.isReleasedWhenClosed = false
        win.center()
        win.makeKeyAndOrderFront(nil)
        windows.append(win)
        web.load(URLRequest(url: url))
        NSApp.activate(ignoringOtherApps: true)
        return web
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "http", url.host == "127.0.0.1" { decisionHandler(.allow); return }
        if ["https", "http"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = action.request.url else { return nil }
        if url.scheme == "http", url.host == "127.0.0.1" { return window(url: url, title: english ? "UXQA · Model connections" : "UXQA · 模型连接中心", configuration: configuration) }
        if ["https", "http"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert(); alert.messageText = message; alert.runModal(); completionHandler()
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle: english ? "Confirm" : "确认"); alert.addButton(withTitle: english ? "Cancel" : "取消")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let child = process, child.isRunning else { return .terminateNow }
        if terminating { return .terminateLater }
        terminating = true
        child.terminate()
        input?.fileHandleForWriting.closeFile()
        return .terminateLater
    }
    func error(_ message: String) {
        let alert = NSAlert(); alert.messageText = "UXQA"; alert.informativeText = message; alert.runModal()
        NSApp.terminate(nil)
    }
}

let app = NSApplication.shared
let delegate = Desktop()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
