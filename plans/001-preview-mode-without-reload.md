# 001 — Switch preview modes without reloading the storefront

- **Status**: DONE
- **Commit**: 6b59c00
- **Severity**: HIGH
- **Category**: Performance / missed simplification
- **Estimated scope**: 2 files, approximately 20–35 changed lines

## Problem

The workbench already has a same-origin `postMessage` contract that can change
the loaded storefront's preview context, but the Web/mobile toggle bypasses it
and forces a full iframe navigation. That tears down and rebuilds the storefront
document, reruns its bootstrap path, and introduces a blank/loading interval.
A local browser walkthrough on commit `6b59c00` measured approximately 3029 ms
for one preview toggle to settle.

`order-service/src/main/resources/static/business.html:2272` currently treats a
preview-mode change as a reason to assign a new iframe `src`:

```js
// order-service/src/main/resources/static/business.html:2272 — current
function updateFrameUrls(options = {}) {
  const nextUrl = shopUrl(state.language, options);
  if (els.openShopLink) els.openShopLink.href = nextUrl;
  const frameChanged = els.shopFrame.dataset.sceneId !== state.selectedSceneId;
  const previewChanged = els.shopFrame.dataset.previewMode !== state.previewMode;
  if (!els.shopFrame.getAttribute('src') || frameChanged || (options.reloadPreview && previewChanged)) {
    state.shopReady = false;
    els.shopFrame.src = nextUrl;
    els.shopFrame.dataset.sceneId = state.selectedSceneId;
    els.shopFrame.dataset.previewMode = state.previewMode;
  }
  els.shopFrame.title = t('frameTitle');
}
```

`order-service/src/main/resources/static/business.html:2379` explicitly requests
that reload:

```js
// order-service/src/main/resources/static/business.html:2379 — current
function setPreviewMode(mode) {
  const scene = selectedBusinessScene();
  if (!scene.supportedViews.includes(mode) || state.previewMode === mode) return;
  state.previewMode = mode;
  renderPreviewMode();
  updateWorkbenchUrl();
  updateFrameUrls({ reloadPreview: true, preserveStoreState: true });
}
```

The child-side capability already exists at
`order-service/src/main/resources/static/shop.html:924`:

```js
// order-service/src/main/resources/static/shop.html:924 — existing contract
function setPreviewContext(sceneId, view) {
  state.businessScene = sceneId || state.businessScene || 'bookstore';
  state.previewMode = view === 'mobile' ? 'mobile' : 'web';
  applyPreviewObservabilityContext();
}
```

## Target

Keep iframe navigation only for the initial load and a real scene change. A
preview-mode toggle must update the standalone URL and iframe dataset without
changing the iframe `src`, then send the existing preview-context message.

Replace `updateFrameUrls` with this exact shape:

```js
// target: order-service/src/main/resources/static/business.html
function updateFrameUrls(options = {}) {
  const nextUrl = shopUrl(state.language, options);
  if (els.openShopLink) els.openShopLink.href = nextUrl;
  const frameChanged = els.shopFrame.dataset.sceneId !== state.selectedSceneId;
  if (!els.shopFrame.getAttribute('src') || frameChanged) {
    state.shopReady = false;
    els.shopFrame.src = nextUrl;
    els.shopFrame.dataset.sceneId = state.selectedSceneId;
  }
  els.shopFrame.dataset.previewMode = state.previewMode;
  els.shopFrame.title = t('frameTitle');
}
```

Replace `setPreviewMode` with this exact shape:

```js
// target: order-service/src/main/resources/static/business.html
function setPreviewMode(mode) {
  const scene = selectedBusinessScene();
  if (!scene.supportedViews.includes(mode) || state.previewMode === mode) return;
  state.previewMode = mode;
  renderPreviewMode();
  updateWorkbenchUrl();
  updateFrameUrls({ preserveStoreState: true });
  syncPreviewContext();
}
```

Do not add a transition, loading spinner, crossfade, or artificial delay. This
interaction is a frequently repeated mode switch; its correct motion treatment
is to remove the expensive navigation and make the response immediate.

## Repo conventions to follow

- The project uses plain inline JavaScript and CSS for the workbench; do not add
  a frontend framework or dependency.
- Parent-to-storefront messages go through `sendShopMessage` at
  `order-service/src/main/resources/static/business.html:2847` and validate the
  same origin on both sides.
