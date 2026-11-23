package local.hub.tv;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * LocalHub TV: a home screen in the tvOS style. The whole interface is the web UI in assets/ui
 * (the same files LocalHub serves at /tv/), shown full screen in a WebView from the made-up origin
 * http://localhub.tv/, which this activity answers itself — nothing is fetched from the internet.
 * Java does what a page can't: list and launch apps, read their banners, switch HDMI inputs, use
 * the microphone and speak, and talk to LocalHub on the laptop.
 */
public class MainActivity extends Activity {

    private static final String ORIGIN_HOST = "localhub.tv";
    private static final int MIC_REQUEST = 7;

    final ExecutorService io = Executors.newCachedThreadPool();
    Prefs prefs;
    Apps apps;
    Hub hub;
    Voice voice;
    volatile boolean typing;
    volatile byte[] lastAudio;

    private WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private volatile long keyLoadAt;
    private boolean resumed;
    private BroadcastReceiver packageReceiver;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        prefs = new Prefs(this);
        apps = new Apps(this);
        hub = new Hub(prefs);
        voice = new Voice(this, new Voice.Listener() {
            @Override public void onLevel(float level) { emit(Native.event("level").put("value", level)); }
            @Override public void onAudio(byte[] wav) { lastAudio = wav; emit(Native.event("audio")); }
            @Override public void onNoSpeech() { emit(Native.event("noSpeech")); }
            @Override public void onMicError(String message) { emit(Native.event("micError").put("message", message)); }
            @Override public void onSpeechDone() { emit(Native.event("speechDone")); }
        });

        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);
        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setTextZoom(100);
        ws.setAllowFileAccess(false);
        ws.setAllowContentAccess(false);
        ws.setCacheMode(WebSettings.LOAD_NO_CACHE);
        web.addJavascriptInterface(new Native(this), "LocalHubNative");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serve(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !trusted(request.getUrl()); // never leave LocalHub
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                pageTrusted = url != null && trusted(Uri.parse(url));
            }

            // The hub didn't answer: show the bundled screen, which can pair and launch apps.
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                if (request.isForMainFrame() && !ORIGIN_HOST.equals(request.getUrl().getHost())) view.post(MainActivity.this::hubAway);
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (!request.isForMainFrame() || ORIGIN_HOST.equals(request.getUrl().getHost())) return;
                int status = response.getStatusCode();
                if (status == 401 || status == 403) {
                    // A reload carries only the hub's cookie, which a restarted or reset hub may not take: ask
                    // again with this TV's key before deciding the TV isn't paired any more.
                    if (SystemClock.uptimeMillis() - keyLoadAt > 15000) { view.post(MainActivity.this::loadHub); return; }
                    prefs.forgetPairing();
                    view.post(MainActivity.this::loadLocal);
                    return;
                }
                view.post(MainActivity.this::hubAway);
            }
        });
        setContentView(web);
        web.requestFocus();
        if (hub.paired()) loadHub(); else loadLocal();

        io.execute(() -> {
            apps.reload();
            js("window.haven&&haven.appsChanged()");
        });

        packageReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                io.execute(() -> {
                    apps.reload();
                    js("window.haven&&haven.appsChanged()");
                });
            }
        };
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_PACKAGE_ADDED);
        f.addAction(Intent.ACTION_PACKAGE_REMOVED);
        f.addAction(Intent.ACTION_PACKAGE_CHANGED);
        f.addDataScheme("package");
        registerReceiver(packageReceiver, f);
        HomeWatchService.start(this);
    }

    // ── which page ────────────────────────────────────────────────────────────────────────────

    /** LocalHub's own /tv/ page, signed in with this TV's device key (the hub swaps it for a cookie). */
    void loadHub() {
        String base = prefs.hubUrl();
        if (base.isEmpty() || prefs.hubToken().isEmpty()) {
            loadLocal();
            return;
        }
        // A hub that's switched off, or a laptop that's asleep, can leave the load hanging for minutes on a black
        // screen (Windows drops the connection rather than refusing it). Ask it first, briefly.
        io.execute(() -> {
            boolean up = Hub.looksLikeHub(base, 1500);
            runOnUiThread(() -> {
                if (web == null) return;
                if (!up) { hubAway(); return; }
                Map<String, String> headers = new HashMap<>();
                headers.put("Authorization", "Bearer " + prefs.hubToken());
                keyLoadAt = SystemClock.uptimeMillis();
                web.loadUrl(base + "/tv/", headers);
            });
        });
    }

    /** The hub didn't answer: the bundled screen (apps still open), and LocalHub's own page again once it's back. */
    void hubAway() {
        loadLocal();
        ui.removeCallbacks(retryHub);
        if (resumed && hub.paired()) ui.postDelayed(retryHub, 5000);
    }

    private final Runnable retryHub = () -> {
        if (resumed && hub.paired() && web != null && !onHubPage()) loadHub();
    };

    private boolean onHubPage() {
        String url = web.getUrl();
        return url != null && !ORIGIN_HOST.equals(Uri.parse(url).getHost());
    }

    /** The bundled copy: pairing, and the apps, for when the hub can't be reached. */
    void loadLocal() {
        String local = "http://" + ORIGIN_HOST + "/index.html";
        if (!local.equals(web.getUrl())) web.loadUrl(local);
    }

    volatile boolean pageTrusted;

    /** The bridge answers only LocalHub: the bundled page, or the hub this TV is paired with. */
    boolean trusted(Uri uri) {
        if (uri == null || uri.getHost() == null) return false;
        if (ORIGIN_HOST.equals(uri.getHost())) return true;
        Uri hubUri = prefs.hubUrl().isEmpty() ? null : Uri.parse(prefs.hubUrl());
        return hubUri != null && uri.getHost().equals(hubUri.getHost()) && uri.getPort() == hubUri.getPort();
    }

    // ── the local origin ──────────────────────────────────────────────────────────────────────

    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html");
        MIME.put("js", "text/javascript");
        MIME.put("css", "text/css");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("json", "application/json");
    }

    private WebResourceResponse serve(Uri uri) {
        if (!ORIGIN_HOST.equals(uri.getHost())) return null; // LocalHub on the LAN goes through Java, see Hub
        String path = uri.getPath() == null || uri.getPath().equals("/") ? "/index.html" : uri.getPath();
        if (path.contains("..")) return missing();

        if (path.startsWith("/art/")) {
            String key = path.substring(5).replaceAll("\\.png$", "");
            byte[] png = apps.art(key);
            if (png == null) return missing();
            return new WebResourceResponse("image/png", null, 200, "OK", cacheHeaders(), new ByteArrayInputStream(png));
        }

        String ext = path.substring(path.lastIndexOf('.') + 1);
        String mime = MIME.get(ext);
        if (mime == null) return missing();
        try {
            InputStream in = getAssets().open("ui" + path);
            return new WebResourceResponse(mime, "utf-8", 200, "OK", new HashMap<>(), in);
        } catch (Exception e) {
            return missing();
        }
    }

    private static Map<String, String> cacheHeaders() {
        Map<String, String> h = new HashMap<>();
        h.put("cache-control", "max-age=600");
        return h;
    }

    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<>(),
                new ByteArrayInputStream(new byte[0]));
    }

    // ── the remote ────────────────────────────────────────────────────────────────────────────

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        String name = keyName(event.getKeyCode());
        // While the hub's chat box (or a code field) has the keyboard, arrows and OK belong to it.
        // Back, Menu and ⏯ always come to the page, so Back never closes the home screen.
        if (typing && !"back".equals(name) && !"menu".equals(name) && !"ai".equals(name)) return super.dispatchKeyEvent(event);
        if (name == null) return super.dispatchKeyEvent(event);
        if (event.getAction() == KeyEvent.ACTION_DOWN) js("window.haven&&haven.key('" + name + "')");
        return true;
    }

    private static String keyName(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_DPAD_LEFT: return "left";
            case KeyEvent.KEYCODE_DPAD_RIGHT: return "right";
            case KeyEvent.KEYCODE_DPAD_UP: return "up";
            case KeyEvent.KEYCODE_DPAD_DOWN: return "down";
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
            case KeyEvent.KEYCODE_BUTTON_A: return "enter";
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_ESCAPE:
            case KeyEvent.KEYCODE_BUTTON_B: return "back";
            case KeyEvent.KEYCODE_MENU: return "menu";
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_PLAY:
            case KeyEvent.KEYCODE_SEARCH: return "ai";
            default: return null;
        }
    }

    // ── microphone ────────────────────────────────────────────────────────────────────────────

    void startListening() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, MIC_REQUEST);
            return;
        }
        voice.start();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != MIC_REQUEST) return;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) voice.start();
        else emit(Native.event("micError").put("message", "LocalHub needs the microphone to hear you. You can still ask through Alexa."));
    }

    // ── to the page ───────────────────────────────────────────────────────────────────────────

    void js(String code) {
        runOnUiThread(() -> {
            if (web != null) web.evaluateJavascript(code, null);
        });
    }

    void emit(Native.Event event) {
        js("window.haven&&haven.onNative(" + event.toString() + ")");
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        if (hub.paired() && web != null && web.getUrl() != null && !onHubPage()) ui.post(retryHub);
        js("window.haven&&haven.resumed()");
        HomeWatchService.localHubShown();
    }

    @Override
    protected void onPause() {
        resumed = false;
        ui.removeCallbacks(retryHub);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        try { unregisterReceiver(packageReceiver); } catch (Exception ignored) { }
        voice.shutdown();
        io.shutdownNow();
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
