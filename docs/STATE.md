# Where this stands — 24 September 2026

Stopped here at Ahmed's request. Everything below is committed and pushed to
`ahmed-r-z-adwan/fawanees` (public). Nothing lives only on the laptop.

## Live

**https://ahmed-r-z-adwan.github.io/fawanees/** — public, on GitHub Pages, deployed by
`.github/workflows/pages.yml` on every push to `master`. Verified playing on real WebKit
(iPhone 14) and Chromium with Pixel 7 emulation, against the published URL, service worker active
on both.

Also: `dist/fawanees.html`, one self-contained file that works from disk, and a Windows desktop
shortcut (`tools/desktop-shortcut.ps1`).

## Done

All eight steps of the original brief, plus deployment:

| | |
|---|---|
| 1 | search on a worker, live search view — page never blocks (1003 ms → 0 ms) |
| 2 | six-lesson interactive tutorial, every number read from the engine |
| 3 | balance: 16,380 games, every opening × every reply; policy generated from it |
| 4 | win meter fitted on 118,168 positions; reliability gap 17.3 → 3.1 points |
| 5 | phone speed: Master answers in 1.006 s on a throttled core; engine 2.8–3.5× faster |
| 6 | 65 unit tests, 34 browser tests |
| 7 | installable offline copy, now with iOS home-screen support |
| 8 | 16 puzzles mined from the machine's own games |
| — | public repo, Pages, README, WebKit + Android tests, in-page install offer |

Written up in [REPORT.md](REPORT.md), [BALANCE.md](BALANCE.md), [SPEED.md](SPEED.md),
[METHOD.md](METHOD.md).

## Test state, honestly

- **Unit: 65 pass, 0 fail.** Stable.
- **Browser: 33 of 34 on the last full run.** The one failure was
  `speed.test.js › the page still does not freeze on a throttled phone`, which **passes when run
  alone** (worst long task 50 ms against a 250 ms bound). It is load-sensitive: a full suite of
  headless browsers competing for the CPU changes what it measures.

Three sibling tests in this family were already re-pointed at the claim rather than the machine
(median answer time instead of worst case; long-task count instead of frame count). **This last one
has not been.** That is the first thing to do.

## Next, in order

1. **Fix the last load-sensitive test.** `test/browser/speed.test.js`, the throttled freeze check.
   The long-task assertion is the real claim and should stay strict; what needs rethinking is
   running a 4×-throttled measurement at the tail of a suite that has just run thirty browsers.
   Options: give it its own run, or settle the machine before measuring.
2. **Confirm two consecutive clean full suites** before calling it done.
3. **Decide whether an Android APK is wanted.** Ahmed asked for "كتطبيق" and got the PWA install
   offer, which covers both platforms. A real `.apk` is possible via Bubblewrap (a Trusted Web
   Activity wrapping the Pages site, needs JDK + Android SDK + a signing key, and an
   `assetlinks.json` on the site to hide the URL bar). **An iOS `.ipa` is not possible** without an
   Apple Developer account, so the home-screen install is the app on iPhone either way.

## Known and deliberately open

- The **last-lead-change target (40%) is not met** at 37.4% ± 1.0. Ahmed chose to keep K=3 rather
  than switch to K=4; reasons and the full variant table are in BALANCE.md.
- If K=4 is ever reconsidered, the **edge fortress** must be measured first: the six corner cells
  have only three lines, so under K=4 they could never be captured at all.
- **Puzzle mode has no keyboard cell-navigation.** Hint → hint (reveal) is the only keyboard route
  through a puzzle. The tutorial does have a keyboard route.
- **Five findings from the release review were never judged** — their verifier agents died when
  credits ran out mid-run. The review's journal is at
  `.claude/projects/…/workflows/wf_6a6261b8-9a0/journal.jsonl` if they are worth revisiting.
- The header wraps to two rows on a phone now that it carries five buttons.

## How to pick it back up

```bash
npm install            # puppeteer and playwright fetch their own browsers
npm test               # 65 unit, 34 browser
python build.py        # dist/fawanees.html and pwa/, from src/
```

The four generated files under `src/` must be regenerated, never hand-edited — see
[CLAUDE.md](../CLAUDE.md).
