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
 * Other remotes, game controllers and keyboards work too. They are only listened to, never held (a stick's movement or a
 * keyboard's shift can't be passed on faithfully), so a button with a job does it and the app hears the press as well.
 *
 * One argument: base64 of { "MENU": "mic", "APP_1": "app:Plex|com.plexapp.android", … }, by key name, or "K99" for key code 99.
 */
public final class KeyDaemon {
    private static final int EVIOCGRAB = 0x40044590;
    private static final int EV_KEY = 1;
    private static final long LET_GO_MS = 10_000;

    private static final Map<Integer, String> jobs = new HashMap<>();
    private static Object inputManager, activityManager, powerManager;
    private static Method inject, tasks, interactive;
    private static final Map<String, Reader> readers = new HashMap<>();
    private static String listed = "";
    private static int settle;

    private KeyDaemon() { }

    public static void main(String[] args) {
        try {
            JSONObject o = new JSONObject(new String(Base64.decode(args[0], Base64.DEFAULT), "UTF-8"));
            for (Iterator<String> it = o.keys(); it.hasNext(); ) {
                String k = it.next();
                int code = k.matches("K\\d{1,4}") ? Integer.parseInt(k.substring(1)) : KeyEvent.keyCodeFromString("KEYCODE_" + k);
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
                try { if (awake) look(); else letAll(); } catch (Exception e) { say("err " + e); }
                Thread.sleep(700);
            }
        } catch (Throwable e) {
            say("err " + e);
        }
        System.exit(1); // closing the device gives the remote back
    }

    /** What's connected now. A remote that sleeps goes away and comes back as a new device. */
    private static void look() throws Exception {
        synchronized (readers) {
            for (Iterator<Reader> it = readers.values().iterator(); it.hasNext(); ) if (it.next().closed) { it.remove(); listed = ""; }
        }
        String[] names = new File("/dev/input").list();
        String now = names == null ? "" : java.util.Arrays.toString(names);
        // Something that has just connected may not be readable yet: a few more looks.
        if (!now.equals(listed)) settle = 6;
        listed = now;
        if (settle-- <= 0) { settle = 0; return; }
        for (Device d : Device.all()) {
            synchronized (readers) { if (readers.containsKey(d.path)) continue; }
            Reader r;
            try { r = Reader.open(d); } catch (Exception e) { if (settle == 0) say("err " + d.name + ": " + e); continue; }
            if (r == null) continue;
            synchronized (readers) { readers.put(d.path, r); }
            r.start();
            say((r.held ? "holding " : "listening to ") + d.name);
        }
    }

    private static void letAll() {
        synchronized (readers) {
            for (Reader r : readers.values()) r.closing = true;
            readers.clear();
        }
        listed = "";
    }

