// Keep the browser tests off the font CDN.
//
// The page asks Google Fonts for its typefaces through a render-blocking stylesheet, so on a
// connection that cannot reach Google the page's own script does not run until that request gives
// up -- half a minute of nothing, and then a suite failing for a reason that has nothing to do
// with the game. The game plays perfectly well in a fallback font, which is exactly why the tests
// should not be the only part of the project that cannot start without a font server.
//
// So: refuse the request rather than wait for it, and ignore the console noise refusing it makes.
// Requests are still *observed* -- a test that checks which hosts the page reaches out to still
// sees the attempt.
const FONTS = /fonts\.(googleapis|gstatic)\.com/;

// Puppeteer.
async function noFonts(page) {
  await page.setRequestInterception(true);
  page.on('request', r => (FONTS.test(r.url()) ? r.abort() : r.continue()).catch(() => {}));
}

// Playwright.
async function noFontsPW(page) {
  await page.route(FONTS, r => r.abort());
}

// True for a console message that is a real error from the page rather than the refusal above.
// Works for both drivers: each gives the message a type and a location.
const isPageError = (m) => {
  if (m.type() !== 'error') return false;
  let from = '';
  try { from = (m.location() || {}).url || ''; } catch (e) {}
  return !FONTS.test(m.text()) && !FONTS.test(from);
};

module.exports = { FONTS, noFonts, noFontsPW, isPageError };
