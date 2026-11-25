package local.hub.tv;

import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * The computer's sound, played here while it's asked for (tv-audio.mjs sends it): 48 kHz, 16-bit, stereo, as it comes. It keeps
 * going behind any app on the TV and adds to its sound.
 */
final class AudioLink {
    private static volatile Thread running;

    private AudioLink() { }

    static synchronized void set(Prefs prefs, boolean on) {
        Thread was = running;
        running = null;
        if (was != null) was.interrupt();
        if (!on || prefs.hubUrl().isEmpty()) return;
        Thread t = new Thread(() -> loop(prefs), "hub-audio");
        t.setDaemon(true);
        running = t;
        t.start();
    }

    private static void loop(Prefs prefs) {
        int misses = 0;
        while (running == Thread.currentThread() && misses < 30) {
            int status = play(prefs);
            if (status == 409 || status == 401 || status == 403) break; // not going to a TV any more
            misses = status == 200 ? 0 : misses + 1;
            try { Thread.sleep(1500); } catch (InterruptedException e) { break; }
        }
        synchronized (AudioLink.class) { if (running == Thread.currentThread()) running = null; }
    }

    private static int play(Prefs prefs) {
        HttpURLConnection c = null;
        AudioTrack track = null;
        int status = 0;
        try {
            c = (HttpURLConnection) new URL(prefs.hubUrl() + "/api/tv/audio").openConnection();
            c.setConnectTimeout(4000);
            c.setReadTimeout(0); // silence sends nothing
            c.setRequestProperty("x-hub", "1");
            if (!prefs.hubToken().isEmpty()) c.setRequestProperty("authorization", "Bearer " + prefs.hubToken());
            status = c.getResponseCode();
            if (status != 200) return status;
            int min = AudioTrack.getMinBufferSize(48000, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT);
            track = new AudioTrack(AudioManager.STREAM_MUSIC, 48000, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min * 2, 19200), AudioTrack.MODE_STREAM);
            track.play();
            InputStream in = c.getInputStream();
            byte[] buf = new byte[7680]; // 40 ms
            int have = 0;
            while (running == Thread.currentThread()) {
                // Fallen behind (the network stalled): what waits is skipped, so it stays close to the computer.
                int waiting = in.available();
                if (waiting > 38400) for (int left = (waiting - 7680) / 4 * 4; left > 0; ) { int n = in.read(buf, 0, Math.min(left, buf.length)); if (n < 0) return status; left -= n; have = (have + n) % 4; }
                int n = in.read(buf, have, buf.length - have);
                if (n < 0) return status;
                have += n;
                int whole = have / 4 * 4;
                if (whole > 0) track.write(buf, 0, whole);
                System.arraycopy(buf, whole, buf, 0, have - whole);
                have -= whole;
            }
        } catch (Exception e) {
            if (status == 0) status = -1;
        } finally {
            if (track != null) try { track.pause(); track.flush(); track.release(); } catch (Exception ignored) { }
            if (c != null) c.disconnect();
        }
        return status;
    }
}
