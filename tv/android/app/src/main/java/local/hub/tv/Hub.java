package local.hub.tv;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * The TV's line to LocalHub on your laptop. Requests go from Java, not the page, so the device
 * token stays here and LocalHub's same-origin rules (the x-hub header, no CORS) still hold.
 *
 * Only a short list of hub routes can be reached this way: chat, the TV routes and pairing.
 */
final class Hub {

    static final int PORT = 3100;

    interface Lines {
        void line(String line);
    }

    private final Prefs prefs;

    Hub(Prefs prefs) {
        this.prefs = prefs;
    }

    boolean paired() {
        return !prefs.hubUrl().isEmpty() && !prefs.hubToken().isEmpty();
    }

    static boolean allowed(String method, String path) {
        if (path == null || path.contains("..") || path.contains("//")) return false;
        String p = path.split("\\?")[0];
        return p.equals("/api/ping")
                || p.equals("/api/chat/send") || p.equals("/api/chat/stop") || p.equals("/api/chat/info")
                || p.startsWith("/api/tv/");
    }

    /** Sends one request and streams the reply body back a line at a time. Returns the HTTP status. */
    int request(String method, String path, String contentType, byte[] body, int readTimeoutMs, Lines onLine) throws Exception {
        String base = prefs.hubUrl();
        if (base.isEmpty()) throw new IllegalStateException("No LocalHub chosen yet");
        HttpURLConnection c = (HttpURLConnection) new URL(base + path).openConnection();
        try {
            c.setConnectTimeout(4000);
            c.setReadTimeout(readTimeoutMs);
            c.setRequestMethod(method);
            c.setRequestProperty("x-hub", "1");
            c.setRequestProperty("accept", "application/json, application/x-ndjson");
            String token = prefs.hubToken();
            if (!token.isEmpty()) c.setRequestProperty("authorization", "Bearer " + token);
            if (body != null) {
                c.setDoOutput(true);
                c.setRequestProperty("content-type", contentType != null ? contentType : "application/json");
                c.setFixedLengthStreamingMode(body.length);
                try (OutputStream out = c.getOutputStream()) {
                    out.write(body);
                }
            }
            int status = c.getResponseCode();
            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in != null && onLine != null) {
                try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = r.readLine()) != null) {
                        if (!line.isEmpty()) onLine.line(line);
                    }
                }
            }
            return status;
        } finally {
            c.disconnect();
        }
    }

    /** Claims a one-time code from the hub's /pair/new page. Returns the hub's name. */
    String pair(String code) throws Exception {
        JSONObject req = new JSONObject();
        req.put("code", code);
        req.put("name", "TV");
        req.put("platform", "tv");
        final StringBuilder out = new StringBuilder();
        HttpURLConnection c = (HttpURLConnection) new URL(prefs.hubUrl() + "/api/pair/claim").openConnection();
        try {
            c.setConnectTimeout(4000);
            c.setReadTimeout(8000);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("x-hub", "1");
            c.setRequestProperty("content-type", "application/json");
            byte[] body = req.toString().getBytes(StandardCharsets.UTF_8);
            c.setFixedLengthStreamingMode(body.length);
            try (OutputStream o = c.getOutputStream()) { o.write(body); }
            int status = c.getResponseCode();
            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
            if (in != null) out.append(readAll(in));
            JSONObject json = out.length() > 0 ? new JSONObject(out.toString()) : new JSONObject();
            if (status != 200 || !json.has("token")) {
                throw new IllegalStateException(json.optString("error", "That code didn't work."));
            }
            String name = json.optJSONObject("hub") != null ? json.getJSONObject("hub").optString("name", "LocalHub") : "LocalHub";
            prefs.setPairing(json.getString("token"), name);
            return name;
        } finally {
            c.disconnect();
        }
    }

    /** True when `base` answers like a LocalHub: its pairing page is open to anyone who can reach it. */
    static boolean looksLikeHub(String base, int timeoutMs) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(base + "/pair").openConnection();
            c.setConnectTimeout(timeoutMs);
            c.setReadTimeout(timeoutMs * 2);
            if (c.getResponseCode() != 200) return false;
            return readAll(c.getInputStream()).contains("/api/pair/claim");
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** True when the hub at `base` takes this TV's key: the same hub, found at another address. */
    static boolean keyWorks(String base, String token, int timeoutMs) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(base + "/api/tv/status").openConnection();
            c.setConnectTimeout(timeoutMs);
            c.setReadTimeout(timeoutMs * 2);
            c.setRequestProperty("Authorization", "Bearer " + token);
            return c.getResponseCode() == 200;
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /**
     * Looks for LocalHub on this network: every address in the TV's own /24, port 3100, in parallel.
     * Takes a second or two. LocalHub only answers on the LAN once you've turned that on (see tv/README).
     */
    static String scan() {
        List<String> prefixes = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) {
                        String ip = a.getHostAddress();
                        prefixes.add(ip.substring(0, ip.lastIndexOf('.') + 1));
                    }
                }
            }
        } catch (Exception ignored) { }
        if (prefixes.isEmpty()) return null;

        ExecutorService pool = Executors.newFixedThreadPool(48);
        AtomicReference<String> found = new AtomicReference<>();
        for (String prefix : prefixes) {
            for (int i = 1; i < 255; i++) {
                final String base = "http://" + prefix + i + ":" + PORT;
                pool.execute(() -> {
                    if (found.get() == null && looksLikeHub(base, 450)) found.compareAndSet(null, base);
                });
            }
        }
        pool.shutdown();
        try {
            long deadline = System.currentTimeMillis() + 6000;
            while (found.get() == null && !pool.isTerminated() && System.currentTimeMillis() < deadline) {
                pool.awaitTermination(100, TimeUnit.MILLISECONDS);
            }
        } catch (InterruptedException ignored) { }
        pool.shutdownNow();
        return found.get();
    }

    private static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] b = new byte[8192];
        int n;
        int total = 0;
        while ((n = in.read(b)) > 0 && total < 1_000_000) {
            out.write(b, 0, n);
            total += n;
        }
        return out.toString("UTF-8");
    }
}
