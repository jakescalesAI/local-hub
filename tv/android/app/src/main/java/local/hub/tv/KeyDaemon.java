package local.hub.tv;

import android.content.ComponentName;
import android.content.Intent;
import android.os.IBinder;
import android.os.SystemClock;
import android.system.Os;
import android.util.Base64;
import android.view.InputDevice;
import android.view.InputEvent;
import android.view.KeyCharacterMap;
import android.view.KeyEvent;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileDescriptor;
import java.io.FileInputStream;
import java.io.FileReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.lang.reflect.Method;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The remote's buttons in every app. Not part of the app's own process: LocalHub on your computer starts it over the TV's
 * debugging connection (tv-keys.mjs), the one you allowed to install LocalHub, so it runs as Android's "shell", which
 * may read the remote. It ends when the TV restarts, when you turn it off, or when Back is held for ten seconds.
 *
 * It holds the remote while the TV is awake. A button you gave a job does that job; every other button is passed on to
 * the TV as it was pressed. While LocalHub is in front its own page handles the ordinary buttons, and only the ones
 * Fire TV would take (Guide, the app buttons) are handled here. When it ends, Android has the remote back at once.
 *
 * One argument: base64 of { "MENU": "mic", "APP_1": "app:Plex|com.plexapp.android", … }, by key name.
 */
public final class KeyDaemon {
    private static final int EVIOCGRAB = 0x40044590;
    private static final int EV_KEY = 1;
    private static final long LET_GO_MS = 10_000;

    private static final Map<Integer, String> jobs = new HashMap<>();
    private static Object inputManager, activityManager, powerManager;
    private static Method inject, tasks, interactive;
    private static volatile Reader reader;

    private KeyDaemon() { }

    public static void main(String[] args) {
        try {
            JSONObject o = new JSONObject(new String(Base64.decode(args[0], Base64.DEFAULT), "UTF-8"));
            for (Iterator<String> it = o.keys(); it.hasNext(); ) {
                String k = it.next();
                int code = KeyEvent.keyCodeFromString("KEYCODE_" + k);
                if (code > 0 && !locked(code)) jobs.put(code, o.getString(k));
            }
            if (jobs.isEmpty()) { say("nothing to do"); System.exit(0); }
            Class<?> im = Class.forName("android.hardware.input.InputManager");
            inputManager = im.getMethod("getInstance").invoke(null);
            inject = im.getMethod("injectInputEvent", InputEvent.class, int.class);
            Object services = null;
            Method get = Class.forName("android.os.ServiceManager").getMethod("getService", String.class);
            powerManager = Class.forName("android.os.IPowerManager$Stub").getMethod("asInterface", IBinder.class).invoke(null, get.invoke(services, "power"));
            interactive = powerManager.getClass().getMethod("isInteractive");
            try { activityManager = Class.forName("android.app.ActivityManagerNative").getMethod("getDefault").invoke(null); }
            catch (Exception e) { activityManager = Class.forName("android.app.ActivityManager").getMethod("getService").invoke(null); }
            for (Method m : activityManager.getClass().getMethods()) if (m.getName().equals("getTasks")) tasks = m;
            say("ready");
            // Asleep, the remote is the TV's own: any button wakes it as always.
            while (true) {
                boolean awake = (Boolean) interactive.invoke(powerManager);
                Reader r = reader;
                if (awake && r == null) {
                    try { r = Reader.open(); } catch (Exception e) { say("err " + e); r = null; }
                    if (r != null) { reader = r; r.start(); }
                } else if (!awake && r != null) r.close();
                Thread.sleep(awake && reader == null ? 3000 : 700);
            }
        } catch (Throwable e) {
            say("err " + e);
        }
        System.exit(1); // closing the device gives the remote back
    }

    /** Never the ones that could lock you out. */
    private static boolean locked(int code) {
        return code == KeyEvent.KEYCODE_HOME || code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_POWER
                || code == KeyEvent.KEYCODE_ENTER || (code >= KeyEvent.KEYCODE_DPAD_UP && code <= KeyEvent.KEYCODE_DPAD_CENTER);
    }

    private static void say(String s) {
        synchronized (System.out) { System.out.println(s); System.out.flush(); }
    }

