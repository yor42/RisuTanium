package io.github.yor42.tbdriver;

import android.app.Activity;
import android.os.Bundle;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Synthetic target screen: a few native controls with a visible and announced click result. */
public class TestActivity extends Activity {
    private int clicks = 0;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Hub.startServer();
        ScrollView sv = new ScrollView(this);
        LinearLayout ll = new LinearLayout(this);
        ll.setOrientation(LinearLayout.VERTICAL);
        ll.setPadding(48, 96, 48, 48);
        sv.addView(ll);
        TextView title = new TextView(this);
        title.setText("Driver test screen");
        title.setTextSize(24);
        ll.addView(title);
        TextView status = new TextView(this);
        status.setText("Last action: none");
        status.setTextSize(18);
        status.setAccessibilityLiveRegion(TextView.ACCESSIBILITY_LIVE_REGION_POLITE);
        for (String name : new String[]{"Alpha", "Beta", "Gamma"}) {
            Button btn = new Button(this);
            btn.setText(name);
            btn.setOnClickListener(v -> {
                clicks++;
                status.setText("Last action: " + name + " #" + clicks);
                Hub.record("app", "\"clicked\":" + Hub.q(name));
            });
            ll.addView(btn);
        }
        CheckBox cb = new CheckBox(this);
        cb.setText("Delta option");
        cb.setOnCheckedChangeListener((v, on) -> Hub.record("app", "\"checked\":" + on));
        ll.addView(cb);
        ll.addView(status);
        for (int k = 1; k <= 30; k++) {
            TextView row = new TextView(this);
            row.setText("Row " + k);
            row.setTextSize(20);
            row.setPadding(0, 24, 0, 24);
            ll.addView(row);
        }
        setContentView(sv);
    }
}
