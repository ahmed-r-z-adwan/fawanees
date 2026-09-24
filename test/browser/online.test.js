// Two devices, one game. Everything here runs two real browser pages against a real public broker,
// because the whole feature is about what one page learns about the other and nothing short of two
// pages can show that.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const puppeteer = require('puppeteer');
const { serve } = require('../tools/serve.js');

const DIST = path.join(__dirname, '..', '..', 'dist');
const LONG = 45000;

const FONTS = /fonts\.(googleapis|gstatic)\.com/;

async function open(browser, url) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    const from = (m.location() || {}).url || '';
    if (m.type() === 'error' && !FONTS.test(m.text()) && !FONTS.test(from)) errors.push('console: ' + m.text());
  });
  // The webfont stylesheet is render-blocking, so on a connection that cannot reach Google the
  // page's own script does not run until the request gives up -- half a minute of nothing. This
  // test is about what one device learns about another, so refuse the fonts and get on with it.
  await page.setRequestInterception(true);
  page.on('request', r => (FONTS.test(r.url()) ? r.abort() : r.continue()).catch(() => {}));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('window.__fw && window.__fw.game');
  await page.evaluate(() => { const d = document.querySelector('dialog[open]'); if (d) d.close(); });
  page.errors = errors;
  return page;
}

const until = async (page, expr, ms, what) => {
  try { await page.waitForFunction(expr, { timeout: ms, polling: 200 }); }
  catch (e) { throw new Error('timed out waiting for ' + what + ' (' + expr + ')'); }
};

// The relay is a free public service, so a run can fail for reasons that are nothing to do with
// this code. Say which it was rather than reporting a green suite or a misleading red one.
const isBroker = (e) => /timed out waiting for (host online|joiner online)/.test(e.message);

test('two devices: a room, a waiting friend, moves both ways, and a goodbye', { timeout: LONG * 3 }, async (t) => {
  const server = await serve(DIST);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    // ---- one player opens a room
    const a = await open(browser, server.url + '/fawanees.html');
    await a.evaluate(() => { window.__fw.newGame({ mode: 'online' }); window.__fw.online().host(); });
    await until(a, "window.__fw.online().status === 'online'", LONG, 'host online');
    const room = await a.evaluate(() => window.__fw.online().room);
    assert.ok(/^[0-2][a-z2-9]{7}$/.test(room), 'room id should name its broker and be random: ' + room);
    t.diagnostic('room ' + room);

    // The link is the room, and it is in the address bar so a reload rejoins rather than restarts.
    assert.strictEqual(await a.evaluate(() => location.search), '?r=' + room);

    // ---- nobody there yet: it says so, and there is nothing to play
    assert.strictEqual(await a.evaluate(() => window.__fw.online().peerHere), false);
    const waiting = await a.evaluate(() => ({
      cls: document.getElementById('peerRow').className,
      text: document.getElementById('peerText').textContent,
      code: document.getElementById('roomCode').textContent,
      shown: !document.getElementById('roomCode').hidden,
    }));
    assert.match(waiting.cls, /waiting/, 'the dot should show we are waiting');
    assert.ok(waiting.text.length > 0, 'the waiting room should say what it is waiting for');
    assert.strictEqual(waiting.code, room.slice(1).toUpperCase(), 'the room code should be readable aloud');
    assert.ok(waiting.shown, 'the code is worth showing while nobody has joined');

    // ---- the friend opens the link
    const b = await open(browser, server.url + '/fawanees.html?r=' + room);
    await until(b, "window.__fw.online().status === 'online'", LONG, 'joiner online');
    await until(a, 'window.__fw.online().peerHere', LONG, 'the host to see the friend arrive');
    await until(b, 'window.__fw.online().peerHere', LONG, 'the friend to see the host');
    assert.strictEqual(await a.evaluate(() => window.__fw.online().seat), 'a');
    assert.strictEqual(await b.evaluate(() => window.__fw.online().seat), 'b');
    assert.match(await a.evaluate(() => document.getElementById('peerRow').className), /here/);

    // ---- the seats are opposite colours, and only the side to move may play
    assert.strictEqual(await a.evaluate(() => window.__fw.online().colour()), 1);
    assert.strictEqual(await b.evaluate(() => window.__fw.online().colour()), 2);
    assert.strictEqual(await b.evaluate(() => document.getElementById('btnPass').disabled), true,
      'the player who is not to move should not be able to act');
    assert.strictEqual(await a.evaluate(() => document.getElementById('btnPass').disabled), false);

    // ---- a move crosses
    await a.evaluate(() => window.__fw.playMove(45));
    await until(b, 'window.__fw.game.board[45] === 1', LONG, "the friend to see the host's lantern");
    await until(b, 'window.__fw.game.toMove === 2', LONG, 'the turn to pass to the friend');
    await until(b, "document.getElementById('btnPass').disabled === false", LONG, 'the friend to be allowed to move');

    // ---- and back
    await b.evaluate(() => window.__fw.playMove(20));
    await until(a, 'window.__fw.game.board[20] === 2', LONG, "the host to see the friend's lantern");
    assert.strictEqual(await a.evaluate(() => window.__fw.game.history.length), 2);

    // The machine must never step in for an absent person.
    await new Promise(r => setTimeout(r, 1200));
    assert.strictEqual(await a.evaluate(() => window.__fw.game.history.length), 2,
      'nothing should move on its own while the two people are thinking');
    assert.strictEqual(await b.evaluate(() => window.__fw.game.history.length), 2);

    // ---- a third person on the same link is noticed rather than silently seated
    const c = await open(browser, server.url + '/fawanees.html?r=' + room);
    await until(c, "window.__fw.online().status === 'online'", LONG, 'gatecrasher online');
    await until(b, "document.getElementById('toast').classList.contains('show')", LONG,
      'the seated player to be told someone else opened the link');
    await c.close();

    // ---- leaving is the thing the other side must find out about
    await b.close();
    await until(a, '!window.__fw.online().peerHere', LONG, 'the host to notice the friend left');
    assert.match(await a.evaluate(() => document.getElementById('peerRow').className), /gone/,
      'having been here and gone is not the same as never having arrived');
    assert.ok((await a.evaluate(() => document.getElementById('peerText').textContent)).length > 0);

    assert.deepStrictEqual(a.errors, []);
  } catch (e) {
    if (isBroker(e)) { t.skip('no public broker reachable from here: ' + e.message); return; }
    throw e;
  } finally {
    await browser.close();
    await server.close();
  }
});

