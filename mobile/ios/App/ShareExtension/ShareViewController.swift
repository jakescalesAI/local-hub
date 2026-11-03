import Social
import UIKit
import UniformTypeIdentifiers

// Leaves shared text for the main app to pick up. The extension holds no token and makes no network
// calls: the app shows the text in its composer, and the person decides whether to send it.
class ShareViewController: SLComposeServiceViewController {
    // Must match HubNativePlugin and both entitlements files.
    private static let appGroup = "group.com.forgeitsolutions.localhub"
    private static let pendingKey = "pending-shares"
    private static let maxChars = 8000
    private static let maxPending = 20

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "LocalHub"
        placeholder = "Add a note"
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        navigationController?.navigationBar.topItem?.rightBarButtonItem?.title = "Save"
    }

    override func isContentValid() -> Bool {
        return true
    }

    override func didSelectPost() {
        let note = (contentText ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        sharedURL { url in
            var parts = note.isEmpty ? [] : [note]
            if let link = url?.absoluteString, !note.contains(link) { parts.append(link) }
            let text = String(parts.joined(separator: "\n\n").prefix(Self.maxChars))
            if !text.isEmpty { self.save(text) }
            self.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        }
    }

    override func configurationItems() -> [Any]! {
        return []
    }

    private func save(_ text: String) {
        guard let shared = UserDefaults(suiteName: Self.appGroup) else { return }
        var pending = shared.stringArray(forKey: Self.pendingKey) ?? []
        guard pending.count < Self.maxPending else { return }
        pending.append(text)
        shared.set(pending, forKey: Self.pendingKey)
    }

    private func sharedURL(_ done: @escaping (URL?) -> Void) {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
        guard let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }) else {
            done(nil)
            return
        }
        provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, _ in
            DispatchQueue.main.async { done(item as? URL) }
        }
    }
}
