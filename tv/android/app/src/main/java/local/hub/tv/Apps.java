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
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
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
 *
 * Drawing and encoding every app's art took ~2 s on a Fire TV Stick at each start, so the list and the PNGs are
 * kept in the app's cache: the home screen shows the saved list at once, and a reload only draws apps that were
 * installed or updated since.
 */
final class Apps {

    static final class App {
        final String label;
        final String packageName;
        final String activityName;
        final boolean hasBanner;
        final boolean hasIcon;
        final int color;
        int edge; // the banner's own edge colour, for the strips above and below it; 0 not worked out yet, 1 none
        float[] fit; // where the banner's logo is (x0, y0, x1, y1, 0..1), so a tile can zoom to it; null: the whole banner
        boolean hasMark; // a white version of the logo (art/<pkg>/mark.png), for the home screen's header
        boolean marked; // the logo has been looked for (false in a list saved before this existed: look again)
        long stamp; // the package's lastUpdateTime: unchanged means its saved art is still right

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
        byte[] b = art.get(key);
        if (b != null) return b;
        try {
            File f = artFile(key);
            if (f.isFile()) { b = readFile(f); art.put(key, b); }
        } catch (Exception ignored) { }
        return b;
    }

    private File artFile(String key) {
        return new File(new File(context.getCacheDir(), "art"), key.replace('/', '_') + ".png");
    }

