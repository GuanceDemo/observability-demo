# 002 — Remove layout-bound workbench motion

- **Status**: DONE
- **Commit**: 6b59c00
- **Severity**: HIGH
- **Category**: Performance / purpose and frequency
- **Estimated scope**: 2 files, approximately 12–24 changed lines

## Problem

The workbench animates layout properties on two dense, frequently used state
changes. Each intermediate frame recalculates the grid and iframe geometry.
After plan 001 removed iframe navigation, this is the remaining source of
avoidable work during a Web/mobile preview toggle.

`order-service/src/main/resources/static/business.html:904` currently animates
the entire three-column dashboard:

```css
/* current */
.workbench-grid {
  --left-column: clamp(220px, 16vw, 260px);
  --right-column: clamp(330px, 24vw, 380px);
  display: grid;
  grid-template-columns: var(--left-column) minmax(0, 1fr) var(--right-column);
  gap: 10px;
  transition: grid-template-columns .2s ease;
}
```

`order-service/src/main/resources/static/business.html:1158` animates the
iframe shell's `width`, `height`, and `border-radius` on every preview toggle:

```css
/* current */
.preview-shell.phone-shell {
  position: relative;
  min-width: 0;
  min-height: 0;
  max-width: none;
  transition: width .2s ease, height .2s ease, border-radius .2s ease;
}
```

Both violate the repository's desired crisp dashboard character and the motion
rule to animate only `transform` and `opacity`. A high-frequency mode switch
does not need an ornamental morph.

## Target

Delete both layout-property transitions. The grid, preview stage, iframe,
selected tab, and sidebar states must settle in the same task as the state
change:

```css
/* target: business.html */
.workbench-grid {
  /* existing declarations unchanged */
  grid-template-columns: var(--left-column) minmax(0, 1fr) var(--right-column);
  gap: 10px;
}

.preview-shell.phone-shell {
  position: relative;
  min-width: 0;
  min-height: 0;
  max-width: none;
}
```

Keep the existing transform-based mobile drawer transition. Add a reduced
motion override for the remaining workbench movement:

```css
@media (prefers-reduced-motion: reduce) {
  .collapse-button::before,
  .scene-sidebar,
  .control-sidebar.control-lane {
    transition: none;
  }
}
```

Do not replace the removed transitions with FLIP JavaScript, timers, opacity
crossfades, iframe scaling, or a View Transition API call.

## Repo conventions to follow

- Workbench styles are inline in
  `order-service/src/main/resources/static/business.html`; keep the change in
  that file.
- Preview state is represented by `#previewStage[data-view]`; do not introduce a
  second animation state.
- Compact drawers already use `transform: translateX(...)` at
  `business.html:1778`; preserve that GPU-composited implementation.
- Static UI contracts live in
  `order-service/src/test/java/demo/order/OrderControllerTest.java`.

## Steps

1. Remove `transition: grid-template-columns .2s ease` from `.workbench-grid`.
2. Remove the `width`/`height`/`border-radius` transition from
   `.preview-shell.phone-shell`.
3. Add the exact reduced-motion media query shown above after the responsive
   workbench rules. It must disable only movement, not color or focus feedback.
4. Extend `OrderControllerTest` to reject both removed transition strings and
   require the reduced-motion media query plus the existing mobile drawer
   `transition: transform .2s ease` contract.

## Boundaries

- Do NOT change the iframe no-reload implementation from plan 001.
- Do NOT change preview shell dimensions, breakpoints, grid column values, or
  phone/browser chrome markup.
- Do NOT change Toast placement or lifecycle.
- Do NOT remove the transform-based compact drawer transition for users who
  have not requested reduced motion.
- Do NOT add dependencies or change `SHOP_BUILD_ID`.
- Do NOT touch `observability/datakit-values.example.yaml`.
- If the cited declarations have drifted from commit `6b59c00`, STOP and report
  the drift instead of improvising.

## Verification

- **Mechanical**:
  - Run `mvn -pl order-service -Dtest=OrderControllerTest test` and expect zero
    failures.
  - Run
    `rg -n "grid-template-columns \\.2s|transition: width \\.2s|prefers-reduced-motion" order-service/src/main/resources/static/business.html`;
    expect only the reduced-motion match.
  - Run `git diff --check`.
- **Feel check**:
  1. Open `business.html`, toggle Web/mobile ten times, and collapse/expand both
     desktop sidebars five times.
  2. Confirm the selected control and final geometry update immediately with no
     200ms rubber-band resizing of the embedded storefront.
  3. Record one toggle in DevTools Performance. Confirm there is no sequence of
     repeated Layout events spanning a CSS transition; one layout for the state
     change is acceptable.
  4. Emulate `prefers-reduced-motion: reduce`, open a compact drawer, and confirm
     it snaps while focus and selected-state feedback remain visible.
- **Done when**: neither layout transition exists, the iframe and grid retain
  their exact final dimensions, reduced motion removes the remaining drawer and
  arrow travel, and all contract tests pass.
