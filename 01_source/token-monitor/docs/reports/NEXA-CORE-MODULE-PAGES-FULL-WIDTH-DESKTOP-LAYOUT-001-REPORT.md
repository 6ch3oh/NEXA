# NEXA Core Module Pages Full-Width Desktop Layout 001

## Result

PASS. The shared module shell no longer constrains business pages to a centered 1180px column. All ten L1 pages use the desktop canvas at 1600×900, 1440×900, and the clean-profile Electron default 1182×803.

## Root cause and fix

The legacy wide-screen shell rule increased the shell's horizontal padding with `calc((100vw - 1180px) / 2)`. Page-level full-width rules therefore remained full-width only inside a capped shell. The r4 override restores the module/settings shell to its normal 14px edge padding, gives module roots an uncapped width, and applies a shared 24–26px inner page gutter. The Learning module's own UI cap was removed with a minimal CSS change.

## Verification

- Coverage: 10/10 L1 pages, 30 real DOM measurements.
- 1600×900 content ratio range: 0.9401–0.9825.
- 1440×900 content ratio range: 0.9356–0.9806.
- Default 1182×803 content ratio range: 0.9216–0.9763.
- Horizontal overflow: 0 across all measurements.
- Home regression: 0; root ratio 0.9729, nested card scrollers 0.
- Screenshots: 12/12.
- Focused layout tests: 3 passed.
- Affected Core renderer tests: 142 passed.
- Learning focused tests: 2 passed.
- Core lint: passed.
- Core full verify: 2959 passed, 0 failed, 2 skipped.
- Production package: passed with the offline-safe Electron builder configuration; exact-build URL check passed.

## Artifacts

- Build: `dist-product-ux-wave007-fullwidth-r4\win-unpacked`
- Preserved baseline: `dist-product-ux-wave007-home-density-r3`
- DOM evidence: `docs/acceptance/fullwidth-r4-final/layout-evidence.json`
- Comparison: `docs/acceptance/fullwidth-r4-final/comparison-reference-vs-r4.png`
- Screenshots: `docs/acceptance/fullwidth-r4-final`

No business data layer, network configuration, credentials, or secrets were changed or exposed.