    /** Never the ones that could lock you out. */
    private static boolean locked(int code) {
        return code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_ENTER || code == KeyEvent.KEYCODE_NUMPAD_ENTER || (code >= KeyEvent.KEYCODE_DPAD_UP && code <= KeyEvent.KEYCODE_DPAD_CENTER);
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
        return n.startsWith("KEYCODE_APP_") || n.startsWith("KEYCODE_VOLUME_") || n.equals("KEYCODE_LIVE_TV") || n.equals("KEYCODE_TV")
                || code == KeyEvent.KEYCODE_SEARCH || code == KeyEvent.KEYCODE_ASSIST || code == KeyEvent.KEYCODE_HOME || code == KeyEvent.KEYCODE_POWER;
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
                case "volup": press(KeyEvent.KEYCODE_VOLUME_UP); return;
                case "voldown": press(KeyEvent.KEYCODE_VOLUME_DOWN); return;
                case "mute": press(KeyEvent.KEYCODE_VOLUME_MUTE); return;
                case "back": press(KeyEvent.KEYCODE_BACK); return;
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

    /** Something with buttons, from what getevent lists (asked again each time: Android's own list goes stale here). */
    private static final class Device {
        String path = "", name = "";
        int vendor, product;
        boolean axes;

        static List<Device> all() throws IOException {
            List<Device> l = new java.util.ArrayList<>();
            Process p = new ProcessBuilder("getevent", "-il").redirectErrorStream(true).start();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream()))) {
                String line;
                Device d = null;
                while ((line = r.readLine()) != null) {
                    String t = line.trim();
                    int at = line.indexOf("/dev/input/event");
                    if (line.startsWith("add device") && at > 0) { d = new Device(); d.path = line.substring(at).trim(); l.add(d); }
                    else if (d == null) continue;
                    else if (t.startsWith("vendor")) d.vendor = Integer.parseInt(t.substring(6).trim(), 16);
                    else if (t.startsWith("product")) d.product = Integer.parseInt(t.substring(7).trim(), 16);
                    else if (t.startsWith("name:")) d.name = t.substring(5).trim().replace("\"", "");
                    else if (t.startsWith("ABS (")) d.axes = true;
                }
            }
            for (Iterator<Device> it = l.iterator(); it.hasNext(); ) if (it.next().vendor <= 2) it.remove(); // the TV's own
            return l;
        }

        /** Android's number for it, which Alexa and games look at. */
        int id() {
            try {
                Process p = new ProcessBuilder("dumpsys", "input").redirectErrorStream(true).start();
                try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream()))) {
                    String line;
                    while ((line = r.readLine()) != null) {
                        String t = line.trim();
                        int c = t.indexOf(": ");
                        if (c > 0 && t.substring(c + 2).equals(name) && t.substring(0, c).matches("\\d+")) return Integer.parseInt(t.substring(0, c));
                    }
                }
            } catch (Exception ignored) { }
            return -1;
        }
    }

    /** One remote or controller. A remote is held, read, and passed on; anything else is only heard. */
    private static final class Reader extends Thread {
        private final FileInputStream in;
        private final Map<Integer, Integer> codes;
        private final int device;
        private final boolean held;
        private final Map<Integer, Long> down = new HashMap<>();
        private volatile boolean closing, closed;

        private Reader(FileInputStream in, Map<Integer, Integer> codes, int device, boolean held) {
            super("buttons");
            this.in = in;
            this.codes = codes;
            this.device = device;
            this.held = held;
        }

        static Reader open(Device d) throws Exception {
            File own = new File(String.format("/system/usr/keylayout/Vendor_%04x_Product_%04x.kl", d.vendor, d.product));
            Map<Integer, Integer> codes = layout(own.isFile() ? own : new File("/system/usr/keylayout/Generic.kl"));
            boolean any = false;
            for (int c : codes.values()) any |= jobs.containsKey(c);
            if (!any) return null;
            boolean held = !d.axes && own.isFile() && codes.containsValue(KeyEvent.KEYCODE_DPAD_CENTER) && d.name.contains("Remote");
            FileInputStream in = new FileInputStream(d.path);
            if (held) grab(in.getFD());
            return new Reader(in, codes, held ? d.id() : -1, held);
        }

        private static void grab(FileDescriptor fd) throws Exception {
            Class<?> mi = Class.forName("android.util.MutableInt");
            Os.class.getMethod("ioctlInt", FileDescriptor.class, int.class, mi).invoke(null, fd, EVIOCGRAB, mi.getConstructor(int.class).newInstance(1));
        }

        private static Map<Integer, Integer> layout(File f) throws IOException {
            Map<Integer, Integer> m = new HashMap<>();
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

        private void end() {
            closed = true;
            try { in.close(); } catch (IOException ignored) { }
        }

        @Override
        public void run() {
            int size = android.os.Process.is64Bit() ? 24 : 16;
            byte[] raw = new byte[size * 16];
            ByteBuffer b = ByteBuffer.wrap(raw).order(ByteOrder.nativeOrder());
            Set<Integer> taken = new HashSet<>();
            long backAt = 0;
            android.system.StructPollfd fd = new android.system.StructPollfd();
            try {
                fd.fd = in.getFD();
                fd.events = (short) android.system.OsConstants.POLLIN;
                int n;
                while (!closing) {
                    // Asked to stop, it does within half a second, so it never keeps the remote.
                    if (Os.poll(new android.system.StructPollfd[]{fd}, 500) <= 0) continue;
                    if ((n = in.read(raw)) <= 0) break;
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
                        if (!held) {
                            if (value == 1 && jobs.containsKey(code) && (system(code) || !inLocalHub())) act(code);
                            continue;
                        }
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
                say("gone " + e.getMessage());
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