- `syncPreviewContext` at
  `order-service/src/main/resources/static/business.html:2294` is the existing
  parent helper. The `shop-ready` handler at `business.html:3212` already calls
  it again, covering a user toggle that happens before the child is ready.
- The storefront consumes the message at
  `order-service/src/main/resources/static/shop.html:2231`; no child-side change
  is required.
- Static frontend contracts are verified with AssertJ source assertions in
  `order-service/src/test/java/demo/order/OrderControllerTest.java:393`.

## Steps

1. In `order-service/src/main/resources/static/business.html`, change
   `updateFrameUrls` so only a missing `src` or changed business scene assigns
   `els.shopFrame.src`. Remove the `previewChanged` local and the
   `options.reloadPreview` condition. Set
   `els.shopFrame.dataset.previewMode = state.previewMode` after the conditional
   so metadata stays current even when no navigation occurs.
2. In the same file, change `setPreviewMode` to call
   `updateFrameUrls({ preserveStoreState: true })` without `reloadPreview`, then
   call `syncPreviewContext()` after the parent URL and standalone link are
   updated.
3. In
   `order-service/src/test/java/demo/order/OrderControllerTest.java`, update the
   `businessSource` assertions near lines 619–623:
   - require `updateFrameUrls({ preserveStoreState: true });`;
   - retain the assertion for
     `els.shopFrame.dataset.previewMode = state.previewMode`;
   - reject `reloadPreview: true` and
     `const previewChanged = els.shopFrame.dataset.previewMode !== state.previewMode`;
   - require that the source still contains the existing
     `sendShopMessage('set-preview-context', {` contract.
4. Do not change `SHOP_BUILD_ID`: neither the storefront assets nor the
   parent/child protocol changes in this plan.

## Boundaries

- Do NOT change `order-service/src/main/resources/static/shop.html`.
- Do NOT change `order-service/src/main/resources/static/assets/storefront.css`.
- Do NOT change Toast placement or Toast animation behavior.
- Do NOT modify the preview shell's `width`, `height`, or `border-radius`
  transition in this plan; that is a separate motion-performance finding.
- Do NOT add dependencies, a new message type, timers, loaders, crossfades, or
  keyframes.
- Do NOT weaken same-origin checks or remove the `shop-ready` fallback sync.
- Do NOT touch the unrelated existing change in
  `observability/datakit-values.example.yaml`.
- If the cited functions have drifted from the excerpts stamped at commit
  `6b59c00`, STOP and report the drift instead of improvising.

## Verification

- **Mechanical**:
  - Run `mvn -pl order-service -Dtest=OrderControllerTest test` from the
    repository root; expect a zero exit code and no failed tests.
  - Run
    `rg -n "reloadPreview|previewChanged|setPreviewMode|syncPreviewContext" order-service/src/main/resources/static/business.html`;
    expect no `reloadPreview` or preview-change reload branch, and expect the
    mode setter to call `syncPreviewContext()`.
- **Runtime / feel check**:
  1. Start the documented local stack with `docker compose up --build -d` and
     open `http://127.0.0.1:8080/business.html`.
  2. In the embedded storefront, navigate away from Home, enter a search query,
     and change cart state.
  3. In DevTools Network, enable Preserve log and filter to `Doc` or
     `shop.html`. Toggle Web/mobile ten times. Confirm no new storefront document
     request, no white/blank iframe flash, and no multi-second wait.
  4. Confirm the selected tab, parent `?view=...` query, standalone-shop link,
     phone/browser shell, and child
     `document.documentElement.dataset.previewMode` all match each toggle.
  5. Confirm page, search, and cart state survive all toggles.
  6. Reload the workbench once and confirm the iframe still performs its initial
     navigation and reaches `shop-ready`.
  7. Record one toggle in DevTools Performance. No slow-motion animation review
     is needed because this plan intentionally adds no motion; confirm there is
     no iframe navigation task or blank frame between the two settled layouts.
- **Reduced motion**: Not applicable; this plan introduces no animation. The
  behavior must be identical with `prefers-reduced-motion` enabled.
- **Done when**: All mechanical checks pass, ten repeated toggles produce zero
  `shop.html` document requests, state is preserved, and initial loading plus
  real scene changes still navigate correctly.
