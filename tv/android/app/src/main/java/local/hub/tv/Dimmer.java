package local.hub.tv;

import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.View;
import android.view.WindowManager;

/**
 * Brightness. An app can't reach a TV's backlight, so this is a black shade over everything, from 0 (gone) to 80
 * percent. It takes no keys or touches, and goes with LocalHub's process. It needs "draw over other apps".
 */
final class Dimmer {

    static final int DARKEST = 80;
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static View shade; // main thread only

    private Dimmer() { }

    static boolean set(Context c, int percent) {
        if (!Settings.canDrawOverlays(c)) return false;
        Context app = c.getApplicationContext();
        int p = Math.max(0, Math.min(DARKEST, percent));
        MAIN.post(() -> apply(app, p));
        return true;
    }

    @SuppressWarnings("deprecation")
    private static void apply(Context c, int p) {
        WindowManager wm = (WindowManager) c.getSystemService(Context.WINDOW_SERVICE);
        try {
            if (p == 0) {
                if (shade != null) wm.removeView(shade);
                shade = null;
                return;
            }
            int color = Color.argb(Math.round(p * 2.55f), 0, 0, 0);
            if (shade != null) {
                shade.setBackgroundColor(color);
                return;
            }
            View v = new View(c);
            v.setBackgroundColor(color);
            wm.addView(v, new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
                    Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_SYSTEM_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                            | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_FULLSCREEN,
                    PixelFormat.TRANSLUCENT));
            shade = v;
        } catch (Exception e) {
            android.util.Log.w("LocalHub", "dim", e);
        }
    }
}
