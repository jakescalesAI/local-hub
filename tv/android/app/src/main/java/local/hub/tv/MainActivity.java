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

    /** The TV's keyboard, open on the focused text box at once (focusing it from the page alone needs a second OK). */
    void showKeyboard(boolean show) {
        runOnUiThread(() -> {
            if (web == null) return;
            android.view.inputmethod.InputMethodManager imm = (android.view.inputmethod.InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (imm == null) return;
            if (show) imm.showSoftInput(web, android.view.inputmethod.InputMethodManager.SHOW_FORCED); // no requestFocus: it moved focus off the text box
            else imm.hideSoftInputFromWindow(web.getWindowToken(), 0);
        });
    }

    /** A picture of the home screen as it is now (the page asks while it sits idle on Home), for Home's cover: Android
     *  keeps LocalHub waiting ~5 s after Home, and showing its own home screen meanwhile makes Home look instant. */
    void snapshotHome() {
        runOnUiThread(() -> {
            if (web == null || !resumed || web.getWidth() == 0) return;
            try {
                android.graphics.Bitmap b = android.graphics.Bitmap.createBitmap(960, 540, android.graphics.Bitmap.Config.RGB_565);
                android.graphics.Canvas c = new android.graphics.Canvas(b);
                c.scale(960f / web.getWidth(), 540f / web.getHeight());
                web.draw(c);
                io.execute(() -> {
                    java.io.File tmp = new java.io.File(getCacheDir(), "home.jpg.tmp");
                    try (java.io.FileOutputStream out = new java.io.FileOutputStream(tmp)) {
                        b.compress(android.graphics.Bitmap.CompressFormat.JPEG, 85, out);
                    } catch (Exception ignored) { }
                    b.recycle();
                    tmp.renameTo(HomeWatchService.homeFile(this));
                });
            } catch (Exception ignored) { }
        });
    }
    private android.widget.ImageView veil;
    private boolean veilWanted, stopped;

    /** Home's last picture, put in front once the app covers LocalHub (onStop), and faded off when the page is drawn again. */
    void raiseVeil() {
        io.execute(() -> {
            java.io.File f = HomeWatchService.homeFile(this);
            android.graphics.Bitmap b = f.length() > 0 && System.currentTimeMillis() - f.lastModified() < 12 * 3600_000L ? android.graphics.BitmapFactory.decodeFile(f.getPath()) : null;
            if (b == null) return;
            ui.post(() -> { veil.setImageBitmap(b); veilWanted = true; if (stopped) showVeil(); });
        });
    }

    private void showVeil() {
        if (!veilWanted) return;
        veilWanted = false;
        veil.animate().cancel();
        veil.setAlpha(1f);
        veil.setVisibility(android.view.View.VISIBLE);
    }

    void dropVeil() {
        ui.post(() -> {
            veilWanted = false;
            if (veil.getVisibility() != android.view.View.VISIBLE) return;
            veil.animate().alpha(0f).setDuration(260).withEndAction(() -> { veil.setVisibility(android.view.View.GONE); veil.setImageDrawable(null); }).start();
        });
    }

    @Override
    protected void onStop() {
        super.onStop();
        stopped = true;
        showVeil();
    }

    final Handler ui = new Handler(Looper.getMainLooper());
    private volatile long keyLoadAt;
    boolean resumed; // in front (Native.toFront reads it)
    private BroadcastReceiver packageReceiver;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        prefs = new Prefs(this);
        if (savedInstanceState == null) takeButton(getIntent());
        // The opening (the LocalHub logo) is a loading screen for a fresh start. Coming back is not one: Android
        // rebuilding LocalHub after closing it behind another app, or Home.
        quickStart = savedInstanceState != null
                || (getIntent() != null && getIntent().getBooleanExtra("fromHomeKey", false));
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
                HomeWatchService.pageReady = false; // Home's cover waits for this page to say drawn()
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
        android.widget.FrameLayout root = new android.widget.FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        root.addView(web);
        veil = new android.widget.ImageView(this);
        veil.setScaleType(android.widget.ImageView.ScaleType.FIT_XY);
        veil.setVisibility(android.view.View.GONE);
        root.addView(veil, new android.widget.FrameLayout.LayoutParams(-1, -1));
        // A fresh start plays the opening over the page; a return just shows it.
        if (!quickStart) root.addView(intro = new Intro(this));
        setContentView(root);
        web.requestFocus();
        apps.loadSaved(); // the last list and its art, read from the cache: the home screen doesn't wait for PackageManager
        if (hub.paired()) loadHub(); else loadLocal();

        io.execute(() -> {
            String before = apps.signature();
            apps.reload();
            if (!before.equals(apps.signature()) || before.isEmpty()) js("window.haven&&haven.appsChanged()");
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
            // Not there: the computer may have a new address on the home network (a router hands out another after a
            // restart). Look for it, at most once a minute, and move only to a hub that still takes this TV's key, so
            // the pairing stays.
            if (!up && SystemClock.uptimeMillis() - lastScanAt > 60_000) {
                lastScanAt = SystemClock.uptimeMillis();
                String found = Hub.scan();
                if (found != null && !found.equals(base) && Hub.keyWorks(found, prefs.hubToken(), 1500)) {
                    prefs.setHub(found);
                    runOnUiThread(this::loadHub);
                    return;
                }
            }
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

    private volatile long lastScanAt = -60_000;

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
        if (intro != null && intro.showing()) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) intro.skip();
            return true;
        }
        String name = keyName(event.getKeyCode());
        // While the hub's chat box (or a code field) has the keyboard, arrows and OK belong to it.
        // Back, Menu and ⏯ always come to the page, so Back never closes the home screen.
        if (typing && !"back".equals(name) && !"menu".equals(name) && !"ai".equals(name)) return super.dispatchKeyEvent(event);
        if (name == null) return super.dispatchKeyEvent(event);
        // OK goes on release, so holding it can mean something else: held half a second, it's "hold" (the tile menu).
        if ("enter".equals(name)) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                if (event.getRepeatCount() == 0) okHeld = false;
                else if (!okHeld) { okHeld = true; js("window.haven&&haven.key('hold')"); }
            } else if (event.getAction() == KeyEvent.ACTION_UP && !okHeld) {
                js("window.haven&&haven.key('enter')");
            }
            return true;
        }
        if (event.getAction() == KeyEvent.ACTION_DOWN) js("window.haven&&haven.key('" + name + "')");
        return true;
    }

    private boolean okHeld;
    /** True when this start is a return to LocalHub rather than a fresh one (see onCreate). Also true once LocalHub
     *  has been left: a page loaded after that (Fire OS dropping the page's renderer behind a big app) is a return. */
    boolean quickStart;

    /** A remote button pressed over another app (KeyDaemon). If Fire OS had closed LocalHub, it waits for the page. */
    private volatile String pendingButton;
    private void takeButton(Intent intent) {
        String button = intent == null ? null : intent.getStringExtra("button");
        if (button == null) return;
        intent.removeExtra("button");
        pendingButton = button;
        if (HomeWatchService.pageReady && web != null) doButton();
    }

    private Intro intro;

    boolean playsIntro() { return intro != null; }

    void introDone(Intro i) {
        if (i.getParent() instanceof android.view.ViewGroup) ((android.view.ViewGroup) i.getParent()).removeView(i);
        if (intro == i) intro = null;
        web.requestFocus();
    }

    /** The page is drawn. */
    void doButton() {
        ui.post(() -> { if (intro != null) intro.drawn(); });
        String b = pendingButton;
        pendingButton = null;
        if (b != null) js("window.haven&&haven.button&&haven.button(" + org.json.JSONObject.quote(b) + ")");
    }

    /** Home, from another app or from LocalHub itself, lands on the home screen: first row, nothing open. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        takeButton(intent);
        if (intent != null && intent.getBooleanExtra("fromHomeKey", false)) js("window.haven&&haven.home&&haven.home()");
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
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
            case KeyEvent.KEYCODE_SEARCH: return "ai";
            // ⏪ ⏩: a page at a time (three rows, a screen of settings or messages); in the browser, seek a video.
            case KeyEvent.KEYCODE_MEDIA_REWIND:
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
            case KeyEvent.KEYCODE_PAGE_UP: return "rew";
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
            case KeyEvent.KEYCODE_MEDIA_NEXT:
            case KeyEvent.KEYCODE_PAGE_DOWN: return "ff";
            case KeyEvent.KEYCODE_SETTINGS: return "settings";
            default:
                // Any other button on a remote, game controller or keyboard goes to the page as "key:<code>", for
                // Settings › Remote buttons to give a job (system keys such as Home and volume are left alone).
                if (KeyEvent.isGamepadButton(code) || (code >= KeyEvent.KEYCODE_0 && code <= KeyEvent.KEYCODE_9)
                        || (code >= KeyEvent.KEYCODE_A && code <= KeyEvent.KEYCODE_Z) || (code >= KeyEvent.KEYCODE_F1 && code <= KeyEvent.KEYCODE_F12)
                        || (code >= KeyEvent.KEYCODE_PROG_RED && code <= KeyEvent.KEYCODE_PROG_BLUE) || code == KeyEvent.KEYCODE_GUIDE
                        || code == KeyEvent.KEYCODE_INFO || code == KeyEvent.KEYCODE_CAPTIONS || code == KeyEvent.KEYCODE_BOOKMARK) return "key:" + code;
                return null;
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
        stopped = false;
        prefs.setInFront(true);
        if (hub.paired() && web != null && web.getUrl() != null && !onHubPage()) ui.post(retryHub);
        js("window.haven&&haven.resumed()");
        ui.postDelayed(this::dropVeil, 2600); // whatever the page does
        HomeWatchService.localHubShown();
    }

    @Override
    protected void onPause() {
        resumed = false;
        if (HomeWatchService.pageReady) quickStart = true; // left after its opening had played
        prefs.setInFront(false);
        prefs.seen(System.currentTimeMillis());
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
