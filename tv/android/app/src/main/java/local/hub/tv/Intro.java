package local.hub.tv;

import android.content.res.AssetFileDescriptor;
import android.graphics.Color;
import android.graphics.SurfaceTexture;
import android.media.MediaPlayer;
import android.view.Surface;
import android.view.TextureView;
import android.widget.FrameLayout;

/**
 * LocalHub's opening on a fresh start: trylocalhub.com's glass house and the wordmark, as one short video (tv/ui/intro.mp4,
 * in the app), over the page while it loads. The TV decodes it, so a busy page can't make it stutter. It fades once it
 * has played and the home screen is drawn, 9 seconds at most. Any button skips to the home screen.
 */
final class Intro extends FrameLayout implements TextureView.SurfaceTextureListener {
    private final MainActivity activity;
    private MediaPlayer player;
    private final long began = android.os.SystemClock.uptimeMillis();
    private boolean played, drawn, gone;

    private void note(String what) { android.util.Log.i("LocalHub", "intro " + what + " " + (android.os.SystemClock.uptimeMillis() - began) + " ms"); }

    Intro(MainActivity activity) {
        super(activity);
        this.activity = activity;
        setBackgroundColor(Color.BLACK);
        TextureView v = new TextureView(activity);
        v.setSurfaceTextureListener(this);
        addView(v, new LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
        postDelayed(this::end, 9000);
    }

    boolean showing() { return !gone; }

    /** The page's home screen is there. */
    void drawn() {
        if (!drawn) note("home drawn");
        drawn = true;
        maybe();
    }

    void skip() {
        played = true;
        maybe();
    }

    private void maybe() {
        if (played && drawn) end();
    }

    private void end() {
        if (gone) return;
        gone = true;
        note("gone");
        animate().alpha(0f).scaleX(1.05f).scaleY(1.05f).setDuration(650).setInterpolator(new android.view.animation.DecelerateInterpolator(1.6f)).withLayer().withEndAction(() -> {
            release();
            activity.introDone(this);
        }).start();
    }

    void release() {
        if (player == null) return;
        try { player.release(); } catch (Exception ignored) { }
        player = null;
    }

    @Override
    public void onSurfaceTextureAvailable(SurfaceTexture texture, int width, int height) {
        try (AssetFileDescriptor f = activity.getAssets().openFd("ui/intro.mp4")) {
            MediaPlayer p = player = new MediaPlayer();
            p.setDataSource(f.getFileDescriptor(), f.getStartOffset(), f.getLength());
            p.setSurface(new Surface(texture));
            p.setVolume(0, 0);
            p.setOnPreparedListener(m -> { m.start(); note("started"); });
            p.setOnCompletionListener(m -> { note("played"); skip(); });
            p.setOnErrorListener((m, what, extra) -> { skip(); return true; });
            p.prepareAsync();
        } catch (Exception e) {
            android.util.Log.w("LocalHub", "intro", e);
            skip();
        }
    }

    @Override public void onSurfaceTextureSizeChanged(SurfaceTexture t, int w, int h) { }
    @Override public boolean onSurfaceTextureDestroyed(SurfaceTexture t) { release(); return true; }
    @Override public void onSurfaceTextureUpdated(SurfaceTexture t) { }
}
