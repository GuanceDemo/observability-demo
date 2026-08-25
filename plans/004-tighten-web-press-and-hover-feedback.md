# 004 — Tighten Web press and hover feedback

- **Status**: DONE
- **Commit**: 6b59c00
- **Severity**: MEDIUM
- **Category**: Physicality / accessibility / cohesion
- **Estimated scope**: 3 files, approximately 45–70 changed lines

## Problem

Workbench buttons animate a global lift, filter, and shadow on every hover,
including high-frequency tabs. The motion is not gated to fine pointers and
animates paint-heavy properties. Storefront buttons have the opposite problem:
they explicitly suppress transforms and provide no press response.

`order-service/src/main/resources/static/business.html:64`:

```css
/* current */
button {
  transition: transform .14s ease, filter .14s ease, box-shadow .14s ease;
}

button:hover {
  filter: brightness(.98);
  transform: translateY(-1px);
  box-shadow: 0 10px 22px rgba(23, 112, 230, .18);
}
```

`order-service/src/main/resources/static/assets/storefront.css:191`:

```css
/* current */
.storefront button {
  transition: border-color .15s ease, color .15s ease, background-color .15s ease;
}

.storefront button:hover,
.storefront button:focus-visible {
  filter: none;
  transform: none;
}
```

Moving card hovers at `storefront.css:1930` and `storefront.css:3800` are also
active on touch-capable pointers. The persistent `.prototype-topic-button.active`
state is incorrectly coupled to the same `translateY(-1px)` used for hover.

## Target

Use subtle, GPU-only press feedback and reserve hover movement for fine
pointers. Add exact easing tokens if plan 003 has not already added the
storefront token:

```css
/* business.html :root */
--gc-ease-out: cubic-bezier(0.23, 1, 0.32, 1);

/* storefront.css :root; reuse if already present */
--store-ease-out: cubic-bezier(0.23, 1, 0.32, 1);
```

Workbench target:

```css
button {
  transition: transform 140ms var(--gc-ease-out);
}

button:not(.drawer-backdrop):not(.usage-guide-nav):active:not(:disabled) {
  transform: scale(.97);
}

@media (hover: hover) and (pointer: fine) {
  button:hover {
    filter: brightness(.98);
  }
}
```

Do not animate `filter` or `box-shadow`, and do not translate every button on
hover. Component-specific static hover colors and shadows may remain.

Storefront target:

```css
.storefront button {
  transition:
    transform 140ms var(--store-ease-out),
    border-color 150ms ease,
    color 150ms ease,
    background-color 150ms ease;
}

.storefront button:active:not(:disabled) {
  transform: scale(.97);
}

@media (hover: hover) and (pointer: fine) {
  .book-card:hover { transform: translateY(-2px); }
  .prototype-topic-button:hover { transform: translateY(-1px); }
}
```

Remove `transform` from the combined persistent
`.prototype-topic-button.active` rule. Selected topics use color/border only.

Reduced motion must preserve feedback without movement:

```css
@media (prefers-reduced-motion: reduce) {
  button:not(.drawer-backdrop):not(.usage-guide-nav):active:not(:disabled),
  .storefront button:active:not(:disabled),
  .book-card:hover,
  .prototype-topic-button:hover {
    transform: none;
  }
}
```

Keep existing focus-visible outlines unchanged.

## Repo conventions to follow

- The workbench and storefront have separate root token namespaces (`--gc-*`
  and `--store-*`); do not create a cross-file runtime dependency.
- Buttons already use CSS state selectors; keep feedback in CSS and do not add
  pointer event JavaScript.
- `.usage-guide-nav` uses `translateY(-50%)` for structural centering and must be
  excluded from the global active transform.
- `.drawer-backdrop` must never scale or inherit hover decoration.

## Steps

1. Add or reuse the exact strong ease-out token in both style roots.
2. In `business.html`, remove animated filter/shadow and the global hover lift;
   add the scoped 140ms `.97` press state and fine-pointer hover gate.
3. In `storefront.css`, add transform to the button transition and add the
   140ms `.97` active state after the existing hover reset so it wins the
   cascade.
4. Move the two translating hover rules into an exact
   `@media (hover: hover) and (pointer: fine)` block. Keep active topic styling
   stationary.
5. Add the reduced-motion override in each file.
6. Extend `OrderControllerTest` to require the pointer and reduced-motion media
   queries, both `.97` press rules, and the custom easing tokens; reject the old
   global `translateY(-1px)` workbench hover and animated `box-shadow`/`filter`.

## Boundaries

- Do NOT alter button sizes, colors, focus outlines, disabled states, labels, or
  click behavior.
- Do NOT apply active scaling to drawer backdrops or structurally translated
  navigation controls.
- Do NOT add press feedback to keyboard activation; browsers do not keep
  `:active` latched for keyboard-triggered high-frequency actions.
- Do NOT modify Toast lifecycle or placement; plan 003 owns it.
- Do NOT change card layout, selected topic semantics, or add JavaScript.
- Do NOT add dependencies or bump either build ID.
- If the cited selectors have drifted from commit `6b59c00`, STOP and report it.

## Verification

- **Mechanical**:
  - Run `mvn -pl order-service -Dtest=OrderControllerTest test`.
  - Run `git diff --check`.
  - Search for ungated translating `:hover` selectors and confirm none remain.
- **Feel check**:
  1. Mouse through workbench preview/fault controls and storefront purchase,
     cart, quantity, and navigation buttons. Hover must not make the whole
     dashboard bob; press must give a small, immediate `.97` compression.
  2. Hold and release a button, then press it repeatedly. The CSS transition
     must retarget smoothly without keyframe restarts.
  3. Emulate a touch device and confirm hover translation does not stick after a
     tap.
  4. At 10% playback, confirm only `transform` moves; filter, shadow, dimensions,
     and position do not animate.
  5. Enable reduced motion. Confirm press movement disappears while color,
     outline, and selected-state feedback remain.
- **Done when**: press feedback is consistent and subtle, moving hover is
  fine-pointer-only, selected controls do not float, reduced motion is honored,
  and all tests pass.