    private static byte[] readFile(File f) throws java.io.IOException {
        try (FileInputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream((int) f.length());
            byte[] buf = new byte[16384];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    private File index() {
        return new File(context.getCacheDir(), "apps.json");
    }

    /** The list saved by the last reload, so the home screen has its apps without waiting. False if there's none. */
    boolean loadSaved() {
        try {
            File f = index();
            if (!f.isFile()) return false;
            JSONArray arr = new JSONArray(new String(readFile(f), StandardCharsets.UTF_8));
            List<App> out = new ArrayList<>();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.getJSONObject(i);
                App a = new App(o.getString("label"), o.getString("pkg"), o.getString("activity"),
                        o.optBoolean("banner"), o.optBoolean("icon"), o.optInt("color", 0xFF2C2C2E));
                a.stamp = o.optLong("stamp");
                a.edge = o.optInt("edge", 0);
                JSONArray fitArr = o.optJSONArray("fit");
                if (fitArr != null && fitArr.length() == 4) a.fit = new float[]{(float) fitArr.optDouble(0), (float) fitArr.optDouble(1), (float) fitArr.optDouble(2), (float) fitArr.optDouble(3)};
                a.hasMark = o.optBoolean("mark");
                a.marked = o.has("mark");
                out.add(a);
            }
            synchronized (this) { if (apps.isEmpty()) apps = out; }
            return !out.isEmpty();
        } catch (Exception e) {
            return false;
        }
    }

    /** What the page sees of the list: equal means nothing to redraw. */
    synchronized String signature() {
        StringBuilder sb = new StringBuilder();
        for (App a : apps) sb.append(a.packageName).append('|').append(a.label).append('|').append(a.stamp).append('|').append(a.hasBanner).append(a.hasIcon).append(a.edge).append(';');
        return sb.toString();
    }

    private void save(List<App> list) {
        try {
            JSONArray arr = new JSONArray();
            for (App a : list) {
                JSONObject o = new JSONObject();
                o.put("label", a.label).put("pkg", a.packageName).put("activity", a.activityName)
                        .put("banner", a.hasBanner).put("icon", a.hasIcon).put("color", a.color).put("stamp", a.stamp).put("edge", a.edge).put("mark", a.hasMark);
                if (a.fit != null) o.put("fit", new JSONArray().put(a.fit[0]).put(a.fit[1]).put(a.fit[2]).put(a.fit[3]));
                arr.put(o);
            }
            File tmp = new File(context.getCacheDir(), "apps.json.tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) { out.write(arr.toString().getBytes(StandardCharsets.UTF_8)); }
            tmp.renameTo(index());
        } catch (Exception ignored) { }
    }

    /** Re-reads PackageManager. Slow-ish (icons are drawn), so call it off the UI thread. */
    void reload() {
        PackageManager pm = context.getPackageManager();
        List<App> out = new ArrayList<>();
        Map<String, byte[]> images = new HashMap<>();
        Set<String> seen = new HashSet<>();
        Map<String, App> saved = new HashMap<>();
        for (App a : list()) saved.put(a.packageName, a);

        collect(pm, new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER), out, images, seen, saved);
        collect(pm, new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), out, images, seen, saved);

        File dir = new File(context.getCacheDir(), "art");
        dir.mkdirs();
        for (Map.Entry<String, byte[]> e : images.entrySet()) {
            try (FileOutputStream f = new FileOutputStream(artFile(e.getKey()))) { f.write(e.getValue()); } catch (Exception ignored) { }
        }
        save(out);
        synchronized (this) {
            apps = out;
            art.keySet().removeIf(k -> !seen.contains(k.substring(0, k.indexOf('/'))));
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
                if (a.hasBanner && (a.edge >>> 24) == 0xFF) o.put("edge", String.format(Locale.US, "#%06X", a.edge & 0xFFFFFF));
                if (a.hasBanner && a.fit != null) o.put("fit", new JSONArray().put(a.fit[0]).put(a.fit[1]).put(a.fit[2]).put(a.fit[3]));
                if (a.hasMark) o.put("mark", "http://localhub.tv/art/" + a.packageName + "/mark.png");
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

    private void collect(PackageManager pm, Intent intent, List<App> out, Map<String, byte[]> images, Set<String> seen, Map<String, App> saved) {
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

            long stamp = 0;
            try { stamp = pm.getPackageInfo(pkg, 0).lastUpdateTime; } catch (Exception ignored) { }
            App old = saved.get(pkg);
            if (old != null && stamp != 0 && old.stamp == stamp && ri.activityInfo.name.equals(old.activityName)
                    && (!old.hasBanner || (old.edge != 0 && old.marked && artFile(pkg + "/banner").length() > 0)) && (!old.hasIcon || artFile(pkg + "/icon").length() > 0)) {
                out.add(old); // unchanged since it was drawn
                continue;
            }

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

            int color = dominant(banner != null ? banner : icon); // before png(), which recycles the bitmap
            int edge = edge(banner);
            float[] fit = banner != null ? logoBox(banner, edge) : null;
            Bitmap mark = fit != null ? whiteMark(banner, edge, fit) : null;
            byte[] markPng = mark != null ? png(mark) : null;
            // Some apps hand Android a banner that won't encode (Amazon's hedwig gave 0 bytes): no banner, then.
            byte[] bannerPng = banner != null ? png(banner) : null, iconPng = icon != null ? png(icon) : null;
            boolean hasBanner = bannerPng != null && bannerPng.length > 0, hasIcon = iconPng != null && iconPng.length > 0;
            if (hasBanner) images.put(pkg + "/banner", bannerPng);
            if (hasIcon) images.put(pkg + "/icon", iconPng);
            App a = new App(label, pkg, ri.activityInfo.name, hasBanner, hasIcon, color);
            a.stamp = stamp;
            a.edge = hasBanner ? edge : 0;
            a.fit = hasBanner ? fit : null;
            a.hasMark = hasBanner && markPng != null && markPng.length > 0;
            a.marked = true;
            if (a.hasMark) images.put(pkg + "/mark", markPng);
            out.add(a);
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

    // How far a pixel is from the banner's background (0..1): its colour away from the edge colour, or, on a
    // see-through banner, its own opacity.
    private static float ink(int p, int edge) {
        int a = (p >>> 24) & 0xFF;
        if ((edge >>> 24) != 0xFF) return a / 255f;
        int d = Math.max(Math.abs(((p >> 16) & 0xFF) - ((edge >> 16) & 0xFF)), Math.max(Math.abs(((p >> 8) & 0xFF) - ((edge >> 8) & 0xFF)), Math.abs((p & 0xFF) - (edge & 0xFF))));
        return Math.max(0f, Math.min(1f, (d - 36) / 70f)) * (a / 255f);
    }

    /** Where the logo is on a banner with a plain background: the box around everything that isn't background.
     *  Null when the background isn't plain (a photo) or the logo already fills it: the tile shows the banner whole. */
    static float[] logoBox(Bitmap b, int edge) {
        if (b == null || b.isRecycled() || edge == 0) return null;
        int w = b.getWidth(), h = b.getHeight();
        int[] px = new int[w * h];
        b.getPixels(px, 0, w, 0, 0, w, h);
        // A plain background: the edge rows hardly differ from their own colour.
        if ((edge >>> 24) == 0xFF) {
            int off = 0, n = 0;
            for (int x = 0; x < w; x += 3) { for (int y : new int[]{0, h - 1}) { n++; if (ink(px[y * w + x], edge) > 0.3f) off++; } }
            if (off > n / 12) return null;
        }
        int x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (int y = 0; y < h; y++) for (int x = 0; x < w; x++) {
            if (ink(px[y * w + x], edge) > 0.5f) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        }
        if (x1 < 0 || (x1 - x0) * (y1 - y0) > w * h * 0.86f || (x1 - x0) < w / 12) return null;
        return new float[]{x0 / (float) w, y0 / (float) h, (x1 + 1) / (float) w, (y1 + 1) / (float) h};
    }

    /** The logo in white, cut out of its banner by how far each pixel is from the background. */
    static Bitmap whiteMark(Bitmap b, int edge, float[] box) {
        int w = b.getWidth(), h = b.getHeight();
        int x0 = (int) (box[0] * w), y0 = (int) (box[1] * h), x1 = (int) Math.ceil(box[2] * w), y1 = (int) Math.ceil(box[3] * h);
        int mw = Math.max(1, x1 - x0), mh = Math.max(1, y1 - y0);
        int[] px = new int[mw * mh];
        b.getPixels(px, 0, mw, x0, y0, mw, mh);
        for (int i = 0; i < px.length; i++) px[i] = (Math.round(ink(px[i], edge) * 255) << 24) | 0xFFFFFF;
        return Bitmap.createBitmap(px, mw, mh, Bitmap.Config.ARGB_8888);
    }

    /** The banner's top and bottom rows, averaged: a tile shows the whole banner and fills above and below with it. */
    private static int edge(Bitmap bitmap) {
        if (bitmap == null || bitmap.isRecycled()) return 0;
        long r = 0, g = 0, b = 0, a = 0, n = 0;
        int w = bitmap.getWidth(), h = bitmap.getHeight();
        for (int y : new int[]{0, 1, 2, h - 3, h - 2, h - 1}) {
            for (int x = 0; x < w; x += 4) {
                int p = bitmap.getPixel(x, y);
                a += (p >>> 24) & 0xFF;
                r += (p >> 16) & 0xFF;
                g += (p >> 8) & 0xFF;
                b += p & 0xFF;
                n++;
            }
        }
        if (n == 0 || a / n < 128) return 1; // see-through edges: the tile keeps its colour (1: worked out, none)
        return 0xFF000000 | ((int) (r / n) << 16) | ((int) (g / n) << 8) | (int) (b / n);
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
