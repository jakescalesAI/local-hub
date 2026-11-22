package local.hub.tv;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.Drawable;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The TV's launchable apps, straight from PackageManager, with their own art: the 16:9 TV banner
 * the app ships for Fire TV / Android TV (that is what every TV launcher shows for it), and its
 * icon as a fallback. Art is encoded to PNG once and served to the UI at
 * http://localhub.tv/art/&lt;package&gt;/banner.png and …/icon.png.
 */
final class Apps {

    static final class App {
        final String label;
        final String packageName;
        final String activityName;
        final boolean hasBanner;
        final boolean hasIcon;
        final int color;

        App(String label, String packageName, String activityName, boolean hasBanner, boolean hasIcon, int color) {
            this.label = label;
            this.packageName = packageName;
            this.activityName = activityName;
            this.hasBanner = hasBanner;
            this.hasIcon = hasIcon;
            this.color = color;
        }

        Intent intent() {
            Intent i = new Intent(Intent.ACTION_MAIN);
            i.addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER);
            i.setComponent(new ComponentName(packageName, activityName));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            return i;
        }
    }

    private static final int BANNER_W = 640;
    private static final int BANNER_H = 360;
    private static final int ICON = 192;

    private final Context context;
    private final Map<String, byte[]> art = new HashMap<>();
    private List<App> apps = new ArrayList<>();

    Apps(Context context) {
        this.context = context.getApplicationContext();
    }

    synchronized List<App> list() {
        return apps;
    }

    synchronized byte[] art(String key) {
        return art.get(key);
    }

    /** Re-reads PackageManager. Slow-ish (icons are drawn), so call it off the UI thread. */
    void reload() {
        PackageManager pm = context.getPackageManager();
        List<App> out = new ArrayList<>();
        Map<String, byte[]> images = new HashMap<>();
        Set<String> seen = new HashSet<>();

        collect(pm, new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER), out, images, seen);
        collect(pm, new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), out, images, seen);

        synchronized (this) {
            apps = out;
            art.clear();
            art.putAll(images);
        }
    }

    String toJson(Prefs prefs) {
        JSONArray arr = new JSONArray();
        for (App a : list()) {
            try {
                JSONObject o = new JSONObject();
                o.put("id", a.packageName);
                o.put("name", a.label);
                if (a.hasBanner) o.put("banner", "http://localhub.tv/art/" + a.packageName + "/banner.png");
                if (a.hasIcon) o.put("icon", "http://localhub.tv/art/" + a.packageName + "/icon.png");
                o.put("color", String.format(Locale.US, "#%06X", a.color & 0xFFFFFF));
                long at = prefs.openedAt(a.packageName);
                if (at > 0) o.put("recent", at);
                arr.put(o);
            } catch (Exception ignored) {
                // One bad app never empties the shelf.
            }
        }
        return arr.toString();
    }

    App find(String packageName) {
        for (App a : list()) if (a.packageName.equals(packageName)) return a;
        return null;
    }

    boolean launch(String packageName) {
        App app = find(packageName);
        if (app != null) {
            try {
                context.startActivity(app.intent());
                return true;
            } catch (Exception ignored) {
                // Fall through to the intents the app itself publishes.
            }
        }
        PackageManager pm = context.getPackageManager();
        Intent fallback = null;
        try { fallback = pm.getLeanbackLaunchIntentForPackage(packageName); } catch (Exception ignored) { }
        if (fallback == null) {
            try { fallback = pm.getLaunchIntentForPackage(packageName); } catch (Exception ignored) { }
        }
        if (fallback == null) return false;
        fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(fallback);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void collect(PackageManager pm, Intent intent, List<App> out, Map<String, byte[]> images, Set<String> seen) {
        List<ResolveInfo> found;
        try {
            found = pm.queryIntentActivities(intent, 0);
        } catch (Exception e) {
            return;
        }
        if (found == null) return;

        for (ResolveInfo ri : found) {
            if (ri == null || ri.activityInfo == null) continue;
            String pkg = ri.activityInfo.packageName;
            if (pkg == null || pkg.equals(context.getPackageName()) || seen.contains(pkg)) continue;
            seen.add(pkg);

            String label = pkg;
            try {
                CharSequence raw = ri.loadLabel(pm);
                if (raw != null && raw.toString().trim().length() > 0) label = raw.toString().trim();
            } catch (Exception ignored) { }

            Bitmap banner = null;
            try {
                Drawable d = ri.activityInfo.loadBanner(pm);
                if (d == null) d = ri.activityInfo.applicationInfo.loadBanner(pm);
                banner = draw(d, BANNER_W, BANNER_H);
            } catch (Exception ignored) { }

            Bitmap icon = null;
            try {
                icon = draw(ri.loadIcon(pm), ICON, ICON);
            } catch (Exception ignored) { }

            if (banner != null) images.put(pkg + "/banner", png(banner));
            if (icon != null) images.put(pkg + "/icon", png(icon));
            int color = dominant(banner != null ? banner : icon);
            out.add(new App(label, pkg, ri.activityInfo.name, banner != null, icon != null, color));
        }
    }

    private static Bitmap draw(Drawable d, int w, int h) {
        if (d == null) return null;
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        d.setBounds(0, 0, w, h);
        d.draw(c);
        return b;
    }

    private static byte[] png(Bitmap b) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.PNG, 100, out);
        b.recycle();
        return out.toByteArray();
    }

    /** A usable backdrop colour: average of the opaque pixels, saturation lifted, brightness tamed. */
    private static int dominant(Bitmap bitmap) {
        if (bitmap == null || bitmap.isRecycled()) return 0xFF2C2C2E;
        long r = 0, g = 0, b = 0, n = 0;
        int step = Math.max(1, bitmap.getWidth() / 40);
        for (int y = 0; y < bitmap.getHeight(); y += step) {
            for (int x = 0; x < bitmap.getWidth(); x += step) {
                int p = bitmap.getPixel(x, y);
                if (((p >>> 24) & 0xFF) < 200) continue;
                r += (p >> 16) & 0xFF;
                g += (p >> 8) & 0xFF;
                b += p & 0xFF;
                n++;
            }
        }
        if (n == 0) return 0xFF2C2C2E;
        float[] hsv = new float[3];
        Color.RGBToHSV((int) (r / n), (int) (g / n), (int) (b / n), hsv);
        hsv[1] = Math.min(1f, hsv[1] * 1.35f + 0.12f);
        hsv[2] = Math.min(0.62f, Math.max(0.26f, hsv[2] * 0.9f));
        return Color.HSVToColor(hsv);
    }
}
