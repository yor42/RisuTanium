package io.github.yor42.tbdriver;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Test-only accessibility service. Gestures go through dispatchGesture, which the framework feeds into the
 * accessibility input filter ahead of touch exploration, so TalkBack sees them as touch input.
 */
public class DriverService extends AccessibilityService {
    private final Handler main = new Handler(Looper.getMainLooper());

    @Override
    protected void onServiceConnected() {
        Hub.service = this;
        Hub.startServer();
        Hub.record("svc", "\"msg\":\"connected\"");
        Log.i(Hub.TAG, "service connected");
    }

    @Override
    public boolean onUnbind(android.content.Intent intent) {
        Hub.record("svc", "\"msg\":\"unbind\"");
        if (Hub.service == this) Hub.service = null;
        return super.onUnbind(intent);
    }

    @Override
    public void onInterrupt() {
        Hub.record("svc", "\"msg\":\"interrupt\"");
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent e) {
        StringBuilder sb = new StringBuilder();
        sb.append("\"type\":").append(Hub.q(AccessibilityEvent.eventTypeToString(e.getEventType())));
        sb.append(",\"pkg\":").append(Hub.q(e.getPackageName()));
        sb.append(",\"cls\":").append(Hub.q(e.getClassName()));
        sb.append(",\"win\":").append(e.getWindowId());
        List<CharSequence> txt = e.getText();
        if (txt != null && !txt.isEmpty()) sb.append(",\"text\":").append(Hub.q(String.join(" | ", txt)));
        if (e.getContentDescription() != null) sb.append(",\"desc\":").append(Hub.q(e.getContentDescription()));
        int t = e.getEventType();
        if (t == AccessibilityEvent.TYPE_VIEW_ACCESSIBILITY_FOCUSED || t == AccessibilityEvent.TYPE_VIEW_CLICKED
                || t == AccessibilityEvent.TYPE_VIEW_FOCUSED || t == AccessibilityEvent.TYPE_VIEW_SCROLLED) {
            AccessibilityNodeInfo src = e.getSource();
            if (src != null) {
                sb.append(",\"node\":").append(node(src));
                src.recycle();
            }
        }
        Hub.record("event", sb.toString());
    }

    static String node(AccessibilityNodeInfo n) {
        if (n == null) return "null";
        Rect r = new Rect();
        n.getBoundsInScreen(r);
        return "{\"cls\":" + Hub.q(n.getClassName()) + ",\"text\":" + Hub.q(n.getText()) + ",\"desc\":" + Hub.q(n.getContentDescription())
                + ",\"id\":" + Hub.q(n.getViewIdResourceName()) + ",\"pkg\":" + Hub.q(n.getPackageName())
                + ",\"bounds\":[" + r.left + "," + r.top + "," + r.right + "," + r.bottom + "]"
                + ",\"win\":" + n.getWindowId() + ",\"a11yFocused\":" + n.isAccessibilityFocused() + ",\"focused\":" + n.isFocused()
                + ",\"clickable\":" + n.isClickable() + ",\"visible\":" + n.isVisibleToUser() + ",\"children\":" + n.getChildCount() + "}";
    }

    String command(String path, Map<String, String> qs) throws Exception {
        switch (path) {
            case "/focus": {
                AccessibilityNodeInfo a = findFocus(AccessibilityNodeInfo.FOCUS_ACCESSIBILITY);
                AccessibilityNodeInfo i = findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
                return "{\"a11y\":" + node(a) + ",\"input\":" + node(i) + "}";
            }
            case "/tree": return tree(Integer.parseInt(qs.getOrDefault("max", "400")));
            case "/find": return find(qs.get("text"));
            case "/tap": {
                float x = f(qs, "x"), y = f(qs, "y");
                Path p = new Path(); p.moveTo(x, y);
                return gesture(new GestureDescription.Builder().addStroke(new GestureDescription.StrokeDescription(p, 0, l(qs, "ms", 40))).build());
            }
            case "/taps": {
                // n taps at one point: separate strokes in one gesture, so the timing does not depend on adb latency.
                float x = f(qs, "x"), y = f(qs, "y");
                int n = (int) l(qs, "n", 2);
                long ms = l(qs, "ms", 40), gap = l(qs, "gap", 100);
                GestureDescription.Builder b = new GestureDescription.Builder();
                for (int k = 0; k < n; k++) {
                    Path p = new Path(); p.moveTo(x, y);
                    b.addStroke(new GestureDescription.StrokeDescription(p, k * (ms + gap), ms));
                }
                return gesture(b.build());
            }
            case "/swipe": {
                Path p = new Path(); p.moveTo(f(qs, "x1"), f(qs, "y1")); p.lineTo(f(qs, "x2"), f(qs, "y2"));
                return gesture(new GestureDescription.Builder().addStroke(new GestureDescription.StrokeDescription(p, l(qs, "delay", 0), l(qs, "ms", 200))).build());
            }
            case "/path": {
                // pts=x,y_x,y_x,y : one stroke through every point (L-shaped and back-and-forth gestures).
                String[] pts = qs.get("pts").split("_");
                Path p = new Path();
                for (int k = 0; k < pts.length; k++) {
                    String[] xy = pts[k].split(",");
                    if (k == 0) p.moveTo(Float.parseFloat(xy[0]), Float.parseFloat(xy[1]));
                    else p.lineTo(Float.parseFloat(xy[0]), Float.parseFloat(xy[1]));
                }
                return gesture(new GestureDescription.Builder().addStroke(new GestureDescription.StrokeDescription(p, 0, l(qs, "ms", 300))).build());
            }
            case "/fingers": {
                // n parallel fingers from (x,y) spaced by `space` px horizontally, each moving by (dx,dy).
                int n = (int) l(qs, "n", 2);
                float x = f(qs, "x"), y = f(qs, "y"), dx = f(qs, "dx"), dy = f(qs, "dy"), sp = qs.containsKey("space") ? f(qs, "space") : 150f;
                GestureDescription.Builder b = new GestureDescription.Builder();
                for (int k = 0; k < n; k++) {
                    Path p = new Path(); p.moveTo(x + k * sp, y); p.lineTo(x + k * sp + dx, y + dy);
                    b.addStroke(new GestureDescription.StrokeDescription(p, 0, l(qs, "ms", 300)));
                }
                return gesture(b.build());
            }
            case "/global": {
                int a;
                switch (qs.getOrDefault("a", "")) {
                    case "back": a = GLOBAL_ACTION_BACK; break;
                    case "home": a = GLOBAL_ACTION_HOME; break;
                    case "recents": a = GLOBAL_ACTION_RECENTS; break;
                    case "notifications": a = GLOBAL_ACTION_NOTIFICATIONS; break;
                    default: return "{\"error\":\"unknown global action\"}";
                }
                return "{\"ok\":" + performGlobalAction(a) + "}";
            }
            case "/act": {
                // Direct accessibility action on the accessibility-focused node: a bypass, not a TalkBack gesture.
                AccessibilityNodeInfo a = findFocus(AccessibilityNodeInfo.FOCUS_ACCESSIBILITY);
                if (a == null) return "{\"error\":\"no accessibility focus\"}";
                int act;
                switch (qs.getOrDefault("a", "click")) {
                    case "click": act = AccessibilityNodeInfo.ACTION_CLICK; break;
                    case "longclick": act = AccessibilityNodeInfo.ACTION_LONG_CLICK; break;
                    case "forward": act = AccessibilityNodeInfo.ACTION_SCROLL_FORWARD; break;
                    case "backward": act = AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD; break;
                    default: return "{\"error\":\"unknown action\"}";
                }
                return "{\"ok\":" + a.performAction(act) + ",\"node\":" + node(a) + "}";
            }
            default: return "{\"error\":\"unknown path\"}";
        }
    }

