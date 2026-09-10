#!/usr/bin/env bash
set -euo pipefail

mobile_root="$(cd "$(dirname "$0")/.." && pwd)"
cache_check_dir="$(mktemp -d)"
trap 'rm -rf "$cache_check_dir"' EXIT
java_bin="${JAVA_HOME:+${JAVA_HOME}/bin/}"

cat > "$cache_check_dir/ReflectionCacheCheck.java" <<'JAVA'
import com.ft.sdk.reactnative.sessionreplay.utils.ReflectionUtils;
import java.lang.reflect.Field;
import java.util.Map;

public final class ReflectionCacheCheck {
    static class Parent { private int color = 1; }
    static class Child extends Parent { private String text = "before"; }
    static class Other { private int color = 9; }

    static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) throws Exception {
        ReflectionUtils reader = new ReflectionUtils();
        Child first = new Child();
        Child second = new Child();
        check(reader.getDeclaredField(null, "color") == null, "null view");
        check(reader.getDeclaredField(first, "color").equals(1), "inherited private field");
        check(reader.getDeclaredField(first, "text").equals("before"), "initial text");
        check(reader.getDeclaredField(first, "missing") == null, "missing field");
        first.text = "after";
        ((Parent) first).color = 2;
        check(reader.getDeclaredField(first, "text").equals("after"), "fresh text after mutation");
        check(reader.getDeclaredField(first, "color").equals(2), "fresh inherited color");
        check(reader.getDeclaredField(second, "color").equals(1), "different instance value");
        check(reader.getDeclaredField(new Other(), "color").equals(9), "class-isolated metadata");

        Field cacheField = ReflectionUtils.class.getDeclaredField("fieldsByClass");
        cacheField.setAccessible(true);
        Map<?, ?> cache = (Map<?, ?>) cacheField.get(reader);
        Map<?, ?> childFields = (Map<?, ?>) cache.get(Child.class);
        Object cachedColor = childFields.get("color");
        for (int i = 0; i < 10000; i++) {
            reader.getDeclaredField(first, "color");
            reader.getDeclaredField(first, "missing");
        }
        check(childFields.get("color") == cachedColor, "metadata reused");
        check(childFields.containsKey("missing") && childFields.get("missing") == null, "negative lookup cached");
        check(cache.size() == 2 && childFields.size() == 3, "cache bounded by class and field");
        System.out.println("Replay reflection cache: current values, inheritance, class isolation and metadata reuse verified");
    }
}
JAVA

"${java_bin}javac" -d "$cache_check_dir" \
  "$mobile_root/node_modules/@cloudcare/react-native-session-replay/android/src/main/java/com/ft/sdk/reactnative/sessionreplay/utils/ReflectionUtils.java" \
  "$cache_check_dir/ReflectionCacheCheck.java"
"${java_bin}java" -cp "$cache_check_dir" ReflectionCacheCheck
