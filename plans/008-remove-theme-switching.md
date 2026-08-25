# 008 — Remove theme switching

- **Status**: DONE
- **Priority**: MEDIUM
- **Scope**: Web workbench, Web storefront, shared storefront copy, React Native storefront, and their tests

## Problem

The demo renders colorful by default but still carries a second white
appearance through URL parameters, browser and mobile persistence, parent-child
messages, hidden Web controls, mobile controls, CSS overrides, generated book
covers, translated labels, and a RUM action. Keeping this dormant branch makes
every preview URL longer and leaves an unused product choice to maintain.

## Target

- Colorful is the only storefront appearance on Web and React Native.
- Workbench and standalone-shop URLs do not contain `theme`.
- Web no longer reads, persists, renders, or exchanges theme state.
- Remove the hidden Web theme picker, white CSS overrides, white cover palette,
  and theme-only translated strings.
- React Native uses one exported colorful token object and no longer stores,
  hydrates, switches, or reports a theme value.
- Preserve language, preview mode, navigation, cart state, RUM initialization,
  Session Replay privacy attributes, and all fault behavior.

## Steps

1. Remove theme initialization, state, URL writes, storage, parent-child
   messages, picker markup, picker listeners, and picker styles from Web.
2. Simplify shared product text and generated legacy covers to the colorful
   data only.
3. Replace React Native theme lookup with one colorful token export; remove
   theme state, persistence, header control, and RUM action.
4. Update Web, gateway, reducer, storage, and token tests to reject the removed
   theme contract and preserve remaining behavior.
5. Run source searches, Java tests, Web script parsing, mobile tests, type
   checking, lint, Docker rebuild, and browser URL/visual checks.

## Boundaries

- Do not rename the unrelated mobile `whiteScreen` fault.
- Do not change colorful values, layout, wording outside theme controls, RUM
  setup, Replay privacy markers, cart persistence, or preview switching.
- Do not add a dependency or compatibility redirect.

## Verification

- No generated or updated Web URL contains `theme`.
- No `data-demo-theme`, white appearance value, theme storage key, theme
  picker, theme message, or theme-switch RUM action remains.
- Web and mobile tests pass and both surfaces still use the existing colorful
  values.
