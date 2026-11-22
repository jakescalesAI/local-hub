package local.hub.tv;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.media.tv.TvContract;
import android.media.tv.TvInputInfo;
import android.media.tv.TvInputManager;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * HDMI sources, read from TvInputManager. Fire TV Sticks report none (no HDMI in), so the row
 * simply never appears there; Fire TV Edition sets and Omni TVs list their ports.
 *
 * When HDMI-CEC identifies a device, it shows up as a child input of the port ("PlayStation 5"
 * under "HDMI 2"); the child is shown in place of the bare port.
 */
final class Inputs {

    static final class Input {
        final String id;
        final String label;
        final String sub;
        final int tint;

        Input(String id, String label, String sub, int tint) {
            this.id = id;
            this.label = label;
            this.sub = sub;
            this.tint = tint;
        }
    }

    private static final float[] HUES = {212f, 224f, 4f, 150f, 280f, 32f};

    private Inputs() {}

    static List<Input> load(Context context) {
        List<Input> out = new ArrayList<>();
        TvInputManager tim;
        List<TvInputInfo> all;
        try {
            tim = (TvInputManager) context.getSystemService(Context.TV_INPUT_SERVICE);
            if (tim == null) return out;
            all = tim.getTvInputList();
        } catch (Exception e) {
            return out;
        }
        if (all == null) return out;

        Set<String> parents = new HashSet<>();
        for (TvInputInfo info : all) {
            String parent = parentId(info);
            if (parent != null) parents.add(parent);
        }

        for (TvInputInfo info : all) {
            if (info == null || info.getType() != TvInputInfo.TYPE_HDMI) continue;
            if (parents.contains(info.getId())) continue; // a CEC child represents this port
            if (isHidden(context, info)) continue;

            String port = safeLabel(info.loadLabel(context), "HDMI");
            String custom = customLabel(context, info);
            String label = custom != null ? custom : port;
            String sub = custom != null && !custom.equals(port) ? port : "HDMI input";

            float hue = HUES[out.size() % HUES.length];
            int tint = Color.HSVToColor(new float[]{hue, 0.62f, 0.46f});
            out.add(new Input(info.getId(), label, sub, tint));
        }
        return out;
    }

    static String toJson(List<Input> inputs) {
        JSONArray arr = new JSONArray();
        for (Input i : inputs) {
            try {
                JSONObject o = new JSONObject();
                o.put("id", i.id);
                o.put("name", i.label);
                o.put("sub", i.sub);
                arr.put(o);
            } catch (Exception ignored) {
                // Skip it; the others still show.
            }
        }
        return arr.toString();
    }

    static Input find(Context context, String id) {
        for (Input i : load(context)) if (i.id.equals(id)) return i;
        return null;
    }

    static boolean launch(Context context, Input input) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW,
                    TvContract.buildChannelUriForPassthroughInput(input.id));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static String parentId(TvInputInfo info) {
        if (info == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return null;
        try {
            return info.getParentId();
        } catch (Exception e) {
            return null;
        }
    }

    private static boolean isHidden(Context context, TvInputInfo info) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false;
        try {
            return info.isHidden(context);
        } catch (Exception e) {
            return false;
        }
    }

    private static String customLabel(Context context, TvInputInfo info) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return null;
        try {
            CharSequence c = info.loadCustomLabel(context);
            if (c == null) return null;
            String s = c.toString().trim();
            return s.isEmpty() ? null : s;
        } catch (Exception e) {
            return null;
        }
    }

    private static String safeLabel(CharSequence raw, String fallback) {
        if (raw == null) return fallback;
        String s = raw.toString().trim();
        return s.isEmpty() ? fallback : s;
    }
}