    private static boolean inLocalHub() {
        try {
            Object[] a = new Object[tasks.getParameterTypes().length];
            a[0] = 1;
            for (int i = 1; i < a.length; i++) a[i] = 0;
            List<?> l = (List<?>) tasks.invoke(activityManager, a);
            ComponentName top = (ComponentName) l.get(0).getClass().getField("topActivity").get(l.get(0));
            return "local.hub.tv".equals(top.getPackageName());
        } catch (Exception e) {
            return false;
        }
    }

    private static boolean system(int code) {
        String n = KeyEvent.keyCodeToString(code);
        return n.startsWith("KEYCODE_APP_") || n.equals("KEYCODE_LIVE_TV") || n.equals("KEYCODE_TV");
    }

    private static void press(int code) throws Exception {
        long now = SystemClock.uptimeMillis();
        send(code, 0, KeyEvent.ACTION_DOWN, now, now, -1);
        send(code, 0, KeyEvent.ACTION_UP, now, SystemClock.uptimeMillis(), -1);
    }

    private static void act(int code) {
        String what = jobs.get(code);
        say("act " + code);
        try {
            switch (what) {
                case "none": return;
                case "ai": press(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE); return;
                case "rew": press(KeyEvent.KEYCODE_MEDIA_REWIND); return;
                case "ff": press(KeyEvent.KEYCODE_MEDIA_FAST_FORWARD); return;
                case "sleep": press(KeyEvent.KEYCODE_SLEEP); return;
                default:
            }
            int bar = what.indexOf('|');
            if (what.startsWith("app:") && bar > 0) {
                run("monkey", "-p", what.substring(bar + 1), "-c", "android.intent.category.LEANBACK_LAUNCHER", "1");
                return;
            }
            Intent i = new Intent().setClassName("local.hub.tv", "local.hub.tv.MainActivity")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT).putExtra("button", what);
            if (!startDirect(i)) run("am", "start", "-n", "local.hub.tv/.MainActivity", "-f", "0x10020000", "--es", "button", what);
        } catch (Exception e) {
            say("err " + e);
        }
    }

    /** Straight to Android: the am command takes most of a second to start on the stick. */
    private static boolean startDirect(Intent i) {
        try {
            for (Method m : activityManager.getClass().getMethods()) {
                Class<?>[] p = m.getParameterTypes();
                if (!m.getName().equals("startActivity") || p.length != 10 || p[2] != Intent.class) continue;
                return (Integer) m.invoke(activityManager, null, "com.android.shell", i, null, null, null, 0, 0, null, null) >= 0;
            }
        } catch (Exception ignored) { }
        return false;
    }

    private static void run(String... cmd) throws IOException {
        new ProcessBuilder(cmd).redirectErrorStream(true).redirectOutput(new File("/dev/null")).start();
    }

    private static void send(int code, int scan, int action, long down, long at, int device) throws Exception {
        KeyEvent e = new KeyEvent(down, at, action, code, 0, 0, device < 0 ? KeyCharacterMap.VIRTUAL_KEYBOARD : device, scan, KeyEvent.FLAG_FROM_SYSTEM, InputDevice.SOURCE_KEYBOARD | InputDevice.SOURCE_DPAD);
        inject.invoke(inputManager, e, 0);
    }

    /** The remote itself: held, read, and passed on. */
    private static final class Reader extends Thread {
        private final FileInputStream in;
        private final Map<Integer, Integer> codes;
        private final int device;
        private final Map<Integer, Long> down = new HashMap<>();
        private volatile boolean closing, closed;

        private Reader(FileInputStream in, Map<Integer, Integer> codes, int device) {
            super("remote");
            this.in = in;
            this.codes = codes;
            this.device = device;
        }

        static Reader open() throws Exception {
            for (int id : InputDevice.getDeviceIds()) {
                InputDevice d = InputDevice.getDevice(id);
                if (d == null || d.getName() == null || !d.getName().contains("Remote") || d.getVendorId() == 0) continue;
                Map<Integer, Integer> codes = layout(d.getVendorId(), d.getProductId());
                String path = codes.isEmpty() ? null : pathOf(d.getName());
                if (path == null) continue;
                FileInputStream in = new FileInputStream(path);
                grab(in.getFD());
                return new Reader(in, codes, id);
            }
            return null;
        }

        private static void grab(FileDescriptor fd) throws Exception {
            Class<?> mi = Class.forName("android.util.MutableInt");
            Os.class.getMethod("ioctlInt", FileDescriptor.class, int.class, mi).invoke(null, fd, EVIOCGRAB, mi.getConstructor(int.class).newInstance(1));
        }

        /** Its /dev/input file, from what getevent lists. */
        private static String pathOf(String name) throws IOException {
            Process p = new ProcessBuilder("getevent", "-pl").redirectErrorStream(true).start();
            String line, path = null, found = null;
            try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream()))) {
                while ((line = r.readLine()) != null) {
                    int at = line.indexOf("/dev/input/event");
                    if (line.startsWith("add device") && at > 0) path = line.substring(at).trim();
                    else if (line.trim().startsWith("name:") && line.contains("\"" + name + "\"")) found = path;
                }
            }
            return found;
        }

        private static Map<Integer, Integer> layout(int vendor, int product) throws IOException {
            Map<Integer, Integer> m = new HashMap<>();
            File f = new File(String.format("/system/usr/keylayout/Vendor_%04x_Product_%04x.kl", vendor, product));
            if (!f.isFile()) return m;
            try (BufferedReader r = new BufferedReader(new FileReader(f))) {
                String line;
                while ((line = r.readLine()) != null) {
                    String[] p = line.trim().split("\\s+");
                    if (p.length < 3 || !p[0].equals("key")) continue;
                    try { m.put(Integer.decode(p[1]), KeyEvent.keyCodeFromString("KEYCODE_" + p[2])); } catch (NumberFormatException ignored) { }
                }
            }
            return m;
        }

        void close() {
            closing = true;
            end();
        }

        private void end() {
            closed = true;
            try { in.close(); } catch (IOException ignored) { }
            synchronized (KeyDaemon.class) { if (reader == this) reader = null; }
        }

        @Override
        public void run() {
            int size = android.os.Process.is64Bit() ? 24 : 16;
            byte[] raw = new byte[size * 16];
            ByteBuffer b = ByteBuffer.wrap(raw).order(ByteOrder.nativeOrder());
            Set<Integer> taken = new HashSet<>();
            long backAt = 0;
            try {
                int n;
                while (!closed && (n = in.read(raw)) > 0) {
                    for (int at = 0; at + size <= n; at += size) {
                        int type = b.getShort(at + size - 8) & 0xffff, scan = b.getShort(at + size - 6) & 0xffff, value = b.getInt(at + size - 4);
                        if (type != EV_KEY) continue;
                        Integer known = codes.get(scan);
                        int code = known == null ? 0 : known;
                        long now = SystemClock.uptimeMillis();
                        if (code == KeyEvent.KEYCODE_BACK) {
                            if (value == 1) backAt = now;
                            else if (value == 2 && backAt > 0 && now - backAt > LET_GO_MS) letGo(scan);
                            else if (value == 0) { if (backAt > 0 && now - backAt > LET_GO_MS) letGo(scan); backAt = 0; }
                        }
                        if (value == 2) continue; // Android makes its own repeats
                        if (value == 1) {
                            if (jobs.containsKey(code) && (system(code) || !inLocalHub())) { taken.add(scan); act(code); continue; }
                            down.put(scan, now);
                            send(code, scan, KeyEvent.ACTION_DOWN, now, now, device);
                        } else {
                            if (taken.remove(scan)) continue;
                            Long t = down.remove(scan);
                            send(code, scan, KeyEvent.ACTION_UP, t == null ? now : t, now, device);
                        }
                    }
                }
            } catch (Exception e) {
                if (!closing) say("err " + e);
            }
            // Nothing is left pressed on the TV's side.
            for (Map.Entry<Integer, Long> d : down.entrySet()) {
                Integer code = codes.get(d.getKey());
                try { send(code == null ? 0 : code, d.getKey(), KeyEvent.ACTION_UP, d.getValue(), SystemClock.uptimeMillis(), device); } catch (Exception ignored) { }
            }
            end();
        }

        private void letGo(int scan) throws Exception {
            say("let go");
            send(KeyEvent.KEYCODE_BACK, scan, KeyEvent.ACTION_UP, SystemClock.uptimeMillis(), SystemClock.uptimeMillis(), device);
            System.exit(0);
        }
    }
}
