plugins {
    id("com.android.application")
}

// The app normally shows LocalHub's own /tv/ page, straight from the hub. This bundled copy of the
// same files (../ui, plus the hub's icon and wallpapers) is what it shows when the hub can't be
// reached: pairing, and the apps. Copied on every build, so it never drifts from the hub's.
val uiDir = rootProject.file("../ui")
val hubDir = rootProject.file("../..")
val generatedAssets = layout.buildDirectory.dir("generated/localhub-ui")

val copyUi by tasks.registering(Sync::class) {
    from(uiDir) {
        include("index.html", "app.js", "stream.js", "stream.css", "styles.css", "theme.css", "panel.js", "panel.css", "files.js", "files.css", "mirror.js", "splash.js", "brands/**", "photos/**", "assistant.js", "assistant.css", "agentview.js")
    }
    from(hubDir.resolve("icons")) {
        include("hub.svg")
    }
    from(hubDir.resolve("wallpapers")) {
        include("*.svg")
        into("wallpapers")
    }
    into(generatedAssets.map { it.dir("ui") })
}

android {
    namespace = "local.hub.tv"
    compileSdk = 34

    defaultConfig {
        applicationId = "local.hub.tv"
        minSdk = 22
        targetSdk = 28 // deliberately 28: keeps the pre-Android-10 background-start rules the Home button needs
        versionCode = 111
        versionName = "1.0.11"
    }

    sourceSets {
        getByName("main") {
            assets.srcDir(generatedAssets)
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }

    buildFeatures {
        buildConfig = true
        resValues = true
    }
}

tasks.named("preBuild") {
    dependsOn(copyUi)
}
