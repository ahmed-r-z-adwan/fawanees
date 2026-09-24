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
