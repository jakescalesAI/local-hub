package local.hub.tv;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.os.Build;
import android.view.accessibility.AccessibilityEvent;

/**
 * The Home button, on Fire OS.
 *
 * Fire OS pins Amazon's launcher as the home activity and will not let another app register for
 * android.intent.category.HOME, so the only signal available is "the TV's home screen came to the
 * front". That is all this listens for: one event type, no window content, no key events.
 *
 * Honest limitation: the event arrives as Amazon's screen is already drawing, so it can flash for a
 * frame before LocalHub covers it.
 *
 * It also lends LocalHub one global action, Sleep, because an accessibility service is the only
 * thing an ordinary app has that can lock the screen.
 */
public class HomeRedirectService extends AccessibilityService {

    private static volatile HomeRedirectService running;

    private static final String[] LAUNCHER_PACKAGES = {
            "com.amazon.tv.launcher",
            "com.amazon.firehomestarter",
            "com.google.android.tvlauncher",
            "com.google.android.apps.tv.launcherx",
    };

    static boolean isRunning() {
        return running != null;
    }

    /** Puts the TV to sleep. Needs the service on, and Android 9 (Fire OS 7) or newer. */
    static boolean sleep() {
        HomeRedirectService s = running;
        if (s == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return false;
        try {
            return s.performGlobalAction(GLOBAL_ACTION_LOCK_SCREEN);
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        running = this;
    }

    @Override
    public boolean onUnbind(Intent intent) {
        running = null;
        return super.onUnbind(intent);
    }

    @Override
    public void onDestroy() {
        running = null;
        super.onDestroy();
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null || event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
        CharSequence name = event.getPackageName();
        if (name == null) return;
        String pkg = name.toString();

        boolean isHome = false;
        for (String launcher : LAUNCHER_PACKAGES) {
            if (launcher.equals(pkg)) {
                isHome = true;
                break;
            }
        }
        if (!isHome) return;

        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try {
            startActivity(intent);
        } catch (Exception ignored) {
            // Background start refused: the next Home press tries again.
        }
    }

    @Override
    public void onInterrupt() {
        // No continuous feedback to stop.
    }
}
