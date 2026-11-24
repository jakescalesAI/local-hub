package local.hub.tv;

import android.content.ComponentName;
import android.content.Context;
import android.graphics.Bitmap;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.util.Base64;
import android.view.KeyEvent;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.List;

/**
 * The Layout panel's player. The buttons send the same media keys a remote does, so they need no permission. The
 * title and picture come from the app that's playing, which Android only shows with notification access
 * (MediaListener); without it the player just says whether something is playing.
 */
final class Media {

    private static String artFor = "";
    private static String art = "";

    private Media() { }

    static synchronized String run(Context c, String action) {
        AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        if ("toggle".equals(action)) press(am, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE);
        else if ("next".equals(action)) press(am, KeyEvent.KEYCODE_MEDIA_NEXT);
        else if ("prev".equals(action)) press(am, KeyEvent.KEYCODE_MEDIA_PREVIOUS);
        JSONObject o = new JSONObject();
        try {
            o.put("playing", am.isMusicActive());
            MediaController m = session(c);
            if (m == null) return o.toString();
            PlaybackState s = m.getPlaybackState();
            if (s != null) o.put("playing", s.getState() == PlaybackState.STATE_PLAYING);
            MediaMetadata d = m.getMetadata();
            if (d == null) return o.toString();
            String title = d.getString(MediaMetadata.METADATA_KEY_TITLE);
            String artist = d.getString(MediaMetadata.METADATA_KEY_ARTIST);
            if (title != null) o.put("title", title);
            if (artist != null) o.put("artist", artist);
            o.put("app", c.getPackageManager().getApplicationLabel(c.getPackageManager().getApplicationInfo(m.getPackageName(), 0)).toString());
            o.put("art", picture(d, m.getPackageName() + "|" + title + "|" + artist));
        } catch (Exception ignored) { }
        return o.toString();
    }

    private static void press(AudioManager am, int code) {
        am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, code));
        am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, code));
    }

    /** The app that's playing, else the last one that was; null without notification access. */
    private static MediaController session(Context c) {
        try {
            MediaSessionManager sm = (MediaSessionManager) c.getSystemService(Context.MEDIA_SESSION_SERVICE);
            List<MediaController> all = sm.getActiveSessions(new ComponentName(c, MediaListener.class));
            for (MediaController m : all) {
                PlaybackState s = m.getPlaybackState();
                if (s != null && s.getState() == PlaybackState.STATE_PLAYING) return m;
            }
            for (MediaController m : all) if (m.getMetadata() != null) return m;
        } catch (SecurityException ignored) { }
        return null;
    }

    private static String picture(MediaMetadata d, String key) {
        if (key.equals(artFor)) return art;
        Bitmap b = d.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
        if (b == null) b = d.getBitmap(MediaMetadata.METADATA_KEY_ART);
        String made = "";
        if (b != null) {
            int max = Math.max(b.getWidth(), b.getHeight());
            Bitmap small = max <= 240 ? b : Bitmap.createScaledBitmap(b, Math.max(1, b.getWidth() * 240 / max), Math.max(1, b.getHeight() * 240 / max), true);
            ByteArrayOutputStream o = new ByteArrayOutputStream();
            small.compress(Bitmap.CompressFormat.JPEG, 80, o);
            made = "data:image/jpeg;base64," + Base64.encodeToString(o.toByteArray(), Base64.NO_WRAP);
            artFor = key;
            art = made;
        }
        return made;
    }
}
