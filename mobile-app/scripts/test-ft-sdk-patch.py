#!/usr/bin/env python3
"""Run original/patched resolver equivalence and lookup regression tests on JVM.

Small Android fakes model resource IDs and mutable view trees; device checks
remain necessary for Android runtime behavior and frame timing.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'build/sdk-patch'
ENTRY = 'com/ft/sdk/FTViewPermanentIdResolver.java'
STUBS = {
    'android/content/res/Resources.java': '''package android.content.res;
public class Resources {
 public int calls;
 public static class NotFoundException extends RuntimeException {}
 public String getResourceName(int id) {
  calls++;
  if (id == 0x7f010001) return "demo:id/book";
  if (id == 0x01020002) return "android:id/content";
  throw new NotFoundException();
 }
}''',
    'android/content/Context.java': '''package android.content;
public class Context { public String getPackageName() { return "demo"; } }''',
    'android/app/Application.java': '''package android.app;
public class Application extends android.content.Context {}''',
    'android/view/ViewParent.java': '''package android.view; public interface ViewParent {}''',
    'android/view/View.java': '''package android.view;
import android.content.Context;
import android.content.res.Resources;
public class View implements ViewParent {
 public static final int NO_ID = -1;
 public int id = NO_ID;
 public ViewParent parent;
 public Resources resources;
 public Context context = new Context();
 public View(Resources resources) { this.resources = resources; }
 public int getId() { return id; }
 public ViewParent getParent() { return parent; }
 public Resources getResources() { return resources; }
 public Context getContext() { return context; }
 public View getRootView() { return parent instanceof View ? ((View) parent).getRootView() : this; }
}''',
    'android/view/ViewGroup.java': '''package android.view;
import android.content.res.Resources;
import java.util.ArrayList;
public class ViewGroup extends View {
 public static int childReads;
 public ArrayList<View> children = new ArrayList<>();
 public ViewGroup(Resources resources) { super(resources); }
 public int getChildCount() { return children.size(); }
 public View getChildAt(int i) { childReads++; return children.get(i); }
 public void add(View v) { children.add(v); v.parent = this; }
}''',
    'com/ft/sdk/garble/utils/Utils.java': '''package com.ft.sdk.garble.utils;
public class Utils { public static boolean isNullOrEmpty(String s) { return s == null || s.isEmpty(); } }''',
    'com/ft/sdk/FTApplication.java': '''package com.ft.sdk;
public class FTApplication { public static android.app.Application getApplication() { return null; } }''',
    'com/ft/sdk/FTRUMInnerManager.java': '''package com.ft.sdk;
public class FTRUMInnerManager {
 static final FTRUMInnerManager INSTANCE = new FTRUMInnerManager();
 static String name = "home";
 public static FTRUMInnerManager get() { return INSTANCE; }
 public String getViewName() { return name; }
}''',
    'com/ft/sdk/ResolverRegression.java': '''package com.ft.sdk;
import android.view.*;
import android.content.res.Resources;
import java.util.Objects;
public class ResolverRegression {
 static int checks;
 static void snapshotSame(FTViewPermanentIdResolver.Snapshot snapshot, View view) {
  check(Objects.equals(BaselineResolver.resolvePath(view), snapshot.resolvePath(view)), "snapshot path differs");
  check(Objects.equals(BaselineResolver.resolve(view), snapshot.resolve(view)), "snapshot hash differs");
 }
 static void batch(View... views) {
  FTViewPermanentIdResolver.Snapshot snapshot = new FTViewPermanentIdResolver.Snapshot();
  for (View v : views) snapshotSame(snapshot, v);
 }

 static void check(boolean ok, String message) { checks++; if (!ok) throw new AssertionError(message); }
 static void same(View view) {
  check(Objects.equals(BaselineResolver.resolvePath(view), FTViewPermanentIdResolver.resolvePath(view)), "path differs");
  check(Objects.equals(BaselineResolver.resolve(view), FTViewPermanentIdResolver.resolve(view)), "hash differs");
 }
 public static void main(String[] args) {
  Resources r = new Resources();
  ViewGroup root = new ViewGroup(r); root.id = 0x01020002;
  ViewGroup row = new ViewGroup(r); row.id = 11; root.add(row);
  View first = new View(r); View second = new View(r); row.add(first); row.add(second);
  same(null); batch(null, root, row, first, second);
  int[] ids = {-1, 0, 1, 2, 11, 42, 0x00ffffff, 0x7f010001, 0x01020002, 0x7f010099, 0x80010001};
  for (int id : ids) { first.id = id; same(first); batch(first, second, row, root); }
  for (int id = 1; id < 1000; id++) { first.id = id; same(first); batch(first, second, row, root); }
  first.id = 2; String before = FTViewPermanentIdResolver.resolve(first);
  row.children.remove(first); row.children.add(first); same(first);
  check(!before.equals(FTViewPermanentIdResolver.resolve(first)), "sibling move not reflected");
  row.children.remove(first); root.add(first); same(first);
  batch(first, second, row, root);
  FTRUMInnerManager.name = "detail/%book"; same(first); batch(first, second);
  FTRUMInnerManager.name = null; same(first); batch(first, second);
  first.context = null; same(first); batch(first, second);
  first.resources = null; same(first); batch(first, second);
  first.resources = r;
  // A dynamic-only tree must no longer query Resources at all, including ancestors.
  root.id = 1; row.id = 11; first.id = 21;
  r.calls = 0;
  for (int i = 0; i < 10000; i++) FTViewPermanentIdResolver.resolve(first);
  check(r.calls == 0, "dynamic IDs still query Resources: " + r.calls);
  BaselineResolver.resolve(first);
  check(r.calls > 0, "baseline must reproduce invalid resource lookup");
  first.id = 0x7f010001; r.calls = 0; same(first);
  check(r.calls > 0, "valid app resource lookup was removed");
  // Wide mixed-class tree: same-class numbering, null children, and reverse visits.
  ViewGroup wide = new ViewGroup(r); wide.id = 0x01020002;
  for (int i = 0; i < 400; i++) {
   View v = i % 3 == 0 ? new ViewGroup(r) : new View(r);
   v.id = i % 5 == 0 ? 0x7f010001 : i + 1;
   wide.add(v);
  }
  wide.children.add(13, null);
  FTViewPermanentIdResolver.Snapshot wideSnapshot = new FTViewPermanentIdResolver.Snapshot();
  for (int i = wide.children.size() - 1; i >= 0; i--) snapshotSame(wideSnapshot, wide.children.get(i));
  // Measure patched work separately from the original oracle.
  ViewGroup.childReads = 0;
  wideSnapshot = new FTViewPermanentIdResolver.Snapshot();
  for (View v : wide.children) wideSnapshot.resolve(v);
  check(ViewGroup.childReads == wide.children.size(), "siblings rescanned: " + ViewGroup.childReads);
  View moved = wide.children.remove(20); wide.children.add(0, moved);
  moved.id = 0x7f010001;
  batch(moved, wide.children.get(21));
  wide.children.remove(moved); row.add(moved); batch(moved, row, root);
  // Shared deep ancestry: resource names must be read once per node per snapshot.
  ViewGroup deep = new ViewGroup(r); deep.id = 0x01020002;
  ViewGroup tip = deep;
  for (int i = 0; i < 80; i++) { ViewGroup next = new ViewGroup(r); next.id = 0x7f010001; tip.add(next); tip = next; }
  for (int i = 0; i < 100; i++) { View leaf = new View(r); leaf.id = i + 1; tip.add(leaf); }
  FTViewPermanentIdResolver.Snapshot deepSnapshot = new FTViewPermanentIdResolver.Snapshot();
  for (View leaf : tip.children) snapshotSame(deepSnapshot, leaf);
  r.calls = 0;
  deepSnapshot = new FTViewPermanentIdResolver.Snapshot();
  for (View leaf : tip.children) deepSnapshot.resolve(leaf);
  check(r.calls == 81, "ancestors resolved repeatedly: " + r.calls);
  // A view absent from its reported parent retains the original index-zero fallback.
  View absent = new View(r); absent.parent = wide; batch(absent);
  try {
   Class<?> bridge = Class.forName("com.ft.sdk.sessionreplay.internal.recorder.PermanentIdResolver");
   java.lang.reflect.Method begin = bridge.getDeclaredMethod("beginSnapshot");
   java.lang.reflect.Method end = bridge.getDeclaredMethod("endSnapshot", FTViewPermanentIdResolver.Snapshot.class);
   java.lang.reflect.Method resolve = bridge.getDeclaredMethod("resolve", View.class);
   begin.setAccessible(true); end.setAccessible(true); resolve.setAccessible(true);
   java.lang.reflect.Field field = bridge.getDeclaredField("SNAPSHOT"); field.setAccessible(true);
   ThreadLocal<?> local = (ThreadLocal<?>) field.get(null);
   check(local.get() == null, "unexpected scope before start");
   Object previous = begin.invoke(null);
   Object outer = local.get();
   check(previous == null && outer != null, "scope not initialized");
   check(Objects.equals(resolve.invoke(null, moved), BaselineResolver.resolve(moved)), "bridge differs");
   View broken = new View(r) { public android.content.Context getContext() { throw new IllegalStateException("bad custom View"); } };
   check(resolve.invoke(null, broken) == null, "resolver error must remain best effort");
   Object nestedPrevious = begin.invoke(null);
   check(nestedPrevious == outer && local.get() != outer, "nested scope not isolated");
   end.invoke(null, nestedPrevious);
   check(local.get() == outer, "outer scope not restored");
   java.util.concurrent.atomic.AtomicBoolean isolated = new java.util.concurrent.atomic.AtomicBoolean();
   Thread other = new Thread(() -> isolated.set(local.get() == null));
   other.start(); other.join();
   check(isolated.get(), "scope leaked across threads");
   try { throw new IllegalStateException("synthetic mapper failure"); }
   catch (IllegalStateException expected) { }
   finally { end.invoke(null, previous); }
   check(local.get() == null, "scope retained views after cleanup");
  } catch (Exception e) { throw new AssertionError(e); }
  System.out.println("PASS: " + checks + " checks; identical paths/hashes; moves, ID changes, resource fallback; 10000 dynamic resolutions with zero resource lookups");
 }
}''',
}


def main():
    java_home = os.environ.get('JAVA_HOME')
    java = str(Path(java_home) / 'bin/java') if java_home else 'java'
    javac = str(Path(java_home) / 'bin/javac') if java_home else 'javac'
    with tempfile.TemporaryDirectory(prefix='resolver-test-') as directory:
        directory = Path(directory)
        with zipfile.ZipFile(WORK / 'ft-sdk-1.7.5-sources.jar') as z:
            original = z.read(ENTRY).decode()
        patched = WORK / 'maven/com/cloudcare/ft/mobile/sdk/tracker/agent/ft-sdk/1.7.5-jankfix02/ft-sdk-1.7.5-jankfix02-sources.jar'
        with zipfile.ZipFile(patched) as z:
            fixed = z.read(ENTRY).decode()
        files = dict(STUBS)
        files[ENTRY] = fixed
        replay_entry = 'com/ft/sdk/sessionreplay/internal/recorder/PermanentIdResolver.java'
        replay_sources = WORK / 'maven/com/cloudcare/ft/mobile/sdk/tracker/agent/ft-session-replay/0.1.8-jankfix02/ft-session-replay-0.1.8-jankfix02-sources.jar'
        with zipfile.ZipFile(replay_sources) as z:
            files[replay_entry] = z.read(replay_entry).decode()
        files['com/ft/sdk/BaselineResolver.java'] = original.replace('FTViewPermanentIdResolver', 'BaselineResolver')
        paths = []
        for name, text in files.items():
            target = directory / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(text)
            paths.append(str(target))
        subprocess.run([javac, '--release', '8', '-d', str(directory), *paths], check=True)
        subprocess.run([java, '-cp', str(directory), 'com.ft.sdk.ResolverRegression'], check=True)


if __name__ == '__main__':
    main()
