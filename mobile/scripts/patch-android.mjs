// Run after `npx cap add android`: adds permissions, Google sign-in, push channel, release signing
// and the "call keeps running in the background" service.
import fs from "node:fs";
const P = p => new URL("../android/" + p, import.meta.url);
const edit = (p, fn) => { const f = P(p), s = fs.readFileSync(f, "utf8"), n = fn(s); if (n !== s) fs.writeFileSync(f, n); console.log("patched", p); };

// 1) permissions + default notification channel
edit("app/src/main/AndroidManifest.xml", s => {
  const perms = ["android.permission.RECORD_AUDIO", "android.permission.MODIFY_AUDIO_SETTINGS", "android.permission.POST_NOTIFICATIONS",
                 "android.permission.VIBRATE", "android.permission.WAKE_LOCK", "android.permission.FOREGROUND_SERVICE",
                 "android.permission.FOREGROUND_SERVICE_MICROPHONE", "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
                 "android.permission.USE_FULL_SCREEN_INTENT"];
  for (const p of perms) if (!s.includes(p)) s = s.replace("</manifest>", `    <uses-permission android:name="${p}" />\n</manifest>`);
  if (!s.includes("default_notification_channel_id"))
    s = s.replace("</application>", `        <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="messages" />\n    </application>`);
  if (!s.includes("xmlns:tools")) s = s.replace("<manifest ", '<manifest xmlns:tools="http://schemas.android.com/tools" ');
  if (!s.includes(".FolkMessagingService"))
    s = s.replace("</application>", `        <service android:name="com.capacitorjs.plugins.pushnotifications.MessagingService" tools:node="remove" />
        <service android:name=".FolkMessagingService" android:exported="false">
            <intent-filter><action android:name="com.google.firebase.MESSAGING_EVENT" /></intent-filter>
        </service>
        <receiver android:name=".CallActionReceiver" android:exported="false" />\n    </application>`);
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
  if (!s.includes("firebase-messaging")) s = s.replace(/dependencies\s*\{/, m => m + '\n    implementation "com.google.firebase:firebase-messaging:25.0.1"');
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

    /** What the user tapped on the incoming-call screen ("answer" / "open"), once. */
    @PluginMethod
    public void takeAction(PluginCall call) {
        com.getcapacitor.JSObject r = new com.getcapacitor.JSObject();
        String a = MainActivity.pendingAction, cid = MainActivity.pendingCid;
        MainActivity.pendingAction = null; MainActivity.pendingCid = null;
        if (a != null) { r.put("action", a); r.put("cid", cid); }
        call.resolve(r);
    }

    @PluginMethod
    public void cancelRing(PluginCall call) {
        CallRinger.cancel(getContext());
        call.resolve();
    }
}
`);
fs.writeFileSync(P(JAVA + "MainActivity.java"), `package com.folkchat.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    public static volatile boolean visible = false;
    public static volatile String pendingAction = null, pendingCid = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CallPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        String a = intent == null ? null : intent.getStringExtra("fc_action");
        if (a == null) return;
        pendingAction = a;
        pendingCid = intent.getStringExtra("fc_cid");
        intent.removeExtra("fc_action");
        CallRinger.cancel(this);
        if (android.os.Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true); }
        if (bridge != null) bridge.triggerWindowJSEvent("folkcall");
    }

    @Override
    public void onResume() { super.onResume(); visible = true; }

    @Override
    public void onPause() { super.onPause(); visible = false; }
}
`);
console.log("added CallService, CallPlugin, MainActivity");

// 5) calls ring like phone calls: data-only "call" pushes become a full-screen incoming-call notification
//    (Answer / Decline, rings with the phone's ringtone, shows on the lock screen).
fs.writeFileSync(P(JAVA + "FolkMessagingService.java"), `package com.folkchat.app;

import androidx.annotation.NonNull;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public class FolkMessagingService extends com.capacitorjs.plugins.pushnotifications.MessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage m) {
        Map<String, String> d = m.getData();
        if ("call".equals(d.get("type")) && m.getNotification() == null && !MainActivity.visible) {
            try { CallRinger.show(this, d.get("cid"), d.get("from")); } catch (Exception e) { }
        }
        super.onMessageReceived(m);
    }
}
`);
fs.writeFileSync(P(JAVA + "CallRinger.java"), `package com.folkchat.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;

public class CallRinger {
    static final int ID = 4242;
    static final String CHANNEL = "calls_ring";

    public static void show(Context ctx, String cid, String from) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (from == null || from.isEmpty()) from = "Cineva";
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Apeluri (sună ca un telefon)", NotificationManager.IMPORTANCE_HIGH);
            ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
            ch.enableVibration(true);
            ch.setVibrationPattern(new long[] { 0, 900, 700, 900, 700, 900 });
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }
        int fl = PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT;
        Intent open = new Intent(ctx, MainActivity.class).putExtra("fc_action", "open").putExtra("fc_cid", cid)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        Intent ans = new Intent(ctx, MainActivity.class).putExtra("fc_action", "answer").putExtra("fc_cid", cid)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        Intent dec = new Intent(ctx, CallActionReceiver.class).setAction("com.folkchat.app.DECLINE").putExtra("fc_cid", cid);
        PendingIntent pOpen = PendingIntent.getActivity(ctx, 41, open, fl);
        PendingIntent pAns = PendingIntent.getActivity(ctx, 42, ans, fl);
        PendingIntent pDec = PendingIntent.getBroadcast(ctx, 43, dec, fl);
        Person caller = new Person.Builder().setName(from).setImportant(true).build();
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.sym_call_incoming)
            .setContentTitle(from + " te sună")
            .setContentText("Apel FolkChat")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))
            .setOngoing(true)
            .setAutoCancel(true)
            .setTimeoutAfter(35000)
            .setContentIntent(pOpen)
            .setFullScreenIntent(pOpen, true);
        try {
            b.setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, pDec, pAns));
        } catch (Exception e) {
            b.addAction(0, "Respinge", pDec).addAction(0, "Răspunde", pAns);
        }
        Notification n = b.build();
        n.flags |= Notification.FLAG_INSISTENT;   // keep ringing until answered / declined / timed out
        nm.notify(ID, n);
    }

    public static void cancel(Context ctx) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(ID);
    }
}
`);
fs.writeFileSync(P(JAVA + "CallActionReceiver.java"), `package com.folkchat.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** "Respinge" on the incoming-call screen: stop ringing (the caller's side gives up after 30 s). */
public class CallActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        CallRinger.cancel(ctx);
    }
}
`);
console.log("added FolkMessagingService, CallRinger, CallActionReceiver");
