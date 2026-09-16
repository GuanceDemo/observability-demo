import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.LayerDrawable;
import android.util.DisplayMetrics;
import com.facebook.react.uimanager.*;
import com.facebook.react.uimanager.drawable.BackgroundDrawable;
import com.facebook.react.uimanager.drawable.BorderDrawable;
import com.facebook.react.uimanager.style.*;
import com.ft.sdk.reactnative.sessionreplay.utils.ReactViewBackgroundDrawableUtils;
import com.ft.sdk.reactnative.sessionreplay.mappers.Pair;
import com.ft.sdk.sessionreplay.model.*;

/** Run off-screen with app_process; never launches or changes the demo application. */
public class ReplayFirstDrawCheck {
  static int checks;
  static void check(boolean value, String message) {
    checks++;
    if (!value) throw new AssertionError(message);
  }
  static Pair<ShapeStyle, ShapeBorder> sample(Drawable drawable) {
    ReactViewBackgroundDrawableUtils mapper = new ReactViewBackgroundDrawableUtils();
    return mapper.resolveShapeAndBorder(mapper.getReactBackgroundFromDrawable(drawable), 1f, 2f);
  }
  static void expect(Drawable drawable, float radius, String color) {
    Pair<ShapeStyle, ShapeBorder> result = sample(drawable);
    check(Math.abs(result.first.getCornerRadius().floatValue() - radius) < .001f, "radius " + result.first.getCornerRadius());
    check(result.second != null && color.equals(result.second.getColor()), "border color");
    check(result.second.getWidth() == 1, "border width");
  }
  public static void main(String[] args) throws Exception {
    Context context = new android.content.ContextWrapper(null) {
      @Override public android.content.res.Resources getResources() {
        return android.content.res.Resources.getSystem();
      }
      @Override public android.content.SharedPreferences getSharedPreferences(String name, int mode) {
        return (android.content.SharedPreferences) java.lang.reflect.Proxy.newProxyInstance(
            getClass().getClassLoader(), new Class<?>[]{android.content.SharedPreferences.class},
            (proxy, method, values) -> {
              if (method.getName().equals("getBoolean")) return values[1];
              throw new UnsupportedOperationException(method.getName());
            });
      }
    };
    DisplayMetrics metrics = new DisplayMetrics();
    metrics.setToDefaults(); metrics.density = 2f;
    DisplayMetricsHolder.setWindowDisplayMetrics(metrics);
    DisplayMetricsHolder.setScreenDisplayMetrics(metrics);
    BorderRadiusStyle radius = new BorderRadiusStyle();
    radius.setUniform(new LengthPercentage(17f, LengthPercentageType.POINT));
    BorderInsets widths = new BorderInsets(); widths.setBorderWidth(LogicalEdge.ALL, 1f);
    BackgroundDrawable background = new BackgroundDrawable(context, radius, widths);
    background.setBackgroundColor(0xffffffff);
    BorderDrawable border = new BorderDrawable(context, new Spacing(), radius, widths, null);
    border.setBorderColor(LogicalEdge.ALL, 0xffe8dddd);
    LayerDrawable layers = new LayerDrawable(new Drawable[]{background, border});
    layers.setBounds(0, 0, 400, 200);
    expect(layers, 17f, "#e8ddddff"); // Before the first draw: old mapper reports black/zero.
    layers.draw(new Canvas(Bitmap.createBitmap(400, 200, Bitmap.Config.ARGB_8888)));
    expect(layers, 17f, "#e8ddddff");
    radius.setUniform(new LengthPercentage(35f, LengthPercentageType.POINT));
    border.setBorderColor(LogicalEdge.ALL, 0xff123456);
    expect(layers, 35f, "#123456ff"); // Draw caches still contain the previous style.
    radius.setUniform(new LengthPercentage(50f, LengthPercentageType.PERCENT));
    expect(layers, 75f, "#123456ff"); // 200x100 DIP ellipse: average of 100/50.
    layers.setBounds(0, 0, 200, 100);
    expect(layers, 37.5f, "#123456ff");
    radius.setUniform(null);
    expect(layers, 0f, "#123456ff");
    border.setBorderColor(LogicalEdge.START, 0xffabcdef);
    layers.setLayoutDirection(1);
    Pair<ShapeStyle, ShapeBorder> mixed = sample(layers);
    check(mixed.second == null, "asymmetric RTL border uses raster fallback");
    System.out.println("Replay first-draw checks passed: " + checks);
  }
}
