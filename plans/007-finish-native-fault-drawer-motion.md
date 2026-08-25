# 007 — Finish native fault-drawer motion

- **Status**: DONE
- **Commit**: 6b59c00
- **Severity**: HIGH
- **Category**: Interruptibility / physicality / accessibility
- **Estimated scope**: 2 files, approximately 95–145 changed lines

## Problem

`mobile-app/src/components/FaultDrawer.tsx` springs in, but its React Native
`Modal` unmounts as soon as `visible` becomes false. Close button, backdrop,
hardware back, and successful swipe therefore have no exit motion. Rapid close
and reopen cannot retarget from the current position.

The drawer gesture also clamps negative drag distance to zero. That hard wall
does not communicate that the panel is attached to the screen edge, and a
successful swipe discards release velocity. There is no reduced-motion branch.

## Target

Separate parent intent from render lifetime:

- `visible` remains the parent's desired state.
- local `rendered` keeps the `Modal` mounted until exit completion.
- `translateX` is the single source of truth for entry, drag, cancellation, and
  exit.
- `backdropOpacity` tracks drawer visibility in the same
  `Animated.parallel` operation.

Use shared constants:

```ts
const DRAWER_SPRING = {
  damping: 24,
  stiffness: 220,
  mass: 0.8,
  useNativeDriver: true,
};
const DRAWER_EXIT_DURATION_MS = 220;
const BACKDROP_VISIBLE_OPACITY = 1;
const OPPOSING_DRAG_RESISTANCE = 0.2;
```

On open, set `rendered` first and spring from the current `translateX` to zero.
On close, keep the modal rendered, animate `translateX` to the measured drawer
width and backdrop opacity to zero, then set `rendered = false` only in the
completion callback. Call `stopAnimation` before every retarget and guard
completion callbacks with a generation ref so an interrupted exit cannot
unmount a reopened drawer.

For gesture release:

- retain the existing distance/velocity success thresholds;
- store positive release velocity before requesting `onClose`, then feed it to
  the exit spring/timing path;
- cancel back to zero with `DRAWER_SPRING` when the threshold is missed;
- calculate negative drag as `gesture.dx * OPPOSING_DRAG_RESISTANCE` rather
  than clamping it to zero;
- preserve `useNativeDriver: true` for every animation.

Read reduced-motion state with `AccessibilityInfo.isReduceMotionEnabled()` and
subscribe to `reduceMotionChanged`. When enabled, snap positional movement and
final position immediately. Backdrop opacity may use at most 120ms so state
change remains legible without spatial travel; if it does, keep `rendered` true
only through that fade and unmount in its completion callback. Clean up the
listener on unmount.

## Repo conventions to follow

- Keep `FaultDrawer` controlled by the existing `visible`/`onClose` API; do not
  move business state into the component.
- Keep all close sources routed through `onClose`. Parent state change triggers
  the local exit lifecycle; do not call `onClose` again from animation
  completion.
- Continue using React Native `Animated`, `PanResponder`, `Modal`, and existing
  accessibility labels. No dependency is required.
- Use an animated wrapper for the current backdrop `Pressable`; do not replace
  its dismissal or hit-testing behavior.
- Add focused tests under the existing `mobile-app` test structure, using fake
  timers and mocked `Animated` completion callbacks where necessary.

## Steps

1. Add `rendered`, reduced-motion state, animation generation, release velocity,
   and `backdropOpacity` to `FaultDrawer.tsx`.
2. Replace `Modal visible={visible}` with `visible={rendered}` and implement one
   effect that opens, exits, or snaps based on `visible`, `rendered`, and the
   reduced-motion preference.
3. Stop and retarget current animated values on every state reversal. Unmount
   only after the current exit generation completes.
4. Animate backdrop opacity with the drawer and keep backdrop press, close
   button, hardware back, and successful swipe routed through `onClose`.
5. Add opposing-direction resistance and pass successful release velocity into
   the exit. Keep failed gestures springing back to zero.
6. Subscribe to reduced-motion changes and clean up both the listener and any
   in-flight animation callbacks on unmount.
7. Add tests covering delayed unmount, all close paths, rapid close/reopen,
   swipe success/cancel, opposing drag resistance, stale completion guards, and
   reduced-motion snapping.

## Boundaries

- Do NOT change fault options, fault execution, parent reducer/state, labels,
  colors, drawer width, swipe thresholds, or close semantics.
- Do NOT alter the app-wide edge-back gesture in `mobile-app/App.tsx`; it needs
  a separate interaction prototype.
- Do NOT add Reanimated, Gesture Handler, haptics, RUM actions, or dependencies.
- Do NOT animate layout properties or use the JavaScript driver.
- Do NOT unmount the modal at the start of an ordinary animated exit.
- If `FaultDrawer.tsx` has drifted from commit `6b59c00`, STOP and report it.

## Verification

- **Mechanical**:
  - Run the focused fault-drawer test, then `npm test -- --runInBand` from
    `mobile-app`.
  - Run the repository's mobile lint and type-check commands.
  - Run `git diff --check` and confirm no new package dependency or lockfile
    change.
- **Feel check**:
  1. Open and close by close button, backdrop, Android back, and swipe. Each
     path must share the same exit and unmount only after it finishes.
  2. Close then reopen before 220ms. The drawer must reverse from its current
     position with no flash, jump, or late disappearance.
  3. Slowly drag right and release below threshold; it must spring back. Fling
     above the velocity threshold; exit must preserve momentum.
  4. Drag slightly left and confirm gentle resistance instead of a rigid clamp.
  5. Enable system Reduce Motion. Open/close must have no spatial travel, remain
     responsive, and never leave an invisible modal mounted.
- **Done when**: every close source gets a complete, interruptible exit; gestures
  feel connected to the drawer; reduced motion is honored; and all mobile tests,
  lint, and type checks pass.
