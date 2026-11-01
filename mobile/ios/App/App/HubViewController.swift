import Capacitor

class HubViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(HubNativePlugin())
    }
}
