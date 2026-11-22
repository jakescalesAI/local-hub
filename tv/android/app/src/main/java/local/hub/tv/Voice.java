package local.hub.tv;

import android.content.Context;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * The TV's ears and voice.
 *
 * Ears: 16 kHz mono PCM from whatever microphone the TV lets an app open, with a small energy
 * detector so a turn ends by itself about a second after you stop talking. The clip is handed back
 * as a WAV for LocalHub's Whisper on the laptop. Fire TV keeps the remote's mic button for Alexa, so
 * on a Stick this usually finds no usable mic and says so; Omni and Cube have far-field mics.
 *
 * Voice: Android's TextToSpeech, fed sentence by sentence while the answer is still streaming.
 */
final class Voice {

    interface Listener {
        void onLevel(float level);
        void onAudio(byte[] wav);
        void onNoSpeech();
        void onMicError(String message);
        void onSpeechDone();
    }

    private static final int RATE = 16000;
    private static final int FRAME = 320;            // 20 ms
    private static final int CALIBRATE_FRAMES = 15;  // 300 ms of room noise
    private static final int END_SILENCE = 33;       // 660 ms of quiet ends the turn
    private static final int MAX_FRAMES = 1500;      // 30 s
    private static final int GIVE_UP_FRAMES = 350;   // 7 s without speech

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Listener listener;
    private volatile Thread thread;
    private volatile int finish;                     // 0 run, 1 stop + deliver, 2 discard

    private TextToSpeech tts;
    private volatile boolean ttsReady;
    private final List<String> ttsBacklog = new ArrayList<>();
    private final AtomicInteger speaking = new AtomicInteger();
    private int utterance;