test('leaving the room puts the page back to a normal game', { timeout: LONG }, async (t) => {
  const server = await serve(DIST);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const a = await open(browser, server.url + '/fawanees.html');
    await a.evaluate(() => { window.__fw.newGame({ mode: 'online' }); window.__fw.online().host(); });
    await until(a, "window.__fw.online().status === 'online'", LONG, 'host online');
    await a.evaluate(() => document.getElementById('btnLeave').click());
    assert.strictEqual(await a.evaluate(() => window.__fw.online().active()), false);
    assert.strictEqual(await a.evaluate(() => location.search), '', 'the room should leave the address bar too');
    assert.strictEqual(await a.evaluate(() => document.getElementById('linkBar').hidden), true);
    assert.deepStrictEqual(a.errors, []);
  } catch (e) {
    if (isBroker(e)) { t.skip('no public broker reachable from here: ' + e.message); return; }
    throw e;
  } finally {
    await browser.close();
    await server.close();
  }
});

// ---- the awkward cases ----------------------------------------------------
// These drive one real page and one relay client straight from Node, which is the only way to
// say "now send exactly this" -- a second browser page will only ever send correct things.
const Relay = require('../../src/relay.js');
const code = (bytes) => Buffer.from(bytes).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const settle = (ms) => new Promise(r => setTimeout(r, ms));

async function hostPage(browser, server) {
  const a = await open(browser, server.url + '/fawanees.html');
  await a.evaluate(() => { window.__fw.newGame({ mode: 'online' }); window.__fw.online().host(); });
  await until(a, "window.__fw.online().status === 'online'", LONG, 'host online');
  return a;
}

function guest(room, onState) {
  const seen = [];
  const c = Relay.join({
    room, seat: 'b',
    onState: (s) => { seen.push(s); if (onState) onState(s); },
  });
  c.seen = seen;
  return c;
}

const waitFor = async (fn, ms, what) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return; await settle(150); }
  throw new Error('timed out waiting for ' + what);
};

test('a position that arrives from behind cannot rewind the game', { timeout: LONG * 2 }, async (t) => {
  const server = await serve(DIST);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  let g = null;
  try {
    const a = await hostPage(browser, server);
    const room = await a.evaluate(() => window.__fw.online().room);
    g = guest(room);
    await until(a, 'window.__fw.online().peerHere', LONG, 'the page to see the guest');

    // Two lanterns down, one from each side.
    await a.evaluate(() => window.__fw.playMove(45));
    await waitFor(() => g.seen.includes(code([45])), LONG, 'the guest to get the first move');
    g.publish(code([45, 20]));
    await until(a, 'window.__fw.game.history.length === 2', LONG, 'the page to take the reply');

    // Now the broker hands back what it was holding while we were away -- one move behind.
    // Taking it would silently undo a move that has already been played and seen.
    g.publish(code([45]));
    await settle(2500);
    assert.strictEqual(await a.evaluate(() => window.__fw.game.history.length), 2,
      'the page must keep the longer history');
    await waitFor(() => g.seen[g.seen.length - 1] === code([45, 20]), LONG,
      'and must answer with it, so the device that fell behind catches up');

    // A position no sequence of legal moves can reach is not a position.
    const before = await a.evaluate(() => window.__fw.game.history.length);
    g.publish(code([45, 45]));                       // a second lantern on an occupied cell
    await settle(2000);
    assert.strictEqual(await a.evaluate(() => window.__fw.game.history.length), before,
      'an impossible position should be ignored, not played');
    g.publish('!!!not base64!!!');
    await settle(1500);
    assert.strictEqual(await a.evaluate(() => window.__fw.game.history.length), before);
    assert.deepStrictEqual(a.errors, []);
  } catch (e) {
    if (isBroker(e)) { t.skip('no public broker reachable from here: ' + e.message); return; }
    throw e;
  } finally {
    try { g && g.leave(); } catch (e) {}
    await browser.close();
    await server.close();
  }
});

