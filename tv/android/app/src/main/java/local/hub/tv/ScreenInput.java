package local.hub.tv;

import android.content.ComponentName;
import android.content.Intent;
import android.os.IBinder;
import android.os.SystemClock;
import android.util.Base64;
import android.view.InputDevice;
import android.view.InputEvent;
import android.view.KeyCharacterMap;
import android.view.KeyEvent;
import android.view.MotionEvent;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.lang.reflect.Method;
import java.util.List;

/**
 * A computer's keys and clicks in any app on the TV, while it watches the TV's screen. Like KeyDaemon, LocalHub on your
 * computer starts it over the TV's debugging connection (tv-screen.mjs), and it ends when that connection closes.
 *
 * In, a line each: "k CODE", "t X Y" (a tap, 0 to 1), "x BASE64" (text), "h" (LocalHub's home). Out, when it changes: "s AWAKE PACKAGE".
 */
public final class ScreenInput {
    private static Object inputManager, activityManager, powerManager;
    private static Method inject, tasks, interactive;

    private ScreenInput() { }

    public static void main(String[] args) {
        try {
            Class<?> im = Class.forName("android.hardware.input.InputManager");
            inputManager = im.getMethod("getInstance").invoke(null);
            inject = im.getMethod("injectInputEvent", InputEvent.class, int.class);
            Method get = Class.forName("android.os.ServiceManager").getMethod("getService", String.class);
            powerManager = Class.forName("android.os.IPowerManager$Stub").getMethod("asInterface", IBinder.class).invoke(null, get.invoke(null, "power"));
            interactive = powerManager.getClass().getMethod("isInteractive");
            try { activityManager = Class.forName("android.app.ActivityManagerNative").getMethod("getDefault").invoke(null); }
            catch (Exception e) { activityManager = Class.forName("android.app.ActivityManager").getMethod("getService").invoke(null); }
            for (Method m : activityManager.getClass().getMethods()) if (m.getName().equals("getTasks")) tasks = m;
        } catch (Throwable e) {
            System.out.println("e " + e);
            System.exit(1);
        }
        Thread t = new Thread(ScreenInput::report);
        t.setDaemon(true);
        t.start();
        try {
            BufferedReader in = new BufferedReader(new InputStreamReader(System.in, "UTF-8"));
            for (String line; (line = in.readLine()) != null; ) {
                try { act(line.trim()); } catch (Exception e) { System.out.println("e " + e); }
            }
        } catch (Exception ignored) { }
        System.exit(0);
    }

    private static void report() {
        String last = "";
        while (true) {
            try {
                String s = "s " + (((Boolean) interactive.invoke(powerManager)) ? 1 : 0) + " " + front();
                if (!s.equals(last)) System.out.println(last = s);
                if (System.out.checkError()) System.exit(0); // nobody is listening any more
                Thread.sleep(400);
            } catch (Exception e) {
                return;
            }
        }
    }

    private static String front() {
        try {
            Object[] a = new Object[tasks.getParameterTypes().length];
            a[0] = 1;
            for (int i = 1; i < a.length; i++) a[i] = 0;
            List<?> l = (List<?>) tasks.invoke(activityManager, a);
            return ((ComponentName) l.get(0).getClass().getField("topActivity").get(l.get(0))).getPackageName();
        } catch (Exception e) {
            return "";
        }
    }

    private static void act(String line) throws Exception {
        String[] p = line.split(" ");
        switch (p[0]) {
            case "k": {
                int code = Integer.parseInt(p[1]);
                long now = SystemClock.uptimeMillis();
                for (int action : new int[]{KeyEvent.ACTION_DOWN, KeyEvent.ACTION_UP})
                    inject.invoke(inputManager, new KeyEvent(now, SystemClock.uptimeMillis(), action, code, 0, 0, KeyCharacterMap.VIRTUAL_KEYBOARD, 0, KeyEvent.FLAG_FROM_SYSTEM, InputDevice.SOURCE_KEYBOARD | InputDevice.SOURCE_DPAD), 0);
                return;
            }
            case "t": {
                // A Fire TV draws at 1920 by 1080 whatever it sends to the panel.
                float x = Float.parseFloat(p[1]) * 1920, y = Float.parseFloat(p[2]) * 1080;
                long now = SystemClock.uptimeMillis();
                for (int action : new int[]{MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP}) {
                    MotionEvent e = MotionEvent.obtain(now, SystemClock.uptimeMillis(), action, x, y, action == MotionEvent.ACTION_DOWN ? 1f : 0f, 1f, 0, 1f, 1f, 0, 0);
                    e.setSource(InputDevice.SOURCE_TOUCHSCREEN);
                    inject.invoke(inputManager, e, 0);
                    e.recycle();
                }
                return;
            }
            case "x": {
                String text = new String(Base64.decode(p[1], Base64.DEFAULT), "UTF-8");
                KeyCharacterMap map = KeyCharacterMap.load(KeyCharacterMap.VIRTUAL_KEYBOARD);
                for (char c : text.toCharArray()) {
                    KeyEvent[] ev = map.getEvents(new char[]{c});
                    if (ev != null) for (KeyEvent e : ev) inject.invoke(inputManager, KeyEvent.changeTimeRepeat(e, SystemClock.uptimeMillis(), 0), 0);
                }
                return;
            }
            case "h": {
                Intent i = new Intent().setClassName("local.hub.tv", "local.hub.tv.MainActivity").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT).putExtra("fromHomeKey", true);
                for (Method m : activityManager.getClass().getMethods()) {
                    Class<?>[] t = m.getParameterTypes();
                    if (m.getName().equals("startActivity") && t.length == 10 && t[2] == Intent.class) { m.invoke(activityManager, null, "com.android.shell", i, null, null, null, 0, 0, null, null); return; }
                }
                return;
            }
            default:
        }
    }
}
