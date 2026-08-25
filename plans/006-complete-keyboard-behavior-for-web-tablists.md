# 006 — Complete keyboard behavior for Web selection groups

- **Status**: DONE
- **Commit**: 6b59c00
- **Severity**: HIGH
- **Category**: Accessibility / interaction consistency
- **Estimated scope**: 3 files, approximately 75–115 changed lines

## Problem

Several single-select controls support clicks only:

- The Web/mobile preview tablist in
  `order-service/src/main/resources/static/business.html:1888`.
- Fault-layer and fault-scenario tablists generated around
  `business.html:2951`.
- Storefront detail tabs rendered by `innerHTML` in
  `order-service/src/main/resources/static/shop.html`.

The workbench buttons all expose `role="tab"`, but the two fault selectors do
not control tab panels; they are segmented single-choice inputs and should be
radio groups. None has roving `tabindex` or Arrow/Home/End handling. Storefront
detail tabs do not yet expose complete tab/panel semantics. Keyboard users must
tab through every option and cannot use the standard grouped-control model.

## Target

Use automatic selection and the standard grouped-control keyboard contract:

| Key | Result |
| --- | --- |
| ArrowRight / ArrowDown | Select and focus the next enabled control, wrapping |
| ArrowLeft / ArrowUp | Select and focus the previous enabled control, wrapping |
| Home | Select and focus the first enabled control |
| End | Select and focus the last enabled control |

Only the selected control receives `tabIndex = 0`; every other control receives
`-1`. Click and programmatic state updates must synchronize ARIA selection and
`tabIndex` in the same render pass.

Add one reusable helper per page rather than separate key handlers per tablist:

```js
function handleSingleSelectKeydown(event, { selector, activate }) {
  // Resolve enabled controls from event.currentTarget.
  // Prevent default only for ArrowRight/Down/Left/Up/Home/End.
  // Call activate(nextControl), then focus the rendered selected control.
}
```

For the dynamically rerendered fault controls and detail tabs, activation must
return or resolve the newly rendered selected element before focus is restored.
Do not focus a detached pre-render button.

Keep tab semantics only where there is a real panel:

- The preview-mode buttons remain `role="tab"` and control `#previewStage`.
- Storefront detail buttons become complete tabs controlling their detail
  panel.

Correct fault semantics:

- `#faultLayerTabs` and `#faultScenarioTabs` become `role="radiogroup"`.
- Generated selectable buttons become `role="radio"` with `aria-checked` and
  roving `tabindex`.
- Disabled loading placeholders use `role="radio"`, `aria-checked="false"`,
  `tabindex="-1"`, and native `disabled`.

Complete storefront semantics with stable IDs:

- each detail button: `role="tab"`, `aria-selected`, roving `tabindex`,
  `aria-controls`, and a stable `id`;
- detail content: `role="tabpanel"`, `aria-labelledby`, and the matching stable
  `id`;
- tablist: its existing label plus `aria-orientation="horizontal"`.

Add `aria-controls="previewStage"` to both preview tabs and give
`#previewStage` `role="tabpanel"` plus an `aria-labelledby` value synchronized
to the selected preview tab. Fault radio groups keep their existing visible
labels through `aria-labelledby`; they do not receive fictional tab panels.

## Repo conventions to follow

- Keep click delegation and current state render functions; keyboard activation
  must call the same state transition as a click.
- Continue generating fault and detail controls from their existing data. Do
  not hard-code duplicate tab markup.
- Stable IDs must be derived from existing safe enum keys, not labels or random
  values.
- Do not animate focus movement or selection. Existing color, underline, and
  focus-visible feedback is sufficient.
- Add static contracts to
  `order-service/src/test/java/demo/order/OrderControllerTest.java`.

## Steps

1. Add `handleSingleSelectKeydown` to `business.html` and attach it to the
   preview, fault-layer, and fault-scenario group containers.
2. Update preview rendering so selected tabs receive `tabIndex = 0`, unselected
   tabs receive `-1`, disabled tabs are skipped, and `#previewStage` is labelled
   by the active tab.
3. Change both fault containers to radio groups and update the fault control
   factory to emit `role="radio"`, `aria-checked`, and roving tabindex.
4. Ensure dynamic fault rerenders focus the newly created selected radio only
   for keyboard-initiated activation; mouse clicks must not receive forced
   focus.
5. Add complete roles, IDs, ARIA relationships, and roving tabindex to
   storefront detail tabs and their panel.
6. Add the same six-key handler in `shop.html`, routing automatic activation
   through the existing detail-tab render/state path and focusing the new tab.
7. Extend `OrderControllerTest` to assert tab versus radio semantics, roving
   tabindex, all six keys, wrapping, disabled-control skipping, stable tab/panel
   relationships, and shared click/keyboard activation paths.

## Boundaries

- Do NOT change selected defaults, labels, visual order between groups, fault
  scenarios, preview switching, or detail content.
- Do NOT make Space/Enter double-activate buttons; their native button click
  behavior remains authoritative.
- Do NOT introduce animation, scroll the page, or steal focus after pointer
  activation or ordinary programmatic state changes.
- Do NOT change quantity-stepper focus behavior or the currently hidden theme
  picker in this plan.
- Do NOT change RUM actions, Session Replay structure, Toast behavior, or build
  IDs.
- If tab markup or render functions have drifted from commit `6b59c00`, STOP
  and report the drift.

## Verification

- **Mechanical**:
  - Run `mvn -pl order-service -Dtest=OrderControllerTest test`.
  - Run JavaScript syntax checks for both HTML scripts and `git diff --check`.
  - Inspect rendered DOM and confirm every tablist/radiogroup has exactly one
    enabled control with `tabindex="0"`.
- **Feel check**:
  1. With a keyboard only, reach each tablist/radiogroup once with Tab and
     traverse it with Arrow keys, Home, and End. Selection and focus must move
     together and wrap.
  2. Confirm Arrow keys prevent page scrolling only while focus is within a
     managed selection group.
  3. Move between fault layers/scenarios and detail tabs that rerender. Focus
     must remain on the newly selected tab, never drop to `body`.
  4. Click each tablist with a pointer and confirm there is no new focus jump or
     behavioral difference from today.
  5. Inspect Accessibility Tree: preview/detail tabs and panels must have their
     correct relationships; fault selectors must be announced as labelled radio
     groups with checked state.
- **Done when**: every visible Web selection group follows its standard keyboard
  model, has one roving tab stop, preserves pointer behavior, and exposes the
  correct tab or radio semantics.