test('reloading puts you back in your own chair, in the same game', { timeout: LONG * 2 }, async (t) => {
  const server = await serve(DIST);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  let g = null;
  try {
    const a = await hostPage(browser, server);
    const room = await a.evaluate(() => window.__fw.online().room);
    g = guest(room);
    await until(a, 'window.__fw.online().peerHere', LONG, 'the page to see the guest');
    await a.evaluate(() => window.__fw.playMove(45));
    await waitFor(() => g.seen.includes(code([45])), LONG, 'the guest to get the move');
    g.publish(code([45, 20]));
    await until(a, 'window.__fw.game.history.length === 2', LONG, 'the reply to land');

    await a.reload({ waitUntil: 'domcontentloaded' });
    await a.waitForFunction('window.__fw && window.__fw.game');
    await until(a, "window.__fw.online().status === 'online'", LONG, 'host online again');
    assert.strictEqual(await a.evaluate(() => window.__fw.online().seat), 'a',
      'a refresh must not move you into the other player\'s seat');
    await until(a, 'window.__fw.game.history.length === 2', LONG, 'the position to come back');
    assert.strictEqual(await a.evaluate(() => window.__fw.game.board[45]), 1);
    assert.strictEqual(await a.evaluate(() => window.__fw.online().colour()), 1);
  } catch (e) {
    if (isBroker(e)) { t.skip('no public broker reachable from here: ' + e.message); return; }
    throw e;
  } finally {
    try { g && g.leave(); } catch (e) {}
    await browser.close();
    await server.close();
  }
});

test('a rematch keeps the room, so the link does not have to be sent again', { timeout: LONG * 2 }, async (t) => {
  const server = await serve(DIST);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  let g = null;
  try {
    const a = await hostPage(browser, server);
    const room = await a.evaluate(() => window.__fw.online().room);
    g = guest(room);
    await until(a, 'window.__fw.online().peerHere', LONG, 'the page to see the guest');
    await a.evaluate(() => window.__fw.playMove(45));
    await waitFor(() => g.seen.includes(code([45])), LONG, 'the guest to get the move');

    await a.evaluate(() => window.__fw.newGame({ mode: 'online' }));
    assert.strictEqual(await a.evaluate(() => window.__fw.online().room), room, 'same room');
    assert.strictEqual(await a.evaluate(() => window.__fw.game.history.length), 0, 'fresh board');
    await waitFor(() => g.seen[g.seen.length - 1] === '', LONG, 'the other device to be reset too');
    assert.strictEqual(await a.evaluate(() => window.__fw.online().peerHere), true,
      'and to still be in the room afterwards');
    assert.deepStrictEqual(a.errors, []);
  } catch (e) {
    if (isBroker(e)) { t.skip('no public broker reachable from here: ' + e.message); return; }
    throw e;
  } finally {
    try { g && g.leave(); } catch (e) {}
    await browser.close();
    await server.close();
  }
});

test('the swap rule and passing cross between devices', { timeout: LONG * 2 }, async (t) => {
  const server = await serve(DIST);
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  let g = null;
  try {
    const a = await hostPage(browser, server);
    const room = await a.evaluate(() => window.__fw.online().room);
    g = guest(room);
    await until(a, 'window.__fw.online().peerHere', LONG, 'the page to see the guest');

    await a.evaluate(() => window.__fw.playMove(45));
    await waitFor(() => g.seen.includes(code([45])), LONG, 'the opening lantern to cross');
    assert.strictEqual(await a.evaluate(() => window.__fw.game.toMove), 2, 'turquoise to answer');

    // The second player takes the opening lantern instead of answering it (92 is the swap).
    g.publish(code([45, 92]));
    await until(a, 'window.__fw.game.history.length === 2', LONG, 'the swap to arrive');
    assert.strictEqual(await a.evaluate(() => window.__fw.game.board[45]), 2,
      'the opening lantern should now belong to the player who took it');
    assert.strictEqual(await a.evaluate(() => window.__fw.game.toMove), 1,
      'and the opener moves again');
    assert.strictEqual(await a.evaluate(() => document.getElementById('btnSwap').hidden), true,
      'the offer is gone once it has been taken');

    // Passing (91) crosses just as well.
    await a.evaluate(() => window.__fw.playMove(-1));
    await waitFor(() => g.seen.includes(code([45, 92, 91])), LONG, 'the pass to cross');
    g.publish(code([45, 92, 91, 30]));
    await until(a, 'window.__fw.game.board[30] === 2', LONG, 'the reply to the pass');
    assert.deepStrictEqual(a.errors, []);
  } catch (e) {
    if (isBroker(e)) { t.skip('no public broker reachable from here: ' + e.message); return; }
    throw e;
  } finally {
    try { g && g.leave(); } catch (e) {}
    await browser.close();
    await server.close();
  }
});
