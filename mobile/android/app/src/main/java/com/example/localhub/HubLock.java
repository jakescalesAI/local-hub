package com.example.localhub;

import android.app.Activity;
import android.app.Application;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.security.keystore.UserNotAuthenticatedException;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSObject;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Set;
import java.util.WeakHashMap;
import java.util.function.Consumer;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * The biometric lock. With it on, the token exists only as ciphertext, and the Keystore releases the key
 * for one use after a strong biometric check. New biometrics destroy the key, on purpose. Nothing here
 * falls back to the device passcode, and nothing falls back to open: if JS never answers, the cover stays.
 */
final class HubLock implements Application.ActivityLifecycleCallbacks {

    interface Events {
        void locked(boolean foreground);
    }

    private static final String PREFS = "hub_lock";
    private static final String ON = "on";
    private static final String BLOB = "token";
    private static final String KEY_ALIAS = "localhub_lock";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String TRANSFORM = "AES/GCM/NoPadding";
    private static final int IV_BYTES = 12;
    private static final int STRONG = BiometricManager.Authenticators.BIOMETRIC_STRONG;

    private final FragmentActivity main;
    private final SharedPreferences prefs;
    private final Events events;
    private final Set<Activity> alive = Collections.newSetFromMap(new WeakHashMap<>());
    private View cover;
    private int started;
    private boolean changingConfig;
    private boolean needsLock;
    private boolean prompting;

    HubLock(FragmentActivity main, Events events) {
        this.main = main;
        this.events = events;
        prefs = main.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        alive.add(main);
        main.getApplication().registerActivityLifecycleCallbacks(this);
        if (enabled()) {
            needsLock = true;
            setSecure(main, true);
            showCover();
        }
    }

    void destroy() {
        main.getApplication().unregisterActivityLifecycleCallbacks(this);
    }

    private boolean enabled() {
        return prefs.getBoolean(ON, false);
    }

    // --- What JS asks

    void status(Consumer<JSObject> done) {
        main.runOnUiThread(() -> {
            int can = BiometricManager.from(main).canAuthenticate(STRONG);
            JSObject out = new JSObject();
            out.put("enabled", enabled());
            out.put("available", can == BiometricManager.BIOMETRIC_SUCCESS);
            out.put("kind", "biometric");
            if (can == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED) out.put("reason", "notEnrolled");
            else if (can == BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE) out.put("reason", "noHardware");
            else if (can != BiometricManager.BIOMETRIC_SUCCESS) out.put("reason", "unavailable");
            done.accept(out);
        });
    }

    // One prompt, on the encrypting cipher. The marker is only set once the ciphertext is safely stored.
    void enable(String token, Consumer<JSObject> done) {
        main.runOnUiThread(() -> {
            Cipher cipher;
            try {
                KeyStore store = keyStore();
                store.deleteEntry(KEY_ALIAS);
                cipher = Cipher.getInstance(TRANSFORM);
                cipher.init(Cipher.ENCRYPT_MODE, newKey());
            } catch (Exception e) {
                done.accept(result("unavailable"));
                return;
            }
            prompt("Turn on the lock", cipher, (ok, failure) -> {
                if (ok == null) {
                    deleteKey();
                    done.accept(result(failure));
                    return;
                }
                try {
                    byte[] sealed = ok.doFinal(token.getBytes(StandardCharsets.UTF_8));
                    byte[] iv = ok.getIV();
                    byte[] blob = Arrays.copyOf(iv, iv.length + sealed.length);
                    System.arraycopy(sealed, 0, blob, iv.length, sealed.length);
                    boolean saved = prefs.edit()
                        .putString(BLOB, Base64.encodeToString(blob, Base64.NO_WRAP))
                        .putBoolean(ON, true)
                        .commit();
                    if (!saved) throw new IllegalStateException();
                    secureAll(true);
                    done.accept(result("enabled"));
                } catch (Exception e) {
                    clearStored();
                    done.accept(result("unavailable"));
                }
            });
        });
    }

