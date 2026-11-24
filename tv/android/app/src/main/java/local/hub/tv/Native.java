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
        // Started on another thread, so the page's grow animation doesn't wait on Android (an 80-100 ms frame on
        // the stick); a launch that fails says so with a "launchFailed" event.
        activity.io.execute(() -> {
            if (!activity.apps.launch(packageName)) activity.emit(event("launchFailed").put("pkg", packageName));
        });
        return true;
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

    /** Fire TV's picture settings: brightness and the rest belong to the TV, not to an app. */
    @JavascriptInterface
    public void openDisplaySettings() {
        if (!activity.pageTrusted) return;
        open(Settings.ACTION_DISPLAY_SETTINGS);
    }

    /** Fire TV's own page for pairing a remote or controller. */
    @JavascriptInterface
    public void openControllers() {
        if (!activity.pageTrusted) return;
        for (String a : new String[]{"com.amazon.device.settings.action.CONTROLLERS", Settings.ACTION_BLUETOOTH_SETTINGS}) {
            if (new Intent(a).resolveActivity(context.getPackageManager()) == null) continue;
            open(a);
            return;
        }
        open(Settings.ACTION_SETTINGS);
    }

    /** The remotes and controllers connected now: [{ name, pad, remote }]. */
    @JavascriptInterface
    public String controllers() {
        org.json.JSONArray l = new org.json.JSONArray();
        if (!activity.pageTrusted) return "[]";
        for (int id : android.view.InputDevice.getDeviceIds()) {
            android.view.InputDevice d = android.view.InputDevice.getDevice(id);
            if (d == null || d.isVirtual() || d.getVendorId() <= 2) continue;
            boolean pad = (d.getSources() & android.view.InputDevice.SOURCE_GAMEPAD) == android.view.InputDevice.SOURCE_GAMEPAD;
            try { l.put(new JSONObject().put("name", d.getName()).put("pad", pad).put("remote", !pad && d.getName().contains("Remote"))); } catch (Exception ignored) { }
        }
        return l.toString();
    }

    /** The TV's media volume: dir -1 quieter, 1 louder, 0 just tell. -> { level, max, muted, fixed } */
    @JavascriptInterface
    public String volume(int dir) {
        JSONObject o = new JSONObject();
        try {
            android.media.AudioManager am = (android.media.AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            int s = android.media.AudioManager.STREAM_MUSIC;
            if (dir != 0 && activity.pageTrusted && !am.isVolumeFixed()) {
                am.adjustStreamVolume(s, dir > 0 ? android.media.AudioManager.ADJUST_RAISE : android.media.AudioManager.ADJUST_LOWER, android.media.AudioManager.FLAG_SHOW_UI);
            }
            o.put("level", am.getStreamVolume(s)).put("max", am.getStreamMaxVolume(s)).put("fixed", am.isVolumeFixed());
        } catch (Exception ignored) { }
        return o.toString();
    }

    /** An app's picture ("<package>/banner" or "/icon"), as base64 PNG, for the mirror on the computer. "" when there's none. */
    @JavascriptInterface
    public String artData(String key) {
        if (!activity.pageTrusted || key == null || !key.matches("[\\w.]{1,160}/(banner|icon)")) return "";
        byte[] png = activity.apps.art(key);
        return png == null || png.length > 600 * 1024 ? "" : android.util.Base64.encodeToString(png, android.util.Base64.NO_WRAP);
    }

    /** Brightness as a shade over every app: 0 none, 80 darkest. False when it can't be drawn over other apps. */
    @JavascriptInterface
    public boolean dim(int percent) {
        return activity.pageTrusted && Dimmer.set(context, percent);
    }

    /** What's playing: "state" tells, "toggle", "next" and "prev" send the remote's own media keys. */
    @JavascriptInterface
    public String media(String action) {
        if (!activity.pageTrusted) return "{}";
        return Media.run(context, action);
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

    /** The page is resting on its home screen: keep a picture of it for Home's cover. */
    @JavascriptInterface
    public void snapshotHome() {
        if (activity.pageTrusted) activity.snapshotHome();
    }

    /** "Hey LocalHub" heard while another app is on: LocalHub comes to the front to answer. */
    @JavascriptInterface
    public void toFront() {
        android.util.Log.i("LocalHub", "toFront, resumed=" + activity.resumed);
        if (activity.resumed) return;
        // Through the Home watcher when it runs: Fire OS lets it bring LocalHub back over another app.
        if (HomeWatchService.toFront()) return;
        Intent i = new Intent(activity, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        activity.ui.post(() -> { try { activity.startActivity(i); } catch (Exception e) { android.util.Log.w("LocalHub", "toFront", e); } });
    }

    /** A return to LocalHub, not a fresh start: the page skips its logo and just fades in. */
    @JavascriptInterface
    public boolean quickStart() {
        return activity.quickStart || activity.playsIntro(); // the app itself is playing the opening
    }

    /** The wallpaper, so Home's cover can show it while Android brings LocalHub back. path: e.g. /tv/photos/aurora.jpg */
    @JavascriptInterface
    public void setCover(String path) {
        if (!activity.pageTrusted || path == null || !path.startsWith("/") || path.contains("..") || path.contains("//")) return;
        if (path.equals(activity.prefs.coverPath()) && HomeWatchService.coverFile(context).length() > 0) return;
        activity.io.execute(() -> {
            try {
                java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(activity.prefs.hubUrl() + path).openConnection();
                c.setConnectTimeout(4000);
                c.setReadTimeout(15000);
                String token = activity.prefs.hubToken();
                if (!token.isEmpty()) c.setRequestProperty("authorization", "Bearer " + token);
                byte[] bytes;
                try (java.io.InputStream in = c.getInputStream()) {
                    java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                    byte[] buf = new byte[32768];
                    for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                    bytes = out.toByteArray();
                } finally { c.disconnect(); }
                android.graphics.BitmapFactory.Options o = new android.graphics.BitmapFactory.Options();
                o.inJustDecodeBounds = true;
                android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.length, o);
                int sample = 1;
                while (o.outWidth / (sample * 2) >= 1920 && o.outHeight / (sample * 2) >= 1080) sample *= 2;
                o = new android.graphics.BitmapFactory.Options();
                o.inSampleSize = sample;
                android.graphics.Bitmap b = android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.length, o);
                if (b == null) return;
                java.io.File tmp = new java.io.File(context.getCacheDir(), "cover.jpg.tmp");
                try (java.io.FileOutputStream out = new java.io.FileOutputStream(tmp)) { b.compress(android.graphics.Bitmap.CompressFormat.JPEG, 88, out); }
                b.recycle();
                if (tmp.renameTo(HomeWatchService.coverFile(context))) activity.prefs.setCoverPath(path);
            } catch (Exception ignored) { }
        });
    }

    @JavascriptInterface
    public String status() {
        if (!activity.pageTrusted) return "{}";
        JSONObject o = new JSONObject();
        try {
            PackageInfo pi = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            o.put("version", pi.versionName);
            o.put("homeService", HomeRedirectService.isRunning() || HomeWatchService.isRunning());
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

    /** Opens (or closes) the TV's keyboard on the text box the page has just focused. */
    @JavascriptInterface
    public void keyboard(boolean show) {
        if (activity.pageTrusted) activity.showKeyboard(show);
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

    /** The home screen is drawn again after coming back: the Home cover can go. */
    @JavascriptInterface
    public void drawn() {
        HomeWatchService.drawn();
        activity.doButton();
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
