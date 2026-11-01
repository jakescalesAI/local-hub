"""Applies this app's settings to the Android and iOS projects that `cap add` generated.

The projects are tracked, so this does not need running again. It is kept to show exactly what differs
from the Capacitor templates, and every step fails loudly if a template line has moved.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
GROUP = "group.com.example.localhub"


def edit(rel, *pairs):
    path = ROOT / rel
    text = path.read_text(encoding="utf8")
    for old, new in pairs:
        if new in text:
            continue
        if old not in text:
            sys.exit(f"{rel}: not found: {old[:70]}")
        text = text.replace(old, new, 1)
    path.write_text(text, encoding="utf8", newline="\n")


def write(rel, text):
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf8", newline="\n")


# --- Android

edit("android/variables.gradle", ("minSdkVersion = 24", "minSdkVersion = 26"))
edit(
    "android/app/build.gradle",
    (
        '    implementation project(\':capacitor-android\')\n',
        '    implementation project(\':capacitor-android\')\n    implementation "com.journeyapps:zxing-android-embedded:4.3.0"\n',
    ),
)
edit(
    "android/app/src/main/AndroidManifest.xml",
    (
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android"\n    xmlns:tools="http://schemas.android.com/tools">',
    ),
    (
        '        android:allowBackup="true"\n',
        '        android:allowBackup="false"\n'
        '        android:dataExtractionRules="@xml/data_extraction_rules"\n'
        '        android:fullBackupContent="false"\n'
        '        android:networkSecurityConfig="@xml/network_security_config"\n'
        '        android:usesCleartextTraffic="false"\n',
    ),
    (
        "            </intent-filter>\n\n        </activity>\n",
        "            </intent-filter>\n\n"
        "            <!-- Pairing links only fill in the confirm screen. -->\n"
        "            <intent-filter>\n"
        '                <action android:name="android.intent.action.VIEW" />\n'
        '                <category android:name="android.intent.category.DEFAULT" />\n'
        '                <category android:name="android.intent.category.BROWSABLE" />\n'
        '                <data android:scheme="localhub" android:host="pair" />\n'
        "            </intent-filter>\n\n"
        "            <!-- Shared text only fills in the composer. -->\n"
        "            <intent-filter>\n"
        '                <action android:name="android.intent.action.SEND" />\n'
        '                <category android:name="android.intent.category.DEFAULT" />\n'
        '                <data android:mimeType="text/*" />\n'
        "            </intent-filter>\n\n"
        "        </activity>\n\n"
        "        <!-- ZXing's scanner, allowed to turn with the phone. -->\n"
        "        <activity\n"
        '            android:name="com.journeyapps.barcodescanner.CaptureActivity"\n'
        '            android:screenOrientation="fullSensor"\n'
        '            tools:replace="android:screenOrientation" />\n',
    ),
    (
        '    <uses-permission android:name="android.permission.INTERNET" />\n',
        '    <uses-permission android:name="android.permission.INTERNET" />\n'
        '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n',
    ),
)
write(
    "android/app/src/main/res/xml/network_security_config.xml",
    '<?xml version="1.0" encoding="utf-8"?>\n'
    "<!-- HTTPS only. Debug builds add an allowance in src/debug. -->\n"
    "<network-security-config>\n"
    '    <base-config cleartextTrafficPermitted="false" />\n'
    "</network-security-config>\n",
)
write(
    "android/app/src/debug/res/xml/network_security_config.xml",
    '<?xml version="1.0" encoding="utf-8"?>\n'
    "<!-- Debug only: this machine and the emulator's address for the host, for the mock Hub. -->\n"
    "<network-security-config>\n"
    '    <base-config cleartextTrafficPermitted="false" />\n'
    '    <domain-config cleartextTrafficPermitted="true">\n'
    '        <domain includeSubdomains="false">localhost</domain>\n'
    '        <domain includeSubdomains="false">127.0.0.1</domain>\n'
    '        <domain includeSubdomains="false">10.0.2.2</domain>\n'
    "    </domain-config>\n"
    "</network-security-config>\n",
)
write(
    "android/app/src/main/res/xml/data_extraction_rules.xml",
    '<?xml version="1.0" encoding="utf-8"?>\n'
    "<!-- The key and any waiting messages stay on this device. -->\n"
    "<data-extraction-rules>\n"
    "    <cloud-backup>\n"
    '        <exclude domain="root" />\n'
    '        <exclude domain="file" />\n'
    '        <exclude domain="database" />\n'
    '        <exclude domain="sharedpref" />\n'
    '        <exclude domain="external" />\n'
    "    </cloud-backup>\n"
    "    <device-transfer>\n"
    '        <exclude domain="root" />\n'
    '        <exclude domain="file" />\n'
    '        <exclude domain="database" />\n'
    '        <exclude domain="sharedpref" />\n'
    '        <exclude domain="external" />\n'
    "    </device-transfer>\n"
    "</data-extraction-rules>\n",
)
edit(
    "android/app/src/main/res/values/ic_launcher_background.xml",
    ('<color name="ic_launcher_background">#FFFFFF</color>', '<color name="ic_launcher_background">#1A2130</color>'),
)

# --- iOS

edit(
    "ios/App/App/SceneDelegate.swift",
    ("window?.rootViewController = CAPBridgeViewController()", "window?.rootViewController = HubViewController()"),
)
edit(
    "ios/App/App/Base.lproj/Main.storyboard",
    (
        'customClass="CAPBridgeViewController" customModule="Capacitor"',
        'customClass="HubViewController" customModule="App" customModuleProvider="target"',
    ),
)
edit(
    "ios/App/App/Info.plist",
    (
        "\t<key>UIRequiredDeviceCapabilities</key>\n\t<array>\n\t\t<string>armv7</string>\n\t</array>\n",
        "\t<key>UIRequiredDeviceCapabilities</key>\n\t<array>\n\t\t<string>arm64</string>\n\t</array>\n",
    ),
    (
        "\t<key>LSRequiresIPhoneOS</key>\n",
        "\t<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n"
        "\t\t\t<key>CFBundleURLName</key>\n\t\t\t<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>\n"
        "\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>localhub</string>\n\t\t\t</array>\n"
        "\t\t</dict>\n\t</array>\n"
        "\t<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>\n"
        "\t<key>NSCameraUsageDescription</key>\n"
        "\t<string>The camera scans the pairing code shown on your computer. No images are saved or sent.</string>\n"
        "\t<key>LSRequiresIPhoneOS</key>\n",
    ),
)
ENTITLEMENTS = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
    '<plist version="1.0">\n<dict>\n'
    "\t<key>com.apple.security.application-groups</key>\n\t<array>\n"
    f"\t\t<string>{GROUP}</string>\n"
    "\t</array>\n</dict>\n</plist>\n"
)
write("ios/App/App/App.entitlements", ENTITLEMENTS)
write("ios/App/ShareExtension/ShareExtension.entitlements", ENTITLEMENTS)
write(
    "ios/App/App/PrivacyInfo.xcprivacy",
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
    '<plist version="1.0">\n<dict>\n'
    "\t<key>NSPrivacyTracking</key>\n\t<false/>\n"
    "\t<key>NSPrivacyTrackingDomains</key>\n\t<array/>\n"
    "\t<key>NSPrivacyCollectedDataTypes</key>\n\t<array/>\n"
    "\t<key>NSPrivacyAccessedAPITypes</key>\n\t<array>\n\t\t<dict>\n"
    "\t\t\t<key>NSPrivacyAccessedAPIType</key>\n\t\t\t<string>NSPrivacyAccessedAPICategoryUserDefaults</string>\n"
    "\t\t\t<key>NSPrivacyAccessedAPITypeReasons</key>\n\t\t\t<array>\n"
    "\t\t\t\t<string>CA92.1</string>\n\t\t\t\t<string>1C8F.1</string>\n"
    "\t\t\t</array>\n\t\t</dict>\n\t</array>\n"
    "</dict>\n</plist>\n",
)
write(
    "ios/App/ShareExtension/Info.plist",
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
    '<plist version="1.0">\n<dict>\n'
    "\t<key>CFBundleDevelopmentRegion</key>\n\t<string>en</string>\n"
    "\t<key>CFBundleDisplayName</key>\n\t<string>Local Hub</string>\n"
    "\t<key>CFBundleExecutable</key>\n\t<string>$(EXECUTABLE_NAME)</string>\n"
    "\t<key>CFBundleIdentifier</key>\n\t<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>\n"
    "\t<key>CFBundleInfoDictionaryVersion</key>\n\t<string>6.0</string>\n"
    "\t<key>CFBundleName</key>\n\t<string>$(PRODUCT_NAME)</string>\n"
    "\t<key>CFBundlePackageType</key>\n\t<string>XPC!</string>\n"
    "\t<key>CFBundleShortVersionString</key>\n\t<string>$(MARKETING_VERSION)</string>\n"
    "\t<key>CFBundleVersion</key>\n\t<string>$(CURRENT_PROJECT_VERSION)</string>\n"
    "\t<key>ITSAppUsesNonExemptEncryption</key>\n\t<false/>\n"
    "\t<key>NSExtension</key>\n\t<dict>\n"
    "\t\t<key>NSExtensionAttributes</key>\n\t\t<dict>\n"
    "\t\t\t<key>NSExtensionActivationRule</key>\n\t\t\t<dict>\n"
    "\t\t\t\t<key>NSExtensionActivationSupportsText</key>\n\t\t\t\t<true/>\n"
    "\t\t\t\t<key>NSExtensionActivationSupportsWebURLWithMaxCount</key>\n\t\t\t\t<integer>1</integer>\n"
    "\t\t\t</dict>\n\t\t</dict>\n"
    "\t\t<key>NSExtensionPointIdentifier</key>\n\t\t<string>com.apple.share-services</string>\n"
    "\t\t<key>NSExtensionPrincipalClass</key>\n\t\t<string>$(PRODUCT_MODULE_NAME).ShareViewController</string>\n"
    "\t</dict>\n</dict>\n</plist>\n",
)

# --- iOS project: the two new App files, the privacy manifest, and the share extension target

PBX = "ios/App/App.xcodeproj/project.pbxproj"


def ext_config(ident, name, debug):
    debug_only = '				SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG;\n' if debug else '				SWIFT_ACTIVE_COMPILATION_CONDITIONS = "";\n'
    return (
        f"		{ident} /* {name} */ = {{\n"
        "			isa = XCBuildConfiguration;\n"
        "			buildSettings = {\n"
        "				CODE_SIGN_ENTITLEMENTS = ShareExtension/ShareExtension.entitlements;\n"
        "				CODE_SIGN_STYLE = Automatic;\n"
        "				CURRENT_PROJECT_VERSION = 1;\n"
        "				INFOPLIST_FILE = ShareExtension/Info.plist;\n"
        "				IPHONEOS_DEPLOYMENT_TARGET = 15.0;\n"
        "				LD_RUNPATH_SEARCH_PATHS = (\n"
        '					"$(inherited)",\n'
        '					"@executable_path/Frameworks",\n'
        '					"@executable_path/../../Frameworks",\n'
        "				);\n"
        "				MARKETING_VERSION = 1.0;\n"
        "				PRODUCT_BUNDLE_IDENTIFIER = com.example.localhub.share;\n"
        '				PRODUCT_NAME = "$(TARGET_NAME)";\n'
        "				SKIP_INSTALL = YES;\n"
        f"{debug_only}"
        "				SWIFT_VERSION = 5.0;\n"
        '				TARGETED_DEVICE_FAMILY = "1,2";\n'
        "			};\n"
        f"			name = {name};\n"
        "		};\n"
    )


edit(
    PBX,
    (
        "/* End PBXBuildFile section */",
        "		A1000000000000000000000A /* HubNativePlugin.swift in Sources */ = {isa = PBXBuildFile; fileRef = A1000000000000000000000B /* HubNativePlugin.swift */; };\n"
        "		A1000000000000000000000C /* HubViewController.swift in Sources */ = {isa = PBXBuildFile; fileRef = A1000000000000000000000D /* HubViewController.swift */; };\n"
        "		A1000000000000000000000E /* PrivacyInfo.xcprivacy in Resources */ = {isa = PBXBuildFile; fileRef = A1000000000000000000000F /* PrivacyInfo.xcprivacy */; };\n"
        "		A10000000000000000000010 /* ShareViewController.swift in Sources */ = {isa = PBXBuildFile; fileRef = A10000000000000000000011 /* ShareViewController.swift */; };\n"
        "		A10000000000000000000012 /* ShareExtension.appex in Embed Foundation Extensions */ = {isa = PBXBuildFile; fileRef = A10000000000000000000013 /* ShareExtension.appex */; settings = {ATTRIBUTES = (RemoveHeadersOnCopy, ); }; };\n"
        "/* End PBXBuildFile section */\n\n"
        "/* Begin PBXContainerItemProxy section */\n"
        "		A10000000000000000000014 /* PBXContainerItemProxy */ = {\n"
        "			isa = PBXContainerItemProxy;\n"
        "			containerPortal = 504EC2FC1FED79650016851F /* Project object */;\n"
        "			proxyType = 1;\n"
        "			remoteGlobalIDString = A10000000000000000000015;\n"
        "			remoteInfo = ShareExtension;\n"
        "		};\n"
        "/* End PBXContainerItemProxy section */\n\n"
        "/* Begin PBXCopyFilesBuildPhase section */\n"
        "		A10000000000000000000016 /* Embed Foundation Extensions */ = {\n"
        "			isa = PBXCopyFilesBuildPhase;\n"
        "			buildActionMask = 2147483647;\n"
        '			dstPath = "";\n'
        "			dstSubfolderSpec = 13;\n"
        "			files = (\n"
        "				A10000000000000000000012 /* ShareExtension.appex in Embed Foundation Extensions */,\n"
        "			);\n"
        '			name = "Embed Foundation Extensions";\n'
        "			runOnlyForDeploymentPostprocessing = 0;\n"
        "		};\n"
        "/* End PBXCopyFilesBuildPhase section */",
    ),
    (
        "/* End PBXFileReference section */",
        "		A1000000000000000000000B /* HubNativePlugin.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = HubNativePlugin.swift; sourceTree = \"<group>\"; };\n"
        "		A1000000000000000000000D /* HubViewController.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = HubViewController.swift; sourceTree = \"<group>\"; };\n"
        "		A1000000000000000000000F /* PrivacyInfo.xcprivacy */ = {isa = PBXFileReference; lastKnownFileType = text.xml; path = PrivacyInfo.xcprivacy; sourceTree = \"<group>\"; };\n"
        "		A10000000000000000000017 /* App.entitlements */ = {isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = App.entitlements; sourceTree = \"<group>\"; };\n"
        "		A10000000000000000000011 /* ShareViewController.swift */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ShareViewController.swift; sourceTree = \"<group>\"; };\n"
        "		A10000000000000000000018 /* Info.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = \"<group>\"; };\n"
        "		A10000000000000000000019 /* ShareExtension.entitlements */ = {isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = ShareExtension.entitlements; sourceTree = \"<group>\"; };\n"
        "		A10000000000000000000013 /* ShareExtension.appex */ = {isa = PBXFileReference; explicitFileType = \"wrapper.app-extension\"; includeInIndex = 0; path = ShareExtension.appex; sourceTree = BUILT_PRODUCTS_DIR; };\n"
        "/* End PBXFileReference section */",
    ),
    (
        "/* End PBXFrameworksBuildPhase section */",
        "		A1000000000000000000001A /* Frameworks */ = {\n"
        "			isa = PBXFrameworksBuildPhase;\n"
        "			buildActionMask = 2147483647;\n"
        "			files = (\n"
        "			);\n"
        "			runOnlyForDeploymentPostprocessing = 0;\n"
        "		};\n"
        "/* End PBXFrameworksBuildPhase section */",
    ),
    (
        "				504EC3061FED79650016851F /* App */,\n				504EC3051FED79650016851F /* Products */,\n",
        "				504EC3061FED79650016851F /* App */,\n				A1000000000000000000001B /* ShareExtension */,\n				504EC3051FED79650016851F /* Products */,\n",
    ),
    (
        "				504EC3041FED79650016851F /* App.app */,\n			);",
        "				504EC3041FED79650016851F /* App.app */,\n				A10000000000000000000013 /* ShareExtension.appex */,\n			);",
    ),
    (
        "				9582B6822FE993A50072D4E8 /* SceneDelegate.swift */,\n",
        "				9582B6822FE993A50072D4E8 /* SceneDelegate.swift */,\n"
        "				A1000000000000000000000B /* HubNativePlugin.swift */,\n"
        "				A1000000000000000000000D /* HubViewController.swift */,\n"
        "				A1000000000000000000000F /* PrivacyInfo.xcprivacy */,\n"
        "				A10000000000000000000017 /* App.entitlements */,\n",
    ),
    (
        "/* End PBXGroup section */",
        "		A1000000000000000000001B /* ShareExtension */ = {\n"
        "			isa = PBXGroup;\n"
        "			children = (\n"
        "				A10000000000000000000011 /* ShareViewController.swift */,\n"
        "				A10000000000000000000018 /* Info.plist */,\n"
        "				A10000000000000000000019 /* ShareExtension.entitlements */,\n"
        "			);\n"
        "			path = ShareExtension;\n"
        '			sourceTree = "<group>";\n'
        "		};\n"
        "/* End PBXGroup section */",
    ),
    (
        "				504EC3021FED79650016851F /* Resources */,\n			);\n			buildRules = (\n			);\n			dependencies = (\n			);\n			name = App;",
        "				504EC3021FED79650016851F /* Resources */,\n				A10000000000000000000016 /* Embed Foundation Extensions */,\n			);\n			buildRules = (\n			);\n			dependencies = (\n				A1000000000000000000001C /* PBXTargetDependency */,\n			);\n			name = App;",
    ),
    (
        "/* End PBXNativeTarget section */",
        "		A10000000000000000000015 /* ShareExtension */ = {\n"
        "			isa = PBXNativeTarget;\n"
        '			buildConfigurationList = A1000000000000000000001D /* Build configuration list for PBXNativeTarget "ShareExtension" */;\n'
        "			buildPhases = (\n"
        "				A1000000000000000000001E /* Sources */,\n"
        "				A1000000000000000000001A /* Frameworks */,\n"
        "				A1000000000000000000001F /* Resources */,\n"
        "			);\n"
        "			buildRules = (\n"
        "			);\n"
        "			dependencies = (\n"
        "			);\n"
        "			name = ShareExtension;\n"
        "			productName = ShareExtension;\n"
        "			productReference = A10000000000000000000013 /* ShareExtension.appex */;\n"
        '			productType = "com.apple.product-type.app-extension";\n'
        "		};\n"
        "/* End PBXNativeTarget section */",
    ),
    (
        "				504EC3031FED79650016851F /* App */,\n			);\n		};\n/* End PBXProject section */",
        "				504EC3031FED79650016851F /* App */,\n				A10000000000000000000015 /* ShareExtension */,\n			);\n		};\n/* End PBXProject section */",
    ),
    (
        "				2FAD9763203C412B000D30F8 /* config.xml in Resources */,\n",
        "				2FAD9763203C412B000D30F8 /* config.xml in Resources */,\n				A1000000000000000000000E /* PrivacyInfo.xcprivacy in Resources */,\n",
    ),
    (
        "/* End PBXResourcesBuildPhase section */",
        "		A1000000000000000000001F /* Resources */ = {\n"
        "			isa = PBXResourcesBuildPhase;\n"
        "			buildActionMask = 2147483647;\n"
        "			files = (\n"
        "			);\n"
        "			runOnlyForDeploymentPostprocessing = 0;\n"
        "		};\n"
        "/* End PBXResourcesBuildPhase section */",
    ),
    (
        "				9582B6832FE993A70072D4E8 /* SceneDelegate.swift in Sources */,\n",
        "				9582B6832FE993A70072D4E8 /* SceneDelegate.swift in Sources */,\n"
        "				A1000000000000000000000A /* HubNativePlugin.swift in Sources */,\n"
        "				A1000000000000000000000C /* HubViewController.swift in Sources */,\n",
    ),
    (
        "/* End PBXSourcesBuildPhase section */",
        "		A1000000000000000000001E /* Sources */ = {\n"
        "			isa = PBXSourcesBuildPhase;\n"
        "			buildActionMask = 2147483647;\n"
        "			files = (\n"
        "				A10000000000000000000010 /* ShareViewController.swift in Sources */,\n"
        "			);\n"
        "			runOnlyForDeploymentPostprocessing = 0;\n"
        "		};\n"
        "/* End PBXSourcesBuildPhase section */\n\n"
        "/* Begin PBXTargetDependency section */\n"
        "		A1000000000000000000001C /* PBXTargetDependency */ = {\n"
        "			isa = PBXTargetDependency;\n"
        "			target = A10000000000000000000015 /* ShareExtension */;\n"
        "			targetProxy = A10000000000000000000014 /* PBXContainerItemProxy */;\n"
        "		};\n"
        "/* End PBXTargetDependency section */",
    ),
    (
        "/* End XCBuildConfiguration section */",
        ext_config("A10000000000000000000020", "Debug", True)
        + ext_config("A10000000000000000000021", "Release", False)
        + "/* End XCBuildConfiguration section */",
    ),
    (
        "/* End XCConfigurationList section */",
        '		A1000000000000000000001D /* Build configuration list for PBXNativeTarget "ShareExtension" */ = {\n'
        "			isa = XCConfigurationList;\n"
        "			buildConfigurations = (\n"
        "				A10000000000000000000020 /* Debug */,\n"
        "				A10000000000000000000021 /* Release */,\n"
        "			);\n"
        "			defaultConfigurationIsVisible = 0;\n"
        "			defaultConfigurationName = Release;\n"
        "		};\n"
        "/* End XCConfigurationList section */",
    ),
)
# The App target signs with the app group, in both configurations.
path = ROOT / PBX
text = path.read_text(encoding="utf8")
if "CODE_SIGN_ENTITLEMENTS = App/App.entitlements" not in text:
    text, n = re.subn(
        r"(ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;\n)",
        r"\1				CODE_SIGN_ENTITLEMENTS = App/App.entitlements;\n",
        text,
    )
    if n != 2:
        sys.exit(f"expected two App configurations, found {n}")
    path.write_text(text, encoding="utf8", newline="\n")
print("native projects set up")
