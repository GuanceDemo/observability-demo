# Animation improvement plans

| # | Plan | Severity | Status | Dependencies |
| --- | --- | --- | --- | --- |
| 001 | [Switch preview modes without reloading the storefront](001-preview-mode-without-reload.md) | HIGH | DONE | None |
| 002 | [Remove layout-bound workbench motion](002-remove-layout-bound-workbench-motion.md) | HIGH | DONE | 001 |
| 003 | [Make the Toast lifecycle interruptible](003-make-toast-lifecycle-interruptible.md) | HIGH | DONE | None |
| 004 | [Tighten Web press and hover feedback](004-tighten-web-press-and-hover-feedback.md) | MEDIUM | DONE | None |
| 005 | [Make Web dialogs motion- and focus-safe](005-make-web-dialogs-motion-and-focus-safe.md) | HIGH | DONE | None |
| 006 | [Complete keyboard behavior for Web selection groups](006-complete-keyboard-behavior-for-web-tablists.md) | HIGH | DONE | None |
| 007 | [Finish native fault-drawer motion](007-finish-native-fault-drawer-motion.md) | HIGH | DONE | None |
| 008 | [Remove theme switching](008-remove-theme-switching.md) | MEDIUM | DONE | None |

## Recommended execution order

1. **002** — remove layout animation left behind around the now-stable preview.
2. **003** — make Toast entry/exit reliable while preserving its exact position.
3. **006** — fix tablist keyboard behavior without introducing motion.
4. **005** — add interruptible dialog motion together with focus containment.
5. **004** — normalize press/hover feedback after the shared easing tokens exist.
6. **007** — finish the native fault drawer independently of the Web changes.

Plans 003–007 do not have hard code dependencies. The order above minimizes
token churn and lands accessibility fixes before lower-severity hover polish.

## Scope note

Toast placement remains centered by explicit user decision. Plan 003 changes
only its lifecycle. The plans preserve the existing in-document overlays and
privacy attributes so RUM Session Replay keeps observing the same UI structure.

## Deferred candidates

These findings are valid but need a separate product decision or prototype
before implementation:

| Candidate | Why deferred |
| --- | --- |
| Animate the workbench tablet drawer at the 820–1199px breakpoint | Breakpoint ownership and overlay behavior need a responsive-layout decision first. |
| Crossfade usage-guide slide images | Low-value polish; keep slide navigation crisp until the dialog lifecycle lands. |
| Add follow-finger Web and native app-level back gestures | Needs a gesture prototype covering velocity, scroll conflict, cancellation, and accessibility. |
| Replace the native app's static loading glyph with a real progress indicator | Separate feedback-state task, not part of the fault drawer. |
| Preserve focus across quantity-stepper rerenders | Accessibility follow-up outside animation scope. |
