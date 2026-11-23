package local.hub.tv;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;

/**
 * window.LocalHubNative — everything the web UI can ask of the TV. Every method is called on a
 * WebView binder thread; anything slow runs on MainActivity's I/O pool and answers through
 * haven.onNative({...}).
 */
final class Native {

    private final MainActivity activity;
    private final Context context;

    Native(MainActivity activity) {
        this.activity = activity;
        this.context = activity.getApplicationContext();
    }

    // ── apps, inputs, launching ───────────────────────────────────────────────────────────────

    @JavascriptInterface
    public String apps() {
        if (!activity.pageTrusted) return "[]";
        return activity.apps.toJson(activity.prefs);
    }

    @JavascriptInterface
    public String inputs() {
        if (!activity.pageTrusted) return "[]";
        return Inputs.toJson(Inputs.load(context));
    }

    @JavascriptInterface
    public boolean launch(String packageName) {
        if (!activity.pageTrusted) return false;
        if (packageName == null) return false;
        activity.prefs.recordLaunch(packageName, System.currentTimeMillis());
        return activity.apps.launch(packageName);
    }

    @JavascriptInterface
    public boolean switchInput(String id) {
        if (!activity.pageTrusted) return false;
        Inputs.Input input = Inputs.find(context, id);
        return input != null && Inputs.launch(context, input);
    }

    @JavascriptInterface
    public void openSystemSettings() {
        if (!activity.pageTrusted) return;
        open(Settings.ACTION_SETTINGS);
    }

    @JavascriptInterface
    public void openBluetoothSettings() {
        if (!activity.pageTrusted) return;
        if (!open(Settings.ACTION_BLUETOOTH_SETTINGS)) open(Settings.ACTION_SETTINGS);
    }

    @JavascriptInterface
    public void openNetworkSettings() {
        if (!activity.pageTrusted) return;
        if (!open(Settings.ACTION_WIFI_SETTINGS)) open(Settings.ACTION_SETTINGS);
    }

