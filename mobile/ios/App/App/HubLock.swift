import LocalAuthentication
import Security
import UIKit
import WebKit

// The biometric lock. With it on, the token is a keychain item the system only opens after a biometric
// check on the biometrics enrolled today: new ones make it unreadable, on purpose. Nothing here falls
// back to the device passcode, and nothing falls back to open: if JS never answers, the cover stays.
final class HubLock {
    static let shared = HubLock()

    private static let service = "localhub-lock"
    private static let account = "device-token"
    private static let markerKey = "hub-lock-on"

    var onLocked: ((Bool) -> Void)?
    weak var appWindow: UIWindow?
    private var coverWindow: UIWindow?
    private var needsLock: Bool
    private var active = false
    private var enabled: Bool {
        UserDefaults.standard.bool(forKey: Self.markerKey)
    }

    private init() {
        needsLock = UserDefaults.standard.bool(forKey: Self.markerKey)
    }

    // MARK: What the scene reports

    func sceneConnected(_ scene: UIWindowScene, window: UIWindow?) {
        appWindow = window
        if needsLock { showCover(on: scene) }
    }

    // The Face ID sheet itself makes the app inactive, so this only covers. Going to the background locks.
    func sceneWillResignActive(_ scene: UIWindowScene) {
        active = false
        if enabled { showCover(on: scene) }
    }

    func sceneDidEnterBackground(_ scene: UIWindowScene) {
        guard enabled else { return }
        needsLock = true
        showCover(on: scene)
        clearCookiesInBackground()
        onLocked?(false)
    }

    func sceneDidBecomeActive(_ scene: UIWindowScene) {
        active = true
        if needsLock {
            showCover(on: scene)
            onLocked?(true)
        } else {
            hideCover()
        }
    }

    private func clearCookiesInBackground() {
        var task = UIBackgroundTaskIdentifier.invalid
        let finish = {
            if task != .invalid { UIApplication.shared.endBackgroundTask(task) }
            task = .invalid
        }
        task = UIApplication.shared.beginBackgroundTask(expirationHandler: finish)
        WKWebsiteDataStore.default().removeData(ofTypes: [WKWebsiteDataTypeCookies], modifiedSince: .distantPast, completionHandler: finish)
    }

    // MARK: What JS asks

    func status() -> [String: Any] {
        let context = LAContext()
        var error: NSError?
        let can = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        var out: [String: Any] = ["enabled": enabled, "available": can]
        switch context.biometryType {
        case .faceID: out["kind"] = "face"
        case .touchID: out["kind"] = "touch"
        default: out["kind"] = ""
        }
        if !can {
            switch LAError.Code(rawValue: error?.code ?? 0) {
            case .biometryNotEnrolled: out["reason"] = "notEnrolled"
            case .passcodeNotSet: out["reason"] = "noPasscode"
            case .biometryNotAvailable: out["reason"] = context.biometryType == .none ? "noHardware" : "denied"
            default: out["reason"] = "unavailable"
            }
        }
        return out
    }

    // Stores the token, then reads it back with a prompt, so the plain copy only goes once the person has
    // shown they can open this one. The marker is set last.
    func enable(token: String, done: @escaping ([String: Any]) -> Void) {
        guard status()["available"] as? Bool == true,
              let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, nil),
              let data = token.data(using: .utf8) else {
            done(["unavailable": true])
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            SecItemDelete(self.itemQuery() as CFDictionary)
            var add = self.itemQuery()
            add[kSecValueData as String] = data
            add[kSecAttrAccessControl as String] = access
            guard SecItemAdd(add as CFDictionary, nil) == errSecSuccess else {
                DispatchQueue.main.async { done(["unavailable": true]) }
                return
            }
            let read = self.read(reason: "Turn on the lock for LocalHub")
            DispatchQueue.main.async {
                if read["token"] as? String == token {
                    UserDefaults.standard.set(true, forKey: Self.markerKey)
                    done(["enabled": true])
                } else {
                    SecItemDelete(self.itemQuery() as CFDictionary)
                    done(read["token"] != nil ? ["unavailable": true] : read)
                }
            }
        }
    }

    func unlock(done: @escaping ([String: Any]) -> Void) {
        guard enabled else {
            done(["changed": true])
            return
        }
        let context = LAContext()
        var error: NSError?
        if !context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) {
            done(failure(for: LAError.Code(rawValue: error?.code ?? 0)))
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let result = self.read(reason: "Unlock LocalHub")
            DispatchQueue.main.async { done(result) }
        }
    }

    func clear() {
        SecItemDelete(itemQuery() as CFDictionary)
        UserDefaults.standard.removeObject(forKey: Self.markerKey)
        needsLock = false
        hideCover()
    }

    // JS has drawn its lock screen, so the cover can go. Only while active, and only then.
    func shown() -> Bool {
        guard active else { return false }
        if needsLock {
            needsLock = false
            appWindow?.rootViewController?.presentedViewController?.dismiss(animated: false)
            hideCover()
        }
        return true
    }

    // MARK: Keychain

    private func itemQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: Self.account
        ]
    }

    // Blocks until the person answers, so never on the main thread.
    private func read(reason: String) -> [String: Any] {
        let context = LAContext()
        context.localizedReason = reason
        var query = itemQuery()
        query[kSecReturnData as String] = true
        query[kSecUseAuthenticationContext as String] = context
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        switch status {
        case errSecSuccess:
            guard let data = item as? Data, let token = String(data: data, encoding: .utf8) else { return ["changed": true] }
            return ["token": token]
        case errSecUserCanceled:
            return ["cancelled": true]
        case errSecItemNotFound:
            return ["changed": true]
        case errSecAuthFailed:
            var error: NSError?
            let after = LAContext()
            if !after.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error), LAError.Code(rawValue: error?.code ?? 0) == .biometryLockout {
                return ["lockedOut": true]
            }
            return ["failed": true]
        default:
            return ["unavailable": true]
        }
    }

    private func failure(for code: LAError.Code?) -> [String: Any] {
        switch code {
        case .biometryLockout: return ["lockedOut": true]
        case .biometryNotEnrolled, .passcodeNotSet: return ["changed": true]
        default: return ["unavailable": true]
        }
    }

    // MARK: What shows

    private func showCover(on scene: UIWindowScene) {
        guard coverWindow == nil else { return }
        let cover = UIWindow(windowScene: scene)
        cover.windowLevel = .alert + 1
        let screen = UIViewController()
        screen.view.backgroundColor = .systemBackground
        cover.rootViewController = screen
        cover.isHidden = false
        coverWindow = cover
    }

    private func hideCover() {
        coverWindow?.isHidden = true
        coverWindow = nil
    }
}
