// Keep the browser tests off the font CDN.
//
// The page asks Google Fonts for its typefaces through a render-blocking stylesheet, so on a
// connection that cannot reach Google the page's own script does not run until that request gives
// up -- half a minute of nothing, and then a suite failing for a reason that has nothing to do
// with the game. The game plays perfectly well in a fallback font, which is exactly why the tests
// should not be the only part of the project that cannot start without a font server.
//
// The request is *answered* with an empty stylesheet rather than refused. Refusing works, but it
// makes the browser log a failed-resource error, and WebKit attributes that error to the document
// rather than to the font URL -- so a test that rightly insists on a clean console fails for a
// resource the test itself took away. An empty stylesheet is a perfectly good answer: nothing is
// pending, nothing is logged, and no font files are asked for because the CSS names none.
//
// Requests are still *observed*, so a test that checks which hosts the page reaches out to still
// sees the attempt.
const FONTS = /fonts\.(googleapis|gstatic)\.com/;
const EMPTY_CSS = { status: 200, contentType: 'text/css', body: '/* fonts left out for tests */' };

// Puppeteer.
async function noFonts(page) {
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const done = FONTS.test(r.url()) ? r.respond(EMPTY_CSS) : r.continue();
    if (done && done.catch) done.catch(() => {});      // the page can go away mid-flight
  });
}

// Playwright.
async function noFontsPW(page) {
  await page.route(FONTS, (r) => r.fulfill(EMPTY_CSS).catch(() => {}));
}

// True for a console message that is a real error from the page. Nothing should be filtered now
// that the fonts are answered rather than refused, but a driver that reports it differently
// should not be able to turn a passing suite red over a typeface.
const isPageError = (m) => {
  if (m.type() !== 'error') return false;
  let from = '';
  try { from = (m.location() || {}).url || ''; } catch (e) {}
  return !FONTS.test(m.text()) && !FONTS.test(from);
};

module.exports = { FONTS, noFonts, noFontsPW, isPageError };
