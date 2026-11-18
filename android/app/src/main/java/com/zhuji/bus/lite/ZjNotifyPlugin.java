package com.zhuji.bus.lite;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * 到站系统通知：权限查询 / 申请 / 发通知（响铃 + 震动）/ 跳转系统通知设置。
 * 只做「到站提醒」这一件事，不订阅、不常驻后台。
 */
@CapacitorPlugin(
        name = "ZjNotify",
        permissions = {
                @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
        }
)
public class ZjNotifyPlugin extends Plugin {

    private static final String CH_PREFIX = "zjbus_arrive_";

    /* Android 13+ 需要运行时授权；低版本看系统通知总开关 */
    private boolean permGranted() {
        if (Build.VERSION.SDK_INT >= 33) {
            return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    private boolean enabled() {
        try {
            return NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
        } catch (Exception e) {
            return false;
        }
    }

    private JSObject state() {
        boolean perm = permGranted();
        boolean en = enabled();
        boolean granted = perm && en;
        /* 只有「运行时权限还没给、且系统允许再次询问」时才能弹系统框；
           系统级关掉通知（en=false）只能去设置页手动开 */
        boolean canAsk = Build.VERSION.SDK_INT >= 33
                && !perm
                && getPermissionState("notifications") != PermissionState.DENIED;
        JSObject r = new JSObject();
        r.put("granted", granted);
        r.put("enabled", en);
        r.put("canAsk", canAsk);
        return r;
    }

    @PluginMethod
    public void check(PluginCall call) {
        call.resolve(state());
    }

    @PluginMethod
    public void request(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && !permGranted()) {
            requestPermissionForAlias("notifications", call, "onPermResult");
            return;
        }
        call.resolve(state());
    }

    @PermissionCallback
    private void onPermResult(PluginCall call) {
        call.resolve(state());
    }

    @PluginMethod
    public void notify(PluginCall call) {
        String title = call.getString("title", "到站提醒");
        String body = call.getString("body", "");
        boolean sound = Boolean.TRUE.equals(call.getBoolean("sound", Boolean.TRUE));
        boolean vibrate = Boolean.TRUE.equals(call.getBoolean("vibrate", Boolean.TRUE));

        if (!enabled() || !permGranted()) {
            JSObject r = new JSObject();
            r.put("shown", false);
            r.put("reason", "no-permission");
            call.resolve(r);
            return;
        }

        String chId = channelId(sound, vibrate);
        ensureChannel(chId, sound, vibrate);

        Intent open = new Intent(getContext(), MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(getContext(), 0, open, flags);

        NotificationCompat.Builder b = new NotificationCompat.Builder(getContext(), chId)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setAutoCancel(true)
                .setContentIntent(pi);

        if (Build.VERSION.SDK_INT < 26) {
            int def = 0;
            if (sound) def |= Notification.DEFAULT_SOUND;
            if (vibrate) def |= Notification.DEFAULT_VIBRATE;
            b.setDefaults(def);
            if (vibrate) b.setVibrate(new long[]{0, 400, 150, 400, 150, 700});
            if (sound) b.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION));
        }

        try {
            int id = (int) (System.currentTimeMillis() % 100000);
            NotificationManagerCompat.from(getContext()).notify(id, b.build());
            JSObject r = new JSObject();
            r.put("shown", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("通知发送失败：" + e.getMessage());
        }
    }

    private String channelId(boolean sound, boolean vibrate) {
        return CH_PREFIX + (sound ? "s" : "q") + (vibrate ? "v" : "n");
    }

    /* 声音/震动不同的组合用不同 channel（channel 创建后不可改） */
    private void ensureChannel(String id, boolean sound, boolean vibrate) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(id) != null) return;
        NotificationChannel ch = new NotificationChannel(id, "到站提醒", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("车辆到站时响铃与震动");
        ch.setShowBadge(true);
        ch.enableLights(true);
        ch.enableVibration(vibrate);
        if (vibrate) ch.setVibrationPattern(new long[]{0, 400, 150, 400, 150, 700});
        if (sound) {
            Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
            ch.setSound(uri, attrs);
        } else {
            ch.setSound(null, null);
        }
        nm.createNotificationChannel(ch);
    }

    /* 跳转：应用通知设置（老系统退化为应用详情页） */
    @PluginMethod
    public void openSettings(PluginCall call) {
        String pkg = getContext().getPackageName();
        Intent intent = null;
        if (Build.VERSION.SDK_INT >= 26) {
            Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            i.putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
            if (i.resolveActivity(getContext().getPackageManager()) != null) intent = i;
        }
        if (intent == null) {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            i.setData(Uri.parse("package:" + pkg));
            intent = i;
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("无法打开系统设置：" + e.getMessage());
        }
    }
}