    void unlock(Consumer<JSObject> done) {
        main.runOnUiThread(() -> {
            String stored = prefs.getString(BLOB, null);
            if (!enabled() || stored == null) {
                done.accept(result("changed"));
                return;
            }
            int can = BiometricManager.from(main).canAuthenticate(STRONG);
            if (can == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED) {
                done.accept(result("changed"));
                return;
            }
            if (can != BiometricManager.BIOMETRIC_SUCCESS) {
                done.accept(result("unavailable"));
                return;
            }
            byte[] blob;
            Cipher cipher;
            try {
                blob = Base64.decode(stored, Base64.NO_WRAP);
                SecretKey key = (SecretKey) keyStore().getKey(KEY_ALIAS, null);
                if (key == null || blob.length <= IV_BYTES) {
                    done.accept(result("changed"));
                    return;
                }
                cipher = Cipher.getInstance(TRANSFORM);
                cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, blob, 0, IV_BYTES));
            } catch (KeyPermanentlyInvalidatedException e) {
                done.accept(result("changed"));
                return;
            } catch (UserNotAuthenticatedException e) {
                done.accept(result("unavailable"));
                return;
            } catch (Exception e) {
                done.accept(result("unavailable"));
                return;
            }
            prompt("Unlock Local Hub", cipher, (ok, failure) -> {
                if (ok == null) {
                    done.accept(result(failure));
                    return;
                }
                try {
                    byte[] plain = ok.doFinal(blob, IV_BYTES, blob.length - IV_BYTES);
                    JSObject out = new JSObject();
                    out.put("token", new String(plain, StandardCharsets.UTF_8));
                    done.accept(out);
                } catch (javax.crypto.AEADBadTagException e) {
                    done.accept(result("changed"));
                } catch (Exception e) {
                    done.accept(result("unavailable"));
                }
            });
        });
    }

    void clear(Runnable done) {
        main.runOnUiThread(() -> {
            clearStored();
            needsLock = false;
            hideCover();
            secureAll(false);
            done.run();
        });
    }

    // JS has drawn its lock screen, so the cover can go. Only in the foreground, and only then.
    void shown(Consumer<JSObject> done) {
        main.runOnUiThread(() -> {
            boolean active = started > 0;
            if (active && needsLock) {
                needsLock = false;
                hideCover();
            }
            JSObject out = new JSObject();
            out.put("active", active);
            done.accept(out);
        });
    }

    // --- Storage

    private void clearStored() {
        prefs.edit().clear().commit();
        deleteKey();
    }

    private void deleteKey() {
        try {
            keyStore().deleteEntry(KEY_ALIAS);
        } catch (Exception ignored) {
            // Without the stored ciphertext the key opens nothing.
        }
    }

    private static KeyStore keyStore() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        return store;
    }

    private static SecretKey newKey() throws Exception {
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true);
        // Every use needs its own check. Below Android 11 that's the default for an authenticated key.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(spec.build());
        return generator.generateKey();
    }

    // --- The prompt

    private interface Answer {
        void done(Cipher unlocked, String failure);
    }

    private void prompt(String title, Cipher cipher, Answer answer) {
        // BiometricPrompt silently does nothing once state is saved, which would leave JS waiting.
        if (prompting || started == 0 || main.getSupportFragmentManager().isStateSaved()) {
            answer.done(null, "cancelled");
            return;
        }
        prompting = true;
        BiometricPrompt prompt = new BiometricPrompt(main, ContextCompat.getMainExecutor(main), new BiometricPrompt.AuthenticationCallback() {
            @Override
            public void onAuthenticationError(int code, @NonNull CharSequence message) {
                prompting = false;
                answer.done(null, failureFor(code));
            }

            @Override
            public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                prompting = false;
                BiometricPrompt.CryptoObject crypto = result.getCryptoObject();
                Cipher unlocked = crypto == null ? null : crypto.getCipher();
                answer.done(unlocked, unlocked == null ? "unavailable" : null);
            }
        });
        BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setNegativeButtonText("Cancel")
            .setAllowedAuthenticators(STRONG)
            .setConfirmationRequired(false)
            .build();
        prompt.authenticate(info, new BiometricPrompt.CryptoObject(cipher));
    }

    private static String failureFor(int code) {
        switch (code) {
            case BiometricPrompt.ERROR_USER_CANCELED:
            case BiometricPrompt.ERROR_NEGATIVE_BUTTON:
            case BiometricPrompt.ERROR_CANCELED:
            case BiometricPrompt.ERROR_TIMEOUT:
                return "cancelled";
            case BiometricPrompt.ERROR_LOCKOUT:
            case BiometricPrompt.ERROR_LOCKOUT_PERMANENT:
                return "lockedOut";
            case BiometricPrompt.ERROR_NO_BIOMETRICS:
                return "changed";
            default:
                return "unavailable";
        }
    }

    private static JSObject result(String name) {
        JSObject out = new JSObject();
        out.put(name, true);
        return out;
    }

    // --- Leaving and coming back. Any other activity on top counts as still here, so activities are
    // counted rather than trusting the app's own pause and resume.

    private void wentToBackground() {
        if (!enabled()) return;
        needsLock = true;
        showCover();
        for (Activity activity : new ArrayList<>(alive)) {
            if (activity != main && !activity.isFinishing()) activity.finish();
        }
        CookieManager cookies = CookieManager.getInstance();
        cookies.removeAllCookies(done -> cookies.flush());
        events.locked(false);
    }

    private void cameToForeground() {
        if (!needsLock) return;
        showCover();
        events.locked(true);
    }

    @Override
    public void onActivityCreated(@NonNull Activity activity, Bundle state) {
        alive.add(activity);
        if (enabled()) setSecure(activity, true);
    }

    @Override
    public void onActivityStarted(@NonNull Activity activity) {
        if (changingConfig) {
            changingConfig = false;
            return;
        }
        if (++started == 1) cameToForeground();
    }

    @Override
    public void onActivityStopped(@NonNull Activity activity) {
        if (activity.isChangingConfigurations()) {
            changingConfig = true;
            return;
        }
        started = Math.max(0, started - 1);
        if (started == 0) wentToBackground();
    }

    @Override
    public void onActivityResumed(@NonNull Activity activity) {}

    @Override
    public void onActivityPaused(@NonNull Activity activity) {}

    @Override
    public void onActivitySaveInstanceState(@NonNull Activity activity, @NonNull Bundle state) {}

    @Override
    public void onActivityDestroyed(@NonNull Activity activity) {
        alive.remove(activity);
    }

    // --- What shows

    private void secureAll(boolean on) {
        for (Activity activity : new ArrayList<>(alive)) setSecure(activity, on);
    }

    // Keeps the app switcher's preview and screenshots blank.
    private static void setSecure(Activity activity, boolean on) {
        if (on) activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        else activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }

    private void showCover() {
        if (cover != null) return;
        ViewGroup content = main.findViewById(android.R.id.content);
        if (content == null) return;
        cover = new View(main);
        boolean night = (main.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        cover.setBackgroundColor(night ? Color.BLACK : Color.WHITE);
        cover.setClickable(true);
        cover.setFocusable(true);
        cover.setElevation(10000f);
        content.addView(cover, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void hideCover() {
        if (cover == null) return;
        ((ViewGroup) cover.getParent()).removeView(cover);
        cover = null;
    }
}
