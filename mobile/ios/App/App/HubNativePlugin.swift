import AVFoundation
import Capacitor
import UIKit
import WebKit

// QR scanning with AVFoundation, which runs on the device, and text left by the share extension.
// Shared text only fills in a composer: nothing is sent until the person says so.
@objc(HubNativePlugin)
public class HubNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HubNativePlugin"
    public let jsName = "HubNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "scanQr", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeShare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearCookies", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lockStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lockEnable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lockUnlock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lockClear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lockShown", returnType: CAPPluginReturnPromise)
    ]

    // Must match ShareViewController and both entitlements files.
    private static let appGroup = "group.com.example.localhub"
    private static let pendingKey = "pending-shares"

    override public func load() {
        HubLock.shared.onLocked = { [weak self] foreground in
            self?.notifyListeners("locked", data: ["foreground": foreground], retainUntilConsumed: true)
        }
    }

    @objc func lockStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(HubLock.shared.status()) }
    }

    @objc func lockEnable(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), !token.isEmpty else {
            call.reject("no token")
            return
        }
        DispatchQueue.main.async { HubLock.shared.enable(token: token) { call.resolve($0) } }
    }

    @objc func lockUnlock(_ call: CAPPluginCall) {
        DispatchQueue.main.async { HubLock.shared.unlock { call.resolve($0) } }
    }

    @objc func lockClear(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            HubLock.shared.clear()
            call.resolve()
        }
    }

    @objc func lockShown(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(["active": HubLock.shared.shown()]) }
    }

    @objc func takeShare(_ call: CAPPluginCall) {
        guard let shared = UserDefaults(suiteName: Self.appGroup),
              var pending = shared.stringArray(forKey: Self.pendingKey),
              !pending.isEmpty else {
            call.resolve([:])
            return
        }
        let text = pending.removeFirst()
        shared.set(pending, forKey: Self.pendingKey)
        call.resolve(["text": text])
    }

    // The Hub page's sign-in. The in-app browser keeps its cookies in the default data store.
    @objc func clearCookies(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            WKWebsiteDataStore.default().removeData(ofTypes: [WKWebsiteDataTypeCookies], modifiedSince: .distantPast) {
                call.resolve()
            }
        }
    }

    @objc func scanQr(_ call: CAPPluginCall) {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            presentScanner(call)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                if granted {
                    self.presentScanner(call)
                } else {
                    call.resolve(["error": Self.cameraOff])
                }
            }
        default:
            call.resolve(["error": Self.cameraOff])
        }
    }

    private static let cameraOff = "Camera access is off. Turn it on in Settings, or enter the address and code by hand."

    private func presentScanner(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard AVCaptureDevice.default(for: .video) != nil else {
                call.resolve(["error": "This device has no camera. Enter the address and code by hand."])
                return
            }
            let scanner = QrScannerViewController { text in
                if let text = text {
                    call.resolve(["text": text])
                } else {
                    call.resolve(["cancelled": true])
                }
            }
            scanner.modalPresentationStyle = .fullScreen
            self.bridge?.viewController?.present(scanner, animated: true)
        }
    }
}

final class QrScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let session = AVCaptureSession()
    private let done: (String?) -> Void
    private var finished = false
    private var cameraFailed = false

    init(done: @escaping (String?) -> Void) {
        self.done = done
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("not used")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        guard let camera = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: camera),
              session.canAddInput(input) else {
            cameraFailed = true
            return
        }
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else {
            cameraFailed = true
            return
        }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        preview.frame = view.bounds
        view.layer.addSublayer(preview)

        let prompt = UILabel()
        prompt.text = "Point at the code on your computer"
        prompt.textColor = .white
        prompt.font = .preferredFont(forTextStyle: .headline)
        prompt.adjustsFontForContentSizeCategory = true
        prompt.textAlignment = .center
        prompt.numberOfLines = 0
        prompt.translatesAutoresizingMaskIntoConstraints = false

        let cancel = UIButton(type: .system)
        cancel.setTitle("Cancel", for: .normal)
        cancel.setTitleColor(.white, for: .normal)
        cancel.titleLabel?.font = .preferredFont(forTextStyle: .body)
        cancel.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        cancel.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(prompt)
        view.addSubview(cancel)
        NSLayoutConstraint.activate([
            prompt.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 24),
            prompt.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            prompt.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            cancel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16),
            cancel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            cancel.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)
        ])

        DispatchQueue.global(qos: .userInitiated).async { [session] in
            session.startRunning()
        }
    }

    // Dismissing before the view has appeared would be ignored and leave the call waiting.
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if cameraFailed { finish(nil) }
    }

    // The lock can dismiss this. The call still needs its answer.
    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        finish(nil)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        view.layer.sublayers?.compactMap { $0 as? AVCaptureVideoPreviewLayer }.forEach { layer in
            layer.frame = view.bounds
            turn(layer)
        }
    }

    // On an iPad the app turns with the device, so the camera picture has to as well.
    private func turn(_ layer: AVCaptureVideoPreviewLayer) {
        guard let connection = layer.connection, connection.isVideoOrientationSupported else { return }
        switch view.window?.windowScene?.interfaceOrientation {
        case .portraitUpsideDown: connection.videoOrientation = .portraitUpsideDown
        case .landscapeLeft: connection.videoOrientation = .landscapeLeft
        case .landscapeRight: connection.videoOrientation = .landscapeRight
        default: connection.videoOrientation = .portrait
        }
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let code = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              let text = code.stringValue else { return }
        finish(text)
    }

    @objc private func cancelTapped() {
        finish(nil)
    }

    private func finish(_ text: String?) {
        guard !finished else { return }
        finished = true
        session.stopRunning()
        if presentingViewController != nil {
            dismiss(animated: true) { self.done(text) }
        } else {
            done(text)
        }
    }
}
