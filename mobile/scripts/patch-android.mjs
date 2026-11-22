// Run after `npx cap add android`: adds permissions, Google sign-in, push channel, release signing
// and the "call keeps running in the background" service.
import fs from "node:fs";
const P = p => new URL("../android/" + p, import.meta.url);
const edit = (p, fn) => { const f = P(p), s = fs.readFileSync(f, "utf8"), n = fn(s); if (n !== s) fs.writeFileSync(f, n); console.log("patched", p); };

// 1) permissions + default notification channel
edit("app/src/main/AndroidManifest.xml", s => {
  const perms = ["android.permission.RECORD_AUDIO", "android.permission.MODIFY_AUDIO_SETTINGS", "android.permission.POST_NOTIFICATIONS",
                 "android.permission.VIBRATE", "android.permission.WAKE_LOCK", "android.permission.FOREGROUND_SERVICE",
                 "android.permission.FOREGROUND_SERVICE_MICROPHONE", "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"];
  for (const p of perms) if (!s.includes(p)) s = s.replace("</manifest>", `    <uses-permission android:name="${p}" />\n</manifest>`);
  if (!s.includes("default_notification_channel_id"))
    s = s.replace("</application>", `        <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="messages" />\n    </application>`);
  if (!s.includes(".CallService"))
    s = s.replace("</application>", `        <service android:name=".CallService" android:exported="false" android:foregroundServiceType="microphone|mediaPlayback" />\n    </application>`);
  return s;
});

// 2) native Google sign-in for @capacitor-firebase/authentication
edit("variables.gradle", s => s.includes("rgcfaIncludeGoogle") ? s :
  s.replace(/ext\s*\{/, "ext {\n    rgcfaIncludeGoogle = true\n    androidxCredentialsVersion = '1.3.0'\n    androidxCredentialsPlayServicesAuthVersion = '1.3.0'"));

// 3) release signing from environment variables (set by the GitHub workflow from secrets)
edit("app/build.gradle", s => {
  if (s.includes("FOLKCHAT_KEYSTORE")) return s;
  const signing = `
    signingConfigs {
        release {
            if (System.getenv("FOLKCHAT_KEYSTORE")) {
                storeFile file(System.getenv("FOLKCHAT_KEYSTORE"))
                storePassword System.getenv("FOLKCHAT_KEYSTORE_PASSWORD")
                keyAlias System.getenv("FOLKCHAT_KEY_ALIAS") ?: "folkchat"
                keyPassword System.getenv("FOLKCHAT_KEY_PASSWORD") ?: System.getenv("FOLKCHAT_KEYSTORE_PASSWORD")
            }
        }
    }`;
  s = s.replace(/android\s*\{/, m => m + signing);
  s = s.replace(/buildTypes\s*\{\s*release\s*\{/, m => m + "\n            if (System.getenv(\"FOLKCHAT_KEYSTORE\")) signingConfig signingConfigs.release");
  // version from the workflow run number
  s = s.replace(/versionCode\s+\d+/, 'versionCode ((System.getenv("FOLKCHAT_VERSION_CODE") ?: "1") as Integer)');
  s = s.replace(/versionName\s+"[^"]*"/, 'versionName (System.getenv("FOLKCHAT_VERSION_NAME") ?: "1.0")');
  return s;
});

// 4) keep calls alive when you switch apps: a foreground service (ongoing "in call" notification) that
//    Android requires for using the microphone in the background, plus the FolkCall plugin the site calls.
const JAVA = "app/src/main/java/com/folkchat/app/";
fs.writeFileSync(P(JAVA + "CallService.java"), `package com.folkchat.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

public class CallService extends Service {
    private static final String CHANNEL = "call";
    private PowerManager.WakeLock wake;
    private WifiManager.WifiLock wifi;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent != null && intent.getStringExtra("title") != null ? intent.getStringExtra("title") : "În apel";
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Apel activ", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open != null) open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = open == null ? null : PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_lock_silent_mode_off)
            .setContentTitle(title)
            .setContentText("Apelul merge și când ești în alte aplicații. Atinge ca să revii.")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pi)
            .build();
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                startForeground(7, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE | ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else if (Build.VERSION.SDK_INT >= 29) {
                startForeground(7, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(7, n);
            }
        } catch (Exception e) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (wake == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) { wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "FolkChat:call"); wake.setReferenceCounted(false); wake.acquire(6 * 60 * 60 * 1000L); }
        }
        if (wifi == null) {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) { wifi = wm.createWifiLock(Build.VERSION.SDK_INT >= 29 ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY : WifiManager.WIFI_MODE_FULL_HIGH_PERF, "FolkChat:call"); wifi.setReferenceCounted(false); wifi.acquire(); }
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) { stopSelf(); }

    @Override
    public void onDestroy() {
        if (wake != null && wake.isHeld()) wake.release();
        if (wifi != null && wifi.isHeld()) wifi.release();
        wake = null; wifi = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
`);
fs.writeFileSync(P(JAVA + "CallPlugin.java"), `package com.folkchat.app;

import android.content.Intent;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FolkCall")
public class CallPlugin extends Plugin {
    @PluginMethod
    public void start(PluginCall call) {
        Intent i = new Intent(getContext(), CallService.class);
        i.putExtra("title", call.getString("title", "În apel"));
        try { ContextCompat.startForegroundService(getContext(), i); call.resolve(); }
        catch (Exception e) { call.reject(String.valueOf(e.getMessage())); }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), CallService.class));
        call.resolve();
    }
}
`);
fs.writeFileSync(P(JAVA + "MainActivity.java"), `package com.folkchat.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CallPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`);
console.log("added CallService, CallPlugin, MainActivity");
