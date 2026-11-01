package com.example.localhub;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HubNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
