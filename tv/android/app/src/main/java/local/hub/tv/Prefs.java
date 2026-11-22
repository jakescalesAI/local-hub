package local.hub.tv;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.ArrayList;
import java.util.List;

/**
 * What the TV app remembers natively: which LocalHub it is paired with, its device token, and its
 * own launch history (for "Opened 2 hours ago" and the dock order). Interface preferences live in
 * the WebView's localStorage. The token never goes to the web page.
 */
final class Prefs {

    private static final String HUB_URL = "hubUrl";
    private static final String HUB_TOKEN = "hubToken";
    private static final String HUB_NAME = "hubName";
    private static final String RECENTS = "recents";
    private static final int MAX_RECENTS = 24;

    private final SharedPreferences sp;

    Prefs(Context context) {
        sp = context.getSharedPreferences("localhub", Context.MODE_PRIVATE);
    }

    String hubUrl() { return sp.getString(HUB_URL, ""); }
    String hubToken() { return sp.getString(HUB_TOKEN, ""); }
    String hubName() { return sp.getString(HUB_NAME, ""); }

    void setHub(String url) { sp.edit().putString(HUB_URL, url).apply(); }

    void setPairing(String token, String name) {
        sp.edit().putString(HUB_TOKEN, token).putString(HUB_NAME, name).apply();
    }

    void forgetPairing() {
        sp.edit().remove(HUB_TOKEN).remove(HUB_NAME).apply();
    }

    static final class Recent {
        final String packageName;
        final long openedAt;

        Recent(String packageName, long openedAt) {
            this.packageName = packageName;
            this.openedAt = openedAt;
        }
    }

    List<Recent> recents() {
        List<Recent> out = new ArrayList<>();
        String raw = sp.getString(RECENTS, "");
        if (raw == null || raw.isEmpty()) return out;
        for (String line : raw.split("\n")) {
            int tab = line.indexOf('\t');
            if (tab <= 0) continue;
            try {
                out.add(new Recent(line.substring(0, tab), Long.parseLong(line.substring(tab + 1))));
            } catch (NumberFormatException ignored) {
                // A damaged line is dropped; the rest of the history survives.
            }
        }
        return out;
    }

    long openedAt(String packageName) {
        for (Recent r : recents()) if (r.packageName.equals(packageName)) return r.openedAt;
        return 0L;
    }

    void recordLaunch(String packageName, long now) {
        List<Recent> list = recents();
        StringBuilder sb = new StringBuilder();
        sb.append(packageName).append('\t').append(now);
        int kept = 1;
        for (int i = 0; i < list.size() && kept < MAX_RECENTS; i++) {
            Recent r = list.get(i);
            if (r.packageName.equals(packageName)) continue;
            sb.append('\n').append(r.packageName).append('\t').append(r.openedAt);
            kept++;
        }
        sp.edit().putString(RECENTS, sb.toString()).apply();
    }
}
