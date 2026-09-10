import android.graphics.Bitmap;
import android.graphics.Canvas;
import com.ft.sdk.reactnative.sessionreplay.utils.BorderSnapshotDrawable;
import com.ft.sdk.reactnative.sessionreplay.utils.ColorUtils;

/** Run with Android app_process; checks actual Skia pixels without interacting with a UI. */
public final class ReplayBorderRasterCheck {
  private static final int RED = 0xffff0000;
  private static void check(boolean value, String description) {
    if (!value) throw new AssertionError(description);
  }
  private static Bitmap render(BorderSnapshotDrawable drawable) {
    Bitmap bitmap = Bitmap.createBitmap(40, 40, Bitmap.Config.ARGB_8888);
    drawable.draw(new Canvas(bitmap));
    return bitmap;
  }
  public static void main(String[] args) {
    check(ColorUtils.formatAsRgba(0).equals("#00000000"), "transparent zero padding");
    check(ColorUtils.formatAsRgba(0x01010203).equals("#01020301"), "small alpha channel");
    check(ColorUtils.formatAsRgba(0x804488cc).equals("#4488cc80"), "translucent color order");
    float[] widths = {0, 0, 0, 2};
    int[] colors = {RED, RED, RED, RED};
    BorderSnapshotDrawable bottom = new BorderSnapshotDrawable(40, 40, 0, 0, widths, colors);
    String key = bottom.cacheKey();
    widths[3] = 10;
    colors[3] = 0xff00ff00;
    check(bottom.cacheKey().equals(key), "snapshot detached from input arrays");
    check(bottom.copy().cacheKey().equals(key), "worker copy preserves style");
    Bitmap image = render(bottom.copy());
    check(image.getPixel(20, 39) == RED, "bottom border rendered");
    check(image.getPixel(20, 35) == 0, "no mutation of captured width");
    check(image.getPixel(0, 20) == 0 && image.getPixel(39, 20) == 0 && image.getPixel(20, 0) == 0,
        "single bottom border does not invent other edges");
    BorderSnapshotDrawable changed = new BorderSnapshotDrawable(40, 40, 0, 0, widths, colors);
    check(!changed.cacheKey().equals(key), "style change invalidates resource cache");
    image = render(changed);
    check(image.getPixel(20, 35) == 0xff00ff00, "fresh width and color render");
    image = render(new BorderSnapshotDrawable(40, 40, 0xffffffff, 8,
        new float[] {2, 3, 4, 5}, new int[] {RED, 0xff00ff00, 0xff0000ff, 0xff000000}));
    check(image.getPixel(0, 20) == RED, "left edge color");
    check(image.getPixel(20, 0) == 0xff00ff00, "top edge color");
    check(image.getPixel(39, 20) == 0xff0000ff, "right edge color");
    check(image.getPixel(20, 39) == 0xff000000, "bottom edge color");
    check(image.getPixel(20, 20) == 0xffffffff && image.getPixel(0, 0) == 0, "fill and rounded corner");
    image = render(new BorderSnapshotDrawable(40, 40, 0, 0,
        new float[] {0, 0, 0, 0.5f}, new int[] {RED, RED, RED, RED}));
    check((image.getPixel(20, 39) >>> 24) > 0, "fractional border remains visible");
    System.out.println("PASS: Android raster colors, single/mixed/fractional edges, radius, immutable snapshots and cache freshness");
  }
}
