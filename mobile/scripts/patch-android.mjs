// Run after `npx cap add android`: adds permissions, Google sign-in, push channel and release signing.
import fs from "node:fs";
const P = p => new URL("../android/" + p, import.meta.url);
const edit = (p, fn) => { const f = P(p), s = fs.readFileSync(f, "utf8"), n = fn(s); if (n !== s) fs.writeFileSync(f, n); console.log("patched", p); };

// 1) permissions + default notification channel
edit("app/src/main/AndroidManifest.xml", s => {
  const perms = ["android.permission.RECORD_AUDIO", "android.permission.MODIFY_AUDIO_SETTINGS", "android.permission.POST_NOTIFICATIONS",
                 "android.permission.VIBRATE", "android.permission.WAKE_LOCK"];
  for (const p of perms) if (!s.includes(p)) s = s.replace("</manifest>", `    <uses-permission android:name="${p}" />\n</manifest>`);
  if (!s.includes("default_notification_channel_id"))
    s = s.replace("</application>", `        <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="messages" />\n    </application>`);
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
