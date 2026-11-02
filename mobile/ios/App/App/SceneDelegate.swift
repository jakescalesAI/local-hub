import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = HubViewController()
        window?.makeKeyAndVisible()
        HubLock.shared.sceneConnected(windowScene, window: window)

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func sceneWillResignActive(_ scene: UIScene) {
        if let windowScene = scene as? UIWindowScene { HubLock.shared.sceneWillResignActive(windowScene) }
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        if let windowScene = scene as? UIWindowScene { HubLock.shared.sceneDidEnterBackground(windowScene) }
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        if let windowScene = scene as? UIWindowScene { HubLock.shared.sceneDidBecomeActive(windowScene) }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
