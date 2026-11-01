package com.example.localhub;

import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.zxing.client.android.Intents;
import com.journeyapps.barcodescanner.ScanIntentResult;
import com.journeyapps.barcodescanner.ScanOptions;

/**
 * QR scanning with ZXing, which runs on the device and reports to nobody, and text arriving from the
 * system share sheet. Shared text only fills in a composer: nothing is sent until the person says so.
 */
@CapacitorPlugin(name = "HubNative")
public class HubNativePlugin extends Plugin {

    private static final int MAX_SHARE_CHARS = 8000;
    private String pendingShare;

    @Override
    public void load() {
        Intent intent = getActivity().getIntent();
        pendingShare = shareText(intent);
        if (pendingShare != null) consume(intent);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        String text = shareText(intent);
        if (text == null) return;
        consume(intent);
        if (hasListeners("share")) {
            JSObject event = new JSObject();
            event.put("text", text);
            notifyListeners("share", event);
        } else {
            pendingShare = text;
        }
    }

    @PluginMethod
    public void takeShare(PluginCall call) {
        JSObject result = new JSObject();
        if (pendingShare != null) result.put("text", pendingShare);
        pendingShare = null;
        call.resolve(result);
    }

    @PluginMethod
    public void scanQr(PluginCall call) {
        ScanOptions options = new ScanOptions()
            .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            .setPrompt("Point at the code on your computer")
            .setBeepEnabled(false)
            .setOrientationLocked(false);
        startActivityForResult(call, options.createScanIntent(getContext()), "onScanResult");
    }

    @ActivityCallback
    private void onScanResult(PluginCall call, ActivityResult activityResult) {
        if (call == null) return;
        ScanIntentResult result = ScanIntentResult.parseActivityResult(activityResult.getResultCode(), activityResult.getData());
        JSObject out = new JSObject();
        Intent original = result.getOriginalIntent();
        if (result.getContents() != null) out.put("text", result.getContents());
        else if (original != null && original.hasExtra(Intents.Scan.MISSING_CAMERA_PERMISSION)) out.put("error", "Camera access is off. Turn it on in Settings, or enter the address and code by hand.");
        else out.put("cancelled", true);
        call.resolve(out);
    }

    private static String shareText(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return null;
        String type = intent.getType();
        if (type == null || !type.startsWith("text/")) return null;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null || text.trim().isEmpty()) return null;
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        String full = subject != null && !subject.trim().isEmpty() && !text.contains(subject) ? subject.trim() + "\n\n" + text : text;
        return full.length() > MAX_SHARE_CHARS ? full.substring(0, MAX_SHARE_CHARS) : full;
    }

    // Rotating the phone recreates the activity with the same intent; it must not share twice.
    private static void consume(Intent intent) {
        intent.setAction(Intent.ACTION_MAIN);
        intent.removeExtra(Intent.EXTRA_TEXT);
        intent.removeExtra(Intent.EXTRA_SUBJECT);
    }
}
