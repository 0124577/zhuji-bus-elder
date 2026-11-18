package com.zhuji.bus.lite;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

/**
 * 诸暨公交 · 易用版
 * 申请定位权限（Haversine 计算附近站点）与通知权限（到站响铃提醒），无地图 SDK、无后台常驻。
 */
public class MainActivity extends BridgeActivity {

    private static final int REQ_LOCATION = 1001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        /* 本地插件：到站系统通知（权限查询 / 申请 / 发通知 / 跳系统设置） */
        registerPlugin(ZjNotifyPlugin.class);
        super.onCreate(savedInstanceState);
        try {
            WebView webView = getBridge().getWebView();
            if (webView != null) {
                WebSettings s = webView.getSettings();
                s.setJavaScriptEnabled(true);
                s.setDomStorageEnabled(true);
                s.setGeolocationEnabled(true);
            }
        } catch (Exception ignored) {
        }
        requestLocationPermission();
    }

    private void requestLocationPermission() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION
            }, REQ_LOCATION);
        }
    }
}