    Voice(Context context, Listener listener) {
        this.listener = listener;
        tts = new TextToSpeech(context.getApplicationContext(), status -> {
            ttsReady = status == TextToSpeech.SUCCESS;
            if (!ttsReady) return;
            try { tts.setLanguage(Locale.getDefault()); } catch (Exception ignored) { }
            tts.setSpeechRate(1.05f);
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { }
                @Override public void onDone(String id) { done(); }
                @Override public void onError(String id) { done(); }
            });
            List<String> pending;
            synchronized (ttsBacklog) {
                pending = new ArrayList<>(ttsBacklog);
                ttsBacklog.clear();
            }
            for (String s : pending) speak(s);
        });
    }

    // ── ears ──────────────────────────────────────────────────────────────────────────────────

    boolean listening() {
        return thread != null;
    }

    void start() {
        if (thread != null) return;
        finish = 0;
        Thread t = new Thread(this::record, "localhub-mic");
        thread = t;
        t.start();
    }

    void stop() { finish = 1; }

    void cancel() { finish = 2; }

    private void record() {
        AudioRecord rec = null;
        try {
            int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            if (min <= 0) {
                fail("This TV has no microphone LocalHub can use.");
                return;
            }
            int buf = Math.max(min, FRAME * 2 * 8);
            rec = open(MediaRecorder.AudioSource.VOICE_RECOGNITION, buf);
            if (rec == null) rec = open(MediaRecorder.AudioSource.MIC, buf);
            if (rec == null) {
                fail("This TV has no microphone LocalHub can use. Fire TV keeps the remote's mic for Alexa.");
                return;
            }
            rec.startRecording();
            if (rec.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                fail("The microphone is busy — Alexa may be using it.");
                return;
            }

            ByteArrayOutputStream pcm = new ByteArrayOutputStream(RATE * 2 * 6);
            short[] frame = new short[FRAME];
            byte[] bytes = new byte[FRAME * 2];
            double floor = 0;
            int frames = 0, quiet = 0, loud = 0, deadFrames = 0;
            boolean heard = false;

            while (finish == 0 && frames < MAX_FRAMES) {
                int n = rec.read(frame, 0, FRAME);
                if (n <= 0) break;
                long sum = 0;
                int peak = 0;
                for (int i = 0; i < n; i++) {
                    int v = frame[i];
                    sum += (long) v * v;
                    if (Math.abs(v) > peak) peak = Math.abs(v);
                    bytes[i * 2] = (byte) (v & 0xFF);
                    bytes[i * 2 + 1] = (byte) ((v >> 8) & 0xFF);
                }
                pcm.write(bytes, 0, n * 2);
                double rms = Math.sqrt(sum / (double) n);
                frames++;

                deadFrames = peak == 0 ? deadFrames + 1 : 0;
                if (deadFrames > 100) {
                    fail("The microphone gives only silence here. Fire TV keeps the remote's mic for Alexa.");
                    return;
                }

                if (frames <= CALIBRATE_FRAMES) {
                    floor += rms / CALIBRATE_FRAMES;
                } else {
                    double threshold = Math.max(floor * 2.6, 380);
                    if (rms > threshold) {
                        loud++;
                        quiet = 0;
                        if (loud >= 3) heard = true;
                    } else {
                        loud = 0;
                        quiet++;
                    }
                    if (heard && quiet >= END_SILENCE) break;
                    if (!heard && frames >= GIVE_UP_FRAMES) break;
                }
                if (frames % 3 == 0) {
                    final float level = (float) Math.min(1.0, rms / 3200.0);
                    main.post(() -> listener.onLevel(level));
                }
            }

            if (finish == 2) return;
            if (!heard && finish != 1) {
                main.post(listener::onNoSpeech);
                return;
            }
            final byte[] wav = wav(pcm.toByteArray());
            main.post(() -> listener.onAudio(wav));
        } catch (SecurityException e) {
            fail("LocalHub isn't allowed to use the microphone.");
        } catch (Exception e) {
            fail("The microphone stopped: " + e.getMessage());
        } finally {
            if (rec != null) {
                try { rec.stop(); } catch (Exception ignored) { }
                rec.release();
            }
            thread = null;
        }
    }

    private static AudioRecord open(int source, int buf) {
        try {
            AudioRecord r = new AudioRecord(source, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, buf);
            if (r.getState() == AudioRecord.STATE_INITIALIZED) return r;
            r.release();
        } catch (Exception ignored) {
            // Try the next source.
        }
        return null;
    }

    private void fail(String message) {
        main.post(() -> listener.onMicError(message));
    }

    static byte[] wav(byte[] pcm) {
        int len = pcm.length;
        byte[] out = new byte[44 + len];
        writeAscii(out, 0, "RIFF");
        writeInt(out, 4, 36 + len);
        writeAscii(out, 8, "WAVE");
        writeAscii(out, 12, "fmt ");
        writeInt(out, 16, 16);
        writeShort(out, 20, 1);
        writeShort(out, 22, 1);
        writeInt(out, 24, RATE);
        writeInt(out, 28, RATE * 2);
        writeShort(out, 32, 2);
        writeShort(out, 34, 16);
        writeAscii(out, 36, "data");
        writeInt(out, 40, len);
        System.arraycopy(pcm, 0, out, 44, len);
        return out;
    }

    private static void writeAscii(byte[] b, int at, String s) {
        for (int i = 0; i < s.length(); i++) b[at + i] = (byte) s.charAt(i);
    }

    private static void writeInt(byte[] b, int at, int v) {
        b[at] = (byte) v;
        b[at + 1] = (byte) (v >> 8);
        b[at + 2] = (byte) (v >> 16);
        b[at + 3] = (byte) (v >> 24);
    }

    private static void writeShort(byte[] b, int at, int v) {
        b[at] = (byte) v;
        b[at + 1] = (byte) (v >> 8);
    }

    // ── voice ─────────────────────────────────────────────────────────────────────────────────

    void speak(String text) {
        if (text == null || text.trim().isEmpty()) return;
        if (!ttsReady) {
            if (tts == null) {
                main.post(listener::onSpeechDone);
                return;
            }
            synchronized (ttsBacklog) { ttsBacklog.add(text); }
            return;
        }
        speaking.incrementAndGet();
        String id = "u" + (++utterance);
        int r = tts.speak(text, TextToSpeech.QUEUE_ADD, new Bundle(), id);
        if (r != TextToSpeech.SUCCESS) done();
    }

    void stopSpeaking() {
        synchronized (ttsBacklog) { ttsBacklog.clear(); }
        if (tts != null && ttsReady) tts.stop();
        speaking.set(0);
    }

    private void done() {
        if (speaking.decrementAndGet() <= 0) {
            speaking.set(0);
            main.post(listener::onSpeechDone);
        }
    }

    void shutdown() {
        cancel();
        if (tts != null) {
            try { tts.shutdown(); } catch (Exception ignored) { }
            tts = null;
        }
    }
}