    private static float f(Map<String, String> qs, String k) { return Float.parseFloat(qs.get(k)); }
    private static long l(Map<String, String> qs, String k, long d) { return qs.containsKey(k) ? Long.parseLong(qs.get(k)) : d; }

    private String gesture(GestureDescription g) throws InterruptedException {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> res = new AtomicReference<>("timeout");
        AtomicReference<Boolean> accepted = new AtomicReference<>(false);
        long seqBefore = Hub.lastSeq();
        main.post(() -> accepted.set(dispatchGesture(g, new GestureResultCallback() {
            @Override public void onCompleted(GestureDescription d) { res.set("completed"); done.countDown(); }
            @Override public void onCancelled(GestureDescription d) { res.set("cancelled"); done.countDown(); }
        }, main)));
        boolean ok = done.await(15000,TimeUnit.MILLISECONDS);
        Hub.record("gesture", "\"result\":" + Hub.q(res.get()));
        return "{\"accepted\":" + accepted.get() + ",\"result\":" + Hub.q(res.get()) + ",\"waited\":" + ok + ",\"seqBefore\":" + seqBefore + "}";
    }

    private String find(String text) {
        StringBuilder sb = new StringBuilder("{\"matches\":[");
        boolean first = true;
        for (AccessibilityWindowInfo w : getWindows()) {
            AccessibilityNodeInfo root = w.getRoot();
            if (root == null) continue;
            List<AccessibilityNodeInfo> hits = root.findAccessibilityNodeInfosByText(text);
            for (AccessibilityNodeInfo h : hits) {
                if (!first) sb.append(',');
                sb.append('\n').append(node(h));
                first = false;
            }
        }
        return sb.append("]}").toString();
    }

    private String tree(int max) {
        StringBuilder sb = new StringBuilder("{\"windows\":[");
        int[] count = {0};
        boolean firstW = true;
        for (AccessibilityWindowInfo w : getWindows()) {
            if (!firstW) sb.append(',');
            firstW = false;
            Rect r = new Rect();
            w.getBoundsInScreen(r);
            sb.append("\n{\"id\":").append(w.getId()).append(",\"type\":").append(w.getType()).append(",\"title\":").append(Hub.q(w.getTitle()))
                    .append(",\"active\":").append(w.isActive()).append(",\"focused\":").append(w.isFocused())
                    .append(",\"a11yFocused\":").append(w.isAccessibilityFocused())
                    .append(",\"bounds\":[").append(r.left).append(',').append(r.top).append(',').append(r.right).append(',').append(r.bottom).append("],\"nodes\":[");
            walk(w.getRoot(), 0, sb, count, max, new boolean[]{true});
            sb.append("]}");
        }
        return sb.append("],\"count\":").append(count[0]).append('}').toString();
    }

    private void walk(AccessibilityNodeInfo n, int depth, StringBuilder sb, int[] count, int max, boolean[] first) {
        if (n == null || count[0] >= max) return;
        count[0]++;
        if (!first[0]) sb.append(',');
        first[0] = false;
        String d = node(n);
        sb.append("\n{\"d\":").append(depth).append(',').append(d.substring(1));
        for (int k = 0; k < n.getChildCount(); k++) walk(n.getChild(k), depth + 1, sb, count, max, first);
    }
}
