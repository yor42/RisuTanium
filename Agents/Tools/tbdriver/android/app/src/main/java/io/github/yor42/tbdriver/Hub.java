package io.github.yor42.tbdriver;

import android.os.SystemClock;
import android.util.Log;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Map;

/** Process-wide record of accessibility events and captured speech, plus the loopback HTTP control server. */
final class Hub {
    static final String TAG = "tbdriver";
    static final int PORT = 9562;
    private static final int MAX = 4000;
    private static final ArrayDeque<String[]> log = new ArrayDeque<>();
    private static long seq = 0;
    static volatile DriverService service;
    private static boolean started = false;

    static synchronized long record(String kind, String json) {
        seq++;
        log.addLast(new String[]{Long.toString(seq), "{\"seq\":" + seq + ",\"t\":" + SystemClock.uptimeMillis() + ",\"kind\":\"" + kind + "\"," + json + "}"});
        while (log.size() > MAX) log.removeFirst();
        return seq;
    }

    static synchronized long lastSeq() { return seq; }

    static synchronized String since(long after, String kindFilter) {
        StringBuilder sb = new StringBuilder("{\"last\":").append(seq).append(",\"items\":[");
        boolean first = true;
        for (String[] e : log) {
            if (Long.parseLong(e[0]) <= after) continue;
            if (kindFilter != null && !e[1].contains("\"kind\":\"" + kindFilter + "\"")) continue;
            if (!first) sb.append(',');
            sb.append('\n').append(e[1]);
            first = false;
        }
        return sb.append("]}").toString();
    }

    static String q(CharSequence s) {
        if (s == null) return "null";
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (c < 0x20) sb.append(String.format("\\u%04x", (int) c));
                    else sb.append(c);
            }
        }
        return sb.append('"').toString();
    }

    static synchronized void startServer() {
        if (started) return;
        started = true;
        Thread t = new Thread(() -> {
            try (ServerSocket ss = new ServerSocket(PORT, 8, InetAddress.getByName("127.0.0.1"))) {
                Log.i(TAG, "listening on " + PORT);
                while (true) {
                    Socket s = ss.accept();
                    new Thread(() -> handle(s)).start();
                }
            } catch (Exception e) {
                Log.e(TAG, "server", e);
                synchronized (Hub.class) { started = false; }
            }
        }, "tbdriver-http");
        t.setDaemon(true);
        t.start();
    }

    private static void handle(Socket s) {
        try (Socket sock = s) {
            BufferedReader in = new BufferedReader(new InputStreamReader(sock.getInputStream(), StandardCharsets.UTF_8));
            String line = in.readLine();
            if (line == null) return;
            while (true) { String h = in.readLine(); if (h == null || h.isEmpty()) break; }
            String[] parts = line.split(" ");
            String target = parts.length > 1 ? parts[1] : "/";
            String path = target;
            Map<String, String> qs = new HashMap<>();
            int qi = target.indexOf('?');
            if (qi >= 0) {
                path = target.substring(0, qi);
                for (String kv : target.substring(qi + 1).split("&")) {
                    int eq = kv.indexOf('=');
                    if (eq < 0) qs.put(URLDecoder.decode(kv, "UTF-8"), "");
                    else qs.put(URLDecoder.decode(kv.substring(0, eq), "UTF-8"), URLDecoder.decode(kv.substring(eq + 1), "UTF-8"));
                }
            }
            String body;
            int code = 200;
            try {
                body = route(path, qs);
            } catch (Exception e) {
                code = 500;
                body = "{\"error\":" + q(e.toString()) + "}";
            }
            byte[] out = body.getBytes(StandardCharsets.UTF_8);
            OutputStream os = sock.getOutputStream();
            os.write(("HTTP/1.0 " + code + " OK\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: " + out.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            os.write(out);
            os.flush();
        } catch (Exception e) {
            Log.e(TAG, "handle", e);
        }
    }

    private static String route(String path, Map<String, String> qs) throws Exception {
        if (path.equals("/ping")) return "{\"ok\":true,\"service\":" + (service != null) + ",\"last\":" + lastSeq() + "}";
        if (path.equals("/events")) return since(Long.parseLong(qs.getOrDefault("since", "0")), qs.get("kind"));
        DriverService svc = service;
        if (svc == null) return "{\"error\":\"accessibility service not bound\"}";
        return svc.command(path, qs);
    }
}