    private boolean open(String action) {
        try {
            Intent i = new Intent(action);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @JavascriptInterface
    public boolean sleep() {
        if (!activity.pageTrusted) return false;
        return HomeRedirectService.sleep();
    }

    @JavascriptInterface
    public String network() {
        if (!activity.pageTrusted) return "{}";
        JSONObject o = new JSONObject();
        try {
            ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            NetworkInfo n = cm != null ? cm.getActiveNetworkInfo() : null;
            o.put("connected", n != null && n.isConnected());
            o.put("kind", n == null ? "Network" : n.getType() == ConnectivityManager.TYPE_ETHERNET ? "Ethernet" : "Wi-Fi");
        } catch (Exception ignored) { }
        return o.toString();
    }

    @JavascriptInterface
    public String status() {
        if (!activity.pageTrusted) return "{}";
        JSONObject o = new JSONObject();
        try {
            PackageInfo pi = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            o.put("version", pi.versionName);
            o.put("homeService", HomeRedirectService.isRunning());
            o.put("hub", activity.prefs.hubUrl());
            o.put("hubName", activity.prefs.hubName());
            o.put("paired", activity.hub.paired());
            // How strong this TV is, so the page can pick its glass: blurs and masks are what a weak GPU struggles with.
            ActivityManager am = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            o.put("ramMB", mi.totalMem / (1024 * 1024));
            o.put("lowRam", am.isLowRamDevice());
            o.put("cores", Runtime.getRuntime().availableProcessors());
            o.put("sdk", android.os.Build.VERSION.SDK_INT);
            o.put("model", android.os.Build.MODEL);
        } catch (Exception ignored) { }
        return o.toString();
    }

    // ── voice ─────────────────────────────────────────────────────────────────────────────────

    @JavascriptInterface
    public boolean startListening() {
        if (!activity.pageTrusted) return false;
        activity.runOnUiThread(activity::startListening);
        return true;
    }

    @JavascriptInterface
    public void stopListening() {
        if (!activity.pageTrusted) return;
        activity.voice.stop();
    }

    @JavascriptInterface
    public void cancelListening() {
        if (!activity.pageTrusted) return;
        activity.voice.cancel();
    }

    @JavascriptInterface
    public void speak(String text) {
        if (!activity.pageTrusted) return;
        activity.voice.speak(text);
    }

    @JavascriptInterface
    public void stopSpeaking() {
        if (!activity.pageTrusted) return;
        activity.voice.stopSpeaking();
    }

    @JavascriptInterface
    public void setTyping(boolean typing) {
        if (!activity.pageTrusted) return;
        activity.typing = typing;
    }

    // ── LocalHub on the laptop ────────────────────────────────────────────────────────────────

    @JavascriptInterface
    public void setHub(String url) {
        if (!activity.pageTrusted) return;
        String clean = url == null ? "" : url.trim().replaceAll("/+$", "");
        if (!clean.isEmpty() && !clean.matches("^https?://.*")) clean = "http://" + clean;
        if (!clean.isEmpty() && !clean.matches("^https?://[^/]+:\\d+$") && !clean.matches("^https?://[^/:]+$")) clean = "";
        if (!clean.isEmpty() && clean.matches("^https?://[^/:]+$")) clean = clean + ":" + Hub.PORT;
        if (!clean.equals(activity.prefs.hubUrl())) activity.prefs.forgetPairing();
        activity.prefs.setHub(clean);
    }

    @JavascriptInterface
    public void findHub() {
        if (!activity.pageTrusted) return;
        activity.io.execute(() -> {
            String current = activity.prefs.hubUrl();
            String url = !current.isEmpty() && Hub.looksLikeHub(current, 1200) ? current : Hub.scan();
            if (url != null && !url.equals(current)) {
                activity.prefs.forgetPairing();
                activity.prefs.setHub(url);
            }
            activity.emit(event("hub").put("url", url == null ? "" : url).put("paired", activity.hub.paired())
                    .put("name", activity.prefs.hubName()));
        });
    }

    @JavascriptInterface
    public void pair(String code) {
        if (!activity.pageTrusted) return;
        activity.io.execute(() -> {
            try {
                String name = activity.hub.pair(code == null ? "" : code.trim());
                activity.emit(event("paired").put("ok", true).put("name", name));
            } catch (Exception e) {
                activity.emit(event("paired").put("ok", false).put("error", e.getMessage()));
            }
        });
    }

    /** Shows LocalHub's own TV page (after pairing, or to retry when the hub was away). */
    @JavascriptInterface
    public void openHub() {
        if (!activity.pageTrusted) return;
        activity.runOnUiThread(activity::loadHub);
    }

    @JavascriptInterface
    public void forgetHub() {
        if (!activity.pageTrusted) return;
        activity.prefs.forgetPairing();
    }

    /** Streams a hub request back as {type:"hubLine",id,line} … {type:"hubEnd",id,status}. */
    @JavascriptInterface
    public void hubRequest(String id, String method, String path, String body) {
        if (!activity.pageTrusted) return;
        if (!Hub.allowed(method, path)) {
            activity.emit(event("hubEnd").put("id", id).put("status", 403).put("error", "not allowed"));
            return;
        }
        final boolean poll = path.startsWith("/api/tv/next");
        activity.io.execute(() -> {
            try {
                byte[] bytes = body == null ? null : body.getBytes(StandardCharsets.UTF_8);
                int status = activity.hub.request(method, path, "application/json", bytes, poll ? 40_000 : 400_000,
                        line -> activity.emit(event("hubLine").put("id", id).put("line", line)));
                activity.emit(event("hubEnd").put("id", id).put("status", status));
            } catch (Exception e) {
                activity.emit(event("hubEnd").put("id", id).put("status", 0).put("error", String.valueOf(e.getMessage())));
            }
        });
    }

    /** Sends the last recording to LocalHub's Whisper. Answers like hubRequest. */
    @JavascriptInterface
    public void transcribe(String id) {
        if (!activity.pageTrusted) return;
        final byte[] wav = activity.lastAudio;
        if (wav == null) {
            activity.emit(event("hubEnd").put("id", id).put("status", 0).put("error", "nothing recorded"));
            return;
        }
        activity.io.execute(() -> {
            try {
                int status = activity.hub.request("POST", "/api/tv/transcribe", "audio/wav", wav, 60_000,
                        line -> activity.emit(event("hubLine").put("id", id).put("line", line)));
                activity.emit(event("hubEnd").put("id", id).put("status", status));
            } catch (Exception e) {
                activity.emit(event("hubEnd").put("id", id).put("status", 0).put("error", String.valueOf(e.getMessage())));
            }
        });
    }

    static Event event(String type) {
        return new Event(type);
    }

    /** A JSONObject whose put() can't throw, for tidy one-liners. */
    static final class Event extends JSONObject {
        Event(String type) {
            put("type", type);
        }

        @Override
        public Event put(String name, Object value) {
            try {
                super.put(name, value);
            } catch (Exception ignored) {
                // Only null names throw; we never pass one.
            }
            return this;
        }

        @Override
        public Event put(String name, boolean value) {
            return put(name, (Object) value);
        }

        @Override
        public Event put(String name, int value) {
            return put(name, (Object) value);
        }

        @Override
        public Event put(String name, long value) {
            return put(name, (Object) value);
        }

        @Override
        public Event put(String name, double value) {
            return put(name, (Object) value);
        }
    }
}
