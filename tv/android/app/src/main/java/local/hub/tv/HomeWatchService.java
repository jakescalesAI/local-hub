package local.hub.tv;

import android.Manifest;
import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

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
 * Honest limitation: Amazon's home screen shows for a moment first.
 */
public class HomeWatchService extends Service {

    private static volatile boolean watching;
    private volatile boolean stopped;
    private Process logcat;
    private final Handler main = new Handler(Looper.getMainLooper());

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

    private void bringBack() {
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
