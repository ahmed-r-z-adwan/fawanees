# Where this stands — 24 September 2026

Everything below is committed and pushed to `ahmed-r-z-adwan/fawanees` (public). Nothing lives only
on the laptop.

## Live

**https://ahmed-r-z-adwan.github.io/fawanees/** — public, on GitHub Pages, deployed by
`.github/workflows/pages.yml` on every push to `master`.

Also: `dist/fawanees.html`, one self-contained file that works from disk, and a Windows desktop
shortcut (`tools/desktop-shortcut.ps1`).

## Done

All eight steps of the original brief, plus deployment, plus playing a friend on another device:

| | |
|---|---|
| 1 | search on a worker, live search view — page never blocks (1003 ms → 0 ms) |
| 2 | six-lesson interactive tutorial, every number read from the engine |
| 3 | balance: 16,380 games, every opening × every reply; policy generated from it |
| 4 | win meter fitted on 118,168 positions; reliability gap 17.3 → 3.1 points |
| 5 | phone speed: Master answers in 1.006 s on a throttled core; engine 2.8–3.5× faster |
| 6 | 65 unit tests, 41 browser tests |
| 7 | installable offline copy, with iOS home-screen support |
| 8 | 16 puzzles mined from the machine's own games |
| — | public repo, Pages, README, WebKit + Android tests, in-page install offer |
| — | **two devices, one game**: a room, a waiting screen, presence both ways |

Written up in [REPORT.md](REPORT.md), [BALANCE.md](BALANCE.md), [SPEED.md](SPEED.md),
[METHOD.md](METHOD.md) and [ONLINE.md](ONLINE.md).

## Playing a friend

Sharing used to be a *position* in a link, so two people could open the same game and never be in
it together. It is a **room** now: open one, send the link once, and each of you sees the other
arrive, move, and leave. `docs/ONLINE.md` has the design, the broker measurements and the table of
what happens when things go wrong; `src/relay.js` is a hand-written MQTT client so the published
page stays one file.

Verified against the **published site** on a real WebKit iPhone 14 and an emulated Pixel 7: the
room opened, the link carried, both devices saw each other, a tap on one reached the other, the
reply came back, and closing one tab was noticed by the other.

## Test state

- **Unit: 65 pass, 0 fail.**
- **Browser: 41 pass, 0 fail** — the first fully green full run this project has had. That includes
  `speed.test.js › the page still does not freeze on a throttled phone`, which had been failing at
  the tail of a full suite and was the outstanding item on the last version of this page.

Three things were making the suite unrunnable or wrong, and all three are fixed:

- **The parse-integrity check called the share icon damage.** It looks for elements the parser
  invented out of broken markup by asking whether `createElement` can reproduce each tag name, and
  it cannot reproduce a genuine inline `<svg>`. Five tests were red for that reason alone — on all
  three cross-browser targets and in both integrity checks — and had been since the share button
  got its icon.
- **The tests could not start without Google Fonts.** The font stylesheet is render-blocking, so
  when the CDN is unreachable the page's own script does not run until the request gives up.
  `test/tools/nofonts.js` answers it with an empty stylesheet.
- **Two real bugs in the room**, found by the tests and described in the commits: a repaint that
  published the position from *before* the other player's move, and an animation that never
  finished in a hidden tab.

## Next, in order

1. **Nothing is known to be broken.** The next session should start by running `npm test` to
   confirm that is still true, because the online tests talk to real public brokers.
2. **Decide whether an Android APK is wanted.** Ahmed asked for "كتطبيق" and got the PWA install
   offer, which covers both platforms. A real `.apk` is possible via Bubblewrap (a Trusted Web
   Activity wrapping the Pages site, needs JDK + Android SDK + a signing key, and an
   `assetlinks.json` on the site to hide the URL bar). **An iOS `.ipa` is not possible** without an
   Apple Developer account, so the home-screen install is the app on iPhone either way.

## Known and deliberately open

- **The online feature depends on free public MQTT brokers**, and they are individually unreliable:
  one answered in 625 ms and in 9911 ms within the same minute. The client races all three when
  opening a room and waits 22 seconds for a slow one, which covers what has been measured, but a
  broker going down mid-game would strand that room — both players are pinned to it, because a
  link that landed them on different brokers would look connected and hear nothing. If this turns
  out to matter, the fix is a broker of one's own, not a fourth free one.
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
npm test               # 65 unit, 41 browser
python build.py        # dist/fawanees.html and pwa/, from src/
```

The four generated files under `src/` must be regenerated, never hand-edited — see
[CLAUDE.md](../CLAUDE.md). `src/relay.js` is hand-written and runs in Node as well as the browser,
which is how the awkward cases in `test/browser/online.test.js` are driven.
