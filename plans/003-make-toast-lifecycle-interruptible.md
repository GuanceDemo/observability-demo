# 003 — Make the Toast lifecycle interruptible

- **Status**: DONE
- **Commit**: 6b59c00
- **Severity**: HIGH
- **Category**: Interruptibility / easing and duration
- **Estimated scope**: 3 files, approximately 55–85 changed lines

## Problem

The Toast has CSS transitions, but JavaScript bypasses both entry and exit by
toggling `hidden` in the same rendering frame. Rapid replacement can also let
an old timeout hide a newer result.

`order-service/src/main/resources/static/assets/storefront.css:467` defines the
intended visual states:

```css
/* current */
.phone-toast {
  opacity: 0;
  transform: scale(.96);
  transition: opacity .18s ease, transform .18s ease;
}

.phone-toast.show {
  opacity: 1;
  transform: scale(1);
}
```

`order-service/src/main/resources/static/shop.html:1016` never lets the browser
paint those states separately:

```js
/* current */
function hidePhoneResult() {
  if (phoneToastTimer) {
    clearTimeout(phoneToastTimer);
    phoneToastTimer = null;
  }
  els.phoneToast.className = 'phone-toast';
  els.phoneToast.hidden = true;
  els.phoneToastTitle.textContent = '';
  els.phoneToastDetail.textContent = '';
}

function setPhoneResult(kind, title, detail, options = {}) {
  // ...
  els.phoneToast.hidden = false;
  els.phoneToast.className = `phone-toast ${toastKind} show`;
  // ...
}
```

The settled product decision is to keep Toast placement exactly as it is,
including the default centered position. This plan changes lifecycle only.

## Target

Use a CSS transition that retargets from the current visual state and a small
JavaScript lifecycle with cancellation tokens. Add one shared storefront curve:

```css
/* target: storefront.css :root */
--store-ease-out: cubic-bezier(0.23, 1, 0.32, 1);

.phone-toast {
  opacity: 0;
  transform: scale(.96);
  transition:
    opacity 180ms var(--store-ease-out),
    transform 180ms var(--store-ease-out);
}
```

Use these exact lifecycle constants and responsibilities in `shop.html`:

```js
const TOAST_TRANSITION_MS = 180;
let phoneToastTimer = null;
let phoneToastExitTimer = null;
let phoneToastFrame = null;
let phoneToastGeneration = 0;
```

- A fresh Toast must be unhidden in its base class, then receive `.show` in one
  `requestAnimationFrame`.
- Updating an already visible or exiting Toast must cancel the old frame,
  auto-hide timer, and exit timer, update its content, and add `.show`
  immediately so the CSS transition retargets from its current opacity/scale.
- `hidePhoneResult()` must remove `.show`, wait exactly 180ms, then set `hidden`,
  reset the base class, and clear text.
- A generation number must guard every frame/timer callback so an older Toast
  can never hide or show a newer one.
- `showPurchaseLoading()` must call `hidePhoneResult({ immediate: true })` to
  avoid overlapping two blocking status surfaces.

Add reduced-motion behavior without removing feedback:

```css
@media (prefers-reduced-motion: reduce) {
  .phone-toast {
    transform: none;
    transition: opacity 180ms var(--store-ease-out);
  }

  .phone-toast.failed,
  .phone-toast.alert,
  .phone-toast.failed.show,
  .phone-toast.alert.show {
    transform: translateX(-50%);
  }
}
```

The `translateX(-50%)` above is positioning, not entrance movement. Do not
change any `top`, `left`, `inset`, `place-items`, width, or z-index value.

## Repo conventions to follow

- Toast DOM remains the ordinary in-document `#phoneToast` element in
  `shop.html`; this preserves Session Replay behavior.
- Existing Toast kinds (`info`, `success`, `failed`, `alert`, `processing`) and
  their sticky/auto-hide semantics remain unchanged.
- Use CSS transitions, not `@keyframes`; Toasts can be retriggered quickly.
- Source contracts are asserted in `OrderControllerTest` using AssertJ string
  checks.

## Steps

1. Add `--store-ease-out` to the existing `:root` token block in
   `assets/storefront.css` and replace the Toast's bare `ease` transition with
   the exact 180ms transition above.
2. Add the exact reduced-motion block without changing Toast placement.
3. Refactor the Toast lifecycle in `shop.html` around the four constants above.
   Keep text clearing in the finalizer, after exit completes.
4. Make `setPhoneResult` preserve the currently rendered Toast while replacing
   content and cancel all stale callbacks with `phoneToastGeneration`.
5. Update `showPurchaseLoading` to request an immediate Toast teardown.
6. Extend `OrderControllerTest` to require the constants, generation guard,
   `requestAnimationFrame`, delayed finalizer, reduced-motion CSS, and centered
   `.toast-region`; reject the old same-frame `hidden = false` + `show` shape.

## Boundaries

- Do NOT move the Toast. Default placement remains centered in the viewport.
- Do NOT change failed/alert placement, colors, copy, duration defaults, or
  sticky behavior.
- Do NOT change RUM actions, Session Replay privacy, purchase logic, or error
  handling.
- Do NOT animate height, width, top, left, padding, or margin.
- Do NOT add a Toast library, dependency, keyframe, or second Toast container.
- Do NOT change `STOREFRONT_BUILD_ID` for this behavior-only edit.
- If cited code has drifted from commit `6b59c00`, STOP and report it.

## Verification

- **Mechanical**:
  - Run `mvn -pl order-service -Dtest=OrderControllerTest test`.
  - Run `git diff --check` and a JavaScript syntax check for the main
    `shop.html` script.
  - Search for `TOAST_TRANSITION_MS`, `phoneToastGeneration`, and
    `prefers-reduced-motion`; all must be present.
- **Feel check**:
  1. Trigger success, failure, alert, and processing Toasts. Confirm every fresh
     Toast eases in and every non-immediate dismissal eases out.
  2. Trigger three different Toasts rapidly. Confirm content never clears late,
     no Toast flashes hidden, and motion reverses from its current state.
  3. Inspect at 10% playback speed: entry starts at `.96`, never `scale(0)`, and
     exit is the same path in reverse.
  4. Enable reduced motion. Confirm the Toast retains an opacity transition but
     has no scale or vertical travel.
  5. Confirm the default Toast remains visually centered before, during, and
     after the change.
- **Done when**: all Toast kinds animate reliably, stale callbacks cannot affect
  a new Toast, reduced motion is gentle, placement is identical, and tests pass.
