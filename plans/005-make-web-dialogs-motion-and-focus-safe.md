# 005 — Make Web dialogs motion- and focus-safe

- **Status**: DONE
- **Commit**: 6b59c00
- **Severity**: HIGH
- **Category**: Accessibility / physicality / interruptibility
- **Estimated scope**: 3 files, approximately 90–140 changed lines

## Problem

The workbench usage guide and storefront authentication dialog appear and
disappear by changing `hidden`. Neither dialog traps focus, and the
authentication dialog restores focus only for the Escape path. Keyboard focus
can therefore move behind an open overlay or be lost after backdrop/close-button
dismissal.

The affected implementations are:

- `order-service/src/main/resources/static/business.html:2013` and
  `business.html:2212` for the usage guide.
- `order-service/src/main/resources/static/shop.html:506` and `shop.html:522`
  for authentication.
- `order-service/src/main/resources/static/assets/storefront.css` for the
  replay-stable, ordinary-DOM auth overlay.

The authentication dialog must remain ordinary in-document DOM. Existing
tests intentionally reject conversion to a native `<dialog>` because the
current structure is predictable in Session Replay.

## Target

Give both overlays the same explicit state machine:

```text
hidden -> opening -> open -> closing -> hidden
```

Use a small scale close to the final size, not a dramatic zoom:

```css
/* business.html; reuse the token when plan 004 has already landed */
--gc-ease-out: cubic-bezier(0.23, 1, 0.32, 1);

.usage-guide-modal {
  opacity: 0;
  transition: opacity 200ms var(--gc-ease-out);
}

.usage-guide-dialog {
  opacity: 0;
  transform: scale(.97);
  transition:
    opacity 220ms var(--gc-ease-out),
    transform 220ms var(--gc-ease-out);
}

.usage-guide-modal[data-state="open"] {
  opacity: 1;
}

.usage-guide-modal[data-state="open"] .usage-guide-dialog {
  opacity: 1;
  transform: scale(1);
}

/* storefront.css; reuse the token when plans 003/004 have added it */
--store-ease-out: cubic-bezier(0.23, 1, 0.32, 1);

.auth-dialog {
  opacity: 0;
  transition: opacity 200ms var(--store-ease-out);
}

.auth-dialog-card {
  opacity: 0;
  transform: scale(.97);
  transition:
    opacity 220ms var(--store-ease-out),
    transform 220ms var(--store-ease-out);
}

.auth-dialog[data-state="open"] {
  opacity: 1;
}

.auth-dialog[data-state="open"] .auth-dialog-card {
  opacity: 1;
  transform: scale(1);
}
```

Set `hidden = false`, apply `data-state="opening"`, and promote to `open` in
`requestAnimationFrame`. Closing must set `data-state="closing"` and wait
exactly 220ms before applying `hidden`. Keep a generation counter and cancel the
pending frame/timer when the motion reverses.

For `prefers-reduced-motion: reduce`, keep a 180ms opacity transition but set
dialog `transform: none`.

Both dialogs must:

- remember `document.activeElement` when opened;
- focus their existing close button after the opening frame;
- trap Tab and Shift+Tab within visible, enabled controls;
- close on Escape and backdrop click;
- restore the remembered element after the exit finalizer, regardless of the
  dismissal path;
- restore focus immediately when the requested return target no longer exists
  by falling back to the existing launcher.

Programmatic auth dismissal after login/logout must use an explicit
`{ immediate: true }` path so a closing overlay cannot block the next product
state.

## Repo conventions to follow

- Keep `#usageGuideModal` and the authentication overlay in their current DOM
  positions and retain all `data-gc-privacy` attributes.
- Keep `hidden` as the final non-interactive state; `data-state` controls only
  the transition before that final state.
- Use CSS transitions, `requestAnimationFrame`, and cancellable timers. Do not
  add a motion library or duplicate overlay markup.
- Reuse the `--gc-ease-out` and `--store-ease-out` tokens if plan 004 has
  already added them; otherwise add the same exact values locally.
- Static UI contracts belong in
  `order-service/src/test/java/demo/order/OrderControllerTest.java`.

## Steps

1. Add opening/open/closing overlay and dialog styles in `business.html` and
   `storefront.css`, including the exact reduced-motion behavior above.
2. Extract a local `getFocusableElements(container)` helper in each page. Its
   selector must cover links, enabled buttons, inputs, selects, textareas, and
   `[tabindex]:not([tabindex="-1"])`, then filter hidden/inert elements.
3. Refactor `openUsageGuide`/`closeUsageGuide` to use one frame, one exit timer,
   and one generation counter. Keep its current slide navigation and arrow-key
   behavior unchanged.
4. Refactor auth open/close with the same lifecycle. Route Escape, backdrop,
   close-button, and programmatic dismissal through the same close function.
5. Add Tab/Shift+Tab wrapping only while the corresponding overlay is open or
   opening. Remove or ignore the trap during closing.
6. Extend `OrderControllerTest` to require the two state machines, delayed
   `hidden` finalization, focus trap/restore behavior, reduced-motion rules, and
   ordinary DOM; continue rejecting `showModal()` and native `<dialog>`.

## Boundaries

- Do NOT convert either overlay to native `<dialog>`, a portal, shadow DOM, or
  third-party modal component.
- Do NOT change Session Replay privacy attributes, RUM initialization, or
  business event capture.
- Do NOT change usage-guide slide content, image navigation, authentication
  rules, checkout behavior, copy, placement, or z-index hierarchy.
- Do NOT animate width, height, top, left, padding, margin, or backdrop blur.
- Do NOT add slide-to-slide animation; that is a separate low-priority polish
  candidate.
- Do NOT change Toast placement or lifecycle.
- If the cited implementations have drifted from commit `6b59c00`, STOP and
  report the drift.

## Verification

- **Mechanical**:
  - Run `mvn -pl order-service -Dtest=OrderControllerTest test`.
  - Run JavaScript syntax checks for the main scripts in `business.html` and
    `shop.html`, then run `git diff --check`.
  - Search for `showModal`, native `<dialog`, and removed privacy attributes;
    expect none.
- **Feel check**:
  1. Open and close each dialog with launcher, close button, backdrop, and
     Escape. Every path must use the same restrained entry/exit and restore
     focus to its launcher.
  2. Press Tab and Shift+Tab repeatedly. Focus must wrap inside the visible
     dialog and never reach the page behind it.
  3. Reverse an opening dialog immediately, then reopen it while closing. Motion
     must continue from the current opacity/scale without flashing or stale
     timers hiding the new dialog.
  4. Enable reduced motion. Confirm opacity remains legible while scale motion
     disappears.
  5. Record auth open/close in Session Replay and confirm the existing DOM and
     privacy masking remain visible as before.
- **Done when**: both overlays enter and exit reliably, every dismissal path
  restores focus, keyboard focus cannot escape, rapid reversal is safe, and
  replay structure is unchanged.
