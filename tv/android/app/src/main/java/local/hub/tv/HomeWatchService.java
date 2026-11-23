package local.hub.tv;

import android.Manifest;
import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.BufferedReader;
import java.io.InputStreamReader;

/**
 * The Home button, on Fire OS, without an accessibility service.
 *
 * Fire OS 6.7 won't let a sideloaded app's accessibility service be switched on, and it keeps the Home key's
 * broadcast (CLOSE_SYSTEM_DIALOGS, reason "homekey") for Amazon-signed apps. What's left is what Launcher Manager
 * does: watch the system log for Amazon's home screen being started ("START u0 {act=android.intent.action.MAIN
 * cat=[android.intent.category.HOME] ...") and bring LocalHub straight back. Reading the log needs the developer
 * permission READ_LOGS, granted once over adb:
 *
 *   adb shell pm grant local.hub.tv android.permission.READ_LOGS
 *
 * Without it this does nothing. It runs as a foreground service so the TV doesn't stop it while another app plays.
 *
 * Android holds an app that reopens itself within 5 s of Home ("app switch" protection; only Amazon-signed apps
 * skip it). So the moment Home is seen, LocalHub's own opening screen covers Amazon's home, and it goes as soon as
 * LocalHub is back in front: it feels instant. The cover needs "draw over other apps", granted once over adb:
 *
 *   adb shell appops set local.hub.tv SYSTEM_ALERT_WINDOW allow
 *
 * Without that, Amazon's home shows for those seconds instead. The cover takes the remote's keys while it's up, so
 * nothing on Amazon's screen gets opened by accident, and it never stays longer than 8 s.
 */
public class HomeWatchService extends Service {

    private static volatile boolean watching;
    private volatile boolean stopped;
    private Process logcat;
    private final Handler main = new Handler(Looper.getMainLooper());
    private static volatile HomeWatchService self;
    private View cover;

    /** True while the log is being watched: Home brings LocalHub back. */
    static boolean isRunning() {
        return watching;
    }

    static boolean canWatch(Context c) {
        return c.checkSelfPermission(Manifest.permission.READ_LOGS) == PackageManager.PERMISSION_GRANTED;
    }

    static void start(Context c) {
        if (!canWatch(c)) return;
        try { c.startService(new Intent(c, HomeWatchService.class)); } catch (Exception ignored) { }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        Notification n = new Notification.Builder(this)
                .setContentTitle(getString(R.string.app_name))
                .setContentText("Home brings LocalHub back")
                .setSmallIcon(R.drawable.ic_launcher)
                .setPriority(Notification.PRIORITY_MIN)
                .build();
        startForeground(7, n);
        self = this;
        Thread t = new Thread(this::watch, "home-watch");
        t.setDaemon(true);
        t.start();
    }

    private void watch() {
        while (!stopped) {
            try {
                // Only ActivityManager's lines, from now on: a few lines a minute.
                logcat = Runtime.getRuntime().exec(new String[]{"logcat", "-v", "brief", "-T", "1", "ActivityManager:I", "*:S"});
                watching = true;
                BufferedReader in = new BufferedReader(new InputStreamReader(logcat.getInputStream()));
                String line;
                while (!stopped && (line = in.readLine()) != null) {
                    if (line.contains("START u0") && line.contains("cat=[android.intent.category.HOME]")) main.post(this::bringBack);
                }
            } catch (Exception ignored) {
            } finally {
                watching = false;
                if (logcat != null) logcat.destroy();
            }
            if (!stopped) try { Thread.sleep(2000); } catch (InterruptedException e) { return; }
        }
    }

    /** MainActivity is in front again: the cover goes once the page says its home screen is drawn (drawn()),
     *  or after 2.5 s at most. Redrawing after the background took the stick about a second of 200-400 ms frames. */
    static void localHubShown() {
        HomeWatchService s = self;
        if (s != null) s.main.postDelayed(s::hideCover, 2500);
    }

    /** The page has drawn its home screen smoothly again: the cover can go now. */
    static void drawn() {
        HomeWatchService s = self;
        if (s != null) s.main.post(s::hideCover);
    }

    private void showCover() {
        if (cover != null || !Settings.canDrawOverlays(this)) return;
        LinearLayout box = new LinearLayout(this) {
            @Override
            public boolean dispatchKeyEvent(KeyEvent event) {
                return true; // the remote does nothing on Amazon's screen underneath
            }
        };
        // The same "Local [house] Hub" as LocalHub's opening screen, so the hand-over doesn't show.
        box.setOrientation(LinearLayout.HORIZONTAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.BLACK);
        float dp = getResources().getDisplayMetrics().density;
        int icon = Math.round(84 * dp), gap = Math.round(14 * dp);
        box.addView(word("Local"));
        ImageView mark = new ImageView(this);
        mark.setImageResource(R.drawable.ic_launcher);
        LinearLayout.LayoutParams mp = new LinearLayout.LayoutParams(icon, icon);
        mp.setMargins(gap, 0, gap, 0);
        box.addView(mark, mp);
        box.addView(word("Hub"));
        @SuppressWarnings("deprecation")
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_SYSTEM_ALERT,
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_FULLSCREEN,
                PixelFormat.OPAQUE);
        try {
            ((WindowManager) getSystemService(WINDOW_SERVICE)).addView(box, lp);
            cover = box;
            main.postDelayed(this::hideCover, 8000);
        } catch (Exception ignored) { }
    }

    private TextView word(String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextColor(Color.WHITE);
        t.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 80);
        t.setTypeface(android.graphics.Typeface.create("sans-serif", android.graphics.Typeface.BOLD));
        t.setIncludeFontPadding(false);
        return t;
    }

    private void hideCover() {
        if (cover == null) return;
        try { ((WindowManager) getSystemService(WINDOW_SERVICE)).removeView(cover); } catch (Exception ignored) { }
        cover = null;
    }

    private void bringBack() {
        showCover();
        Intent home = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                .putExtra("fromHomeKey", true);
        try { startActivity(home); } catch (Exception ignored) { }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        hideCover();
        self = null;
        stopped = true;
        watching = false;
        if (logcat != null) logcat.destroy();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
