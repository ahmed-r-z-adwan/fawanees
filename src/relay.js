// Two devices, no backend.
//
// The page is a static file with nowhere to put a server, so for a game across two phones it
// borrows a public MQTT broker as a post box: both devices connect to the same broker over a
// secure WebSocket, subscribe to one room, and publish to it. The broker sees a random room id
// and a list of move numbers, nothing else.
//
// MQTT is used rather than WebRTC because it always connects. A peer-to-peer link is nicer in
// principle, but mobile carriers put phones behind NAT that a direct connection cannot cross
// without a relay of its own, so "it works on my wifi" turns into "it fails on my friend's data".
// A broker relays, so there is nothing to negotiate.
//
// Presence falls out of the protocol for free, which is the reason for the whole choice:
//
//   * A "last will and testament" is a message the broker publishes on your behalf when your
//     connection dies. Set it to "I am gone" and the other player finds out whether you closed
//     the tab, locked the phone, or walked out of signal.
//   * A "retained" message is kept by the broker and handed to whoever subscribes next, so the
//     player who arrives second is given the position immediately instead of waiting for a move.
//
// It is written by hand instead of pulling in a library because the published page stays one
// self-contained file, and the four packet types this needs are about two hundred lines.
(function (root) {
  'use strict';

  // Public brokers that take anonymous connections over wss. They are free test services, so any
  // one of them can be down; a room records which one it was opened on, because both players must
  // sit on the same broker to hear each other.
  const BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081/',
  ];

  const PREFIX = 'fawanees/v1/';
  const KEEPALIVE = 20;      // seconds. A peer that vanishes without warning is noticed in ~1.5x this.
  const EMPTY = '-';         // a game with no moves yet; an empty payload would delete the retained state

  const textEnc = new TextEncoder(), textDec = new TextDecoder();

  // ---------------- MQTT 3.1.1, the parts we use ----------------

  function mqttStr(s) {
    const b = textEnc.encode(s);
    const out = new Uint8Array(b.length + 2);
    out[0] = b.length >> 8; out[1] = b.length & 255;
    out.set(b, 2);
    return out;
  }

  function varint(n) {
    const out = [];
    do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; out.push(d); } while (n > 0);
    return Uint8Array.from(out);
  }

  function build(type, flags, parts) {
    let len = 0;
    for (const p of parts) len += p.length;
    const head = varint(len);
    const out = new Uint8Array(1 + head.length + len);
    out[0] = (type << 4) | flags;
    out.set(head, 1);
    let at = 1 + head.length;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }

  function connectPacket(clientId, will) {
    let flags = 0x02;                                        // clean session
    const payload = [mqttStr(clientId)];
    if (will) {
      flags |= 0x04 | 0x20;                                  // will flag, will retained, will QoS 0
      payload.push(mqttStr(will.topic), mqttStr(will.payload));
    }
    return build(1, 0, [mqttStr('MQTT'), Uint8Array.of(4), Uint8Array.of(flags),
                        Uint8Array.of(KEEPALIVE >> 8, KEEPALIVE & 255)].concat(payload));
  }

  const subscribePacket = (id, filter) =>
    build(8, 2, [Uint8Array.of(id >> 8, id & 255), mqttStr(filter), Uint8Array.of(0)]);

  const publishPacket = (topic, payload, retain) =>
    build(3, retain ? 1 : 0, [mqttStr(topic), textEnc.encode(payload)]);

  const PINGREQ = build(12, 0, []);
  const DISCONNECT = build(14, 0, []);

  // ---------------- one room ----------------

  const rnd = (n) => {
    let s = '';
    const abc = 'abcdefghijkmnpqrstuvwxyz23456789';         // no look-alikes: a room id gets read aloud
    const bytes = new Uint8Array(n);
    (root.crypto || {}).getRandomValues ? root.crypto.getRandomValues(bytes)
                                        : bytes.forEach((_, i) => { bytes[i] = (Math.random() * 256) | 0; });
    for (let i = 0; i < n; i++) s += abc[bytes[i] % abc.length];
    return s;
  };

  // A room id carries its broker in the first character, so a link always lands both players on
  // the same one. Failing over to another broker mid-game would silently split the two devices.
  const newRoomId = (brokerIndex) => String(brokerIndex) + rnd(7);
  const brokerOf = (roomId) => {
    const i = Number(roomId.charAt(0));
    return Number.isInteger(i) && i >= 0 && i < BROKERS.length ? i : 0;
  };

  function join(o) {
    const brokers = o.brokers || BROKERS;
    const WS = o.WebSocket || root.WebSocket;
    const url = brokers[o.brokerIndex != null ? o.brokerIndex : brokerOf(o.room)];
    const token = o.token || rnd(6);
    const base = PREFIX + o.room + '/';
    const seat = o.seat, other = o.seat === 'a' ? 'b' : 'a';
    const mine = base + 'p/' + seat, theirs = base + 'p/' + other, stateTopic = base + 's';
    const say = (name, arg) => { try { (o[name] || (() => {}))(arg); } catch (e) {} };

    let ws = null, buf = new Uint8Array(0), ping = null, retry = null, guard = null;
    let tries = 0, live = false, closed = false, peerOnline = false, current = null;
    // Which of the peer's connections we are hearing about. A reload gives them a new token, and
    // the will from the connection they just dropped arrives late -- often after the new one has
    // already said hello. Without this, every refresh on their phone reads as "they left".
    let peerToken = null, warnedAbout = null;

    const send = (bytes) => { if (ws && ws.readyState === 1) ws.send(bytes); };

    function open() {
      if (closed) return;
      say('onStatus', 'connecting');
      let sock;
      try { sock = new WS(url, 'mqtt'); } catch (e) { return drop(); }
      ws = sock;
      sock.binaryType = 'arraybuffer';
      // A broker that accepts the socket and then says nothing is the common failure; do not sit
      // on a half-open connection waiting for a CONNACK that is not coming.
      // Generous on purpose: one of these brokers has been measured taking nineteen seconds to
      // answer, and a joiner is pinned to whichever broker the link names. Giving up before it
      // replies would mean never connecting at all rather than connecting slowly.
      guard = setTimeout(() => { try { sock.close(); } catch (e) {} }, 22000);
      sock.onopen = () => send(connectPacket('fw-' + seat + '-' + token + '-' + rnd(5),
                                             { topic: mine, payload: '0:' + token }));
      sock.onmessage = (ev) => feed(new Uint8Array(ev.data));
      sock.onclose = () => { if (sock === ws) drop(); };
      sock.onerror = () => {};
    }

    function ready() {
      clearTimeout(guard);
      live = true; tries = 0;
      send(subscribePacket(1, base + '#'));
      send(publishPacket(mine, '1:' + token, true));
      clearInterval(ping);
      ping = setInterval(() => {
        send(PINGREQ);
        // Say we are still here as well as staying connected. If a stale will ever did land after
        // us, or the broker dropped the retained message, this puts it right within one interval.
        send(publishPacket(mine, '1:' + token, true));
      }, KEEPALIVE * 500);
      say('onStatus', 'online');
    }

    function drop() {
      clearTimeout(guard); clearInterval(ping);
      const was = live, sock = ws;
      live = false; ws = null; buf = new Uint8Array(0);
      // Two of the three ways in here -- a refused CONNACK, and bytes that are not MQTT -- leave
      // the socket open. Close it, or it sits there until the garbage collector notices.
      if (sock) { try { sock.close(); } catch (e) {} }
      if (closed) return;
      // Our own view of the peer is only as good as our connection to the broker.
      if (peerOnline) { peerOnline = false; say('onPeer', false); }
      if (was) say('onStatus', 'connecting');
      const wait = Math.min(1000 * Math.pow(2, tries++), 10000);
      clearTimeout(retry);
      retry = setTimeout(open, wait);
    }

    function feed(chunk) {
      const merged = new Uint8Array(buf.length + chunk.length);
      merged.set(buf); merged.set(chunk, buf.length);
      buf = merged;
      for (;;) {
        if (buf.length < 2) return;
        let mul = 1, len = 0, i = 1, digit;
        do {
          if (i >= buf.length) return;                        // length prefix still arriving
          if (i > 4) return drop();                           // not MQTT; give up on this socket
          digit = buf[i++];
          len += (digit & 127) * mul;
          mul *= 128;
        } while (digit & 128);
        if (buf.length < i + len) return;
        handle(buf[0] >> 4, buf[0] & 15, buf.subarray(i, i + len));
        buf = buf.slice(i + len);
        if (!ws) return;                                      // handle() closed us
      }
    }

    function handle(type, flags, body) {
      if (type === 2) return (body.length >= 2 && body[1] === 0) ? ready() : drop();
      if (type !== 3) return;                                 // PUBLISH; PINGRESP and SUBACK need nothing
      const n = (body[0] << 8) | body[1];
      const topic = textDec.decode(body.subarray(2, 2 + n));
      const qos = (flags >> 1) & 3;
      const payload = textDec.decode(body.subarray(2 + n + (qos ? 2 : 0)));
      if (topic === theirs) {
        const on = payload.charAt(0) === '1', who = payload.slice(2);
        // A goodbye only counts from the connection that said hello.
        if (!on && peerToken && who && who !== peerToken) return;
        if (on) peerToken = who;
        if (on !== peerOnline) { peerOnline = on; say('onPeer', on); }
      } else if (topic === mine) {
        // Someone else opened this link and sat in my chair. Their heartbeat repeats; the news
        // does not need to.
        const who = payload.slice(2);
        if (payload.charAt(0) === '1' && who !== token && who !== warnedAbout) {
          warnedAbout = who;
          say('onSeatTaken');
        }
      } else if (topic === stateTopic && payload) {
        if (payload === current) return;                      // our own echo, or nothing new
        current = payload;
        say('onState', payload === EMPTY ? '' : payload);
      }
    }

    open();

    return {
      // The full move list after every move: whoever arrives late is handed the whole game.
      publish(code) {
        current = code || EMPTY;
        send(publishPacket(stateTopic, current, true));
      },
      leave() {
        if (closed) return;
        closed = true;
        clearInterval(ping); clearTimeout(retry); clearTimeout(guard);
        if (live) { send(publishPacket(mine, '0:' + token, true)); send(DISCONNECT); }
        const sock = ws;
        ws = null; live = false;
        if (sock) {
          sock.onmessage = null; sock.onclose = null; sock.onerror = () => {};
          // Closing a socket that is still opening is reported as a console error by WebKit, and
          // a host racing the brokers closes two of them at exactly that moment -- an error in
          // the page's console for something that is working as intended. Let it finish opening
          // and close it then; nothing is ever sent on it either way.
          if (sock.readyState === 0) sock.onopen = () => { try { sock.close(); } catch (e) {} };
          else { try { sock.close(); } catch (e) {} }
        }
        if (peerOnline) { peerOnline = false; say('onPeer', false); }
        say('onStatus', 'offline');
      },
      // What the room currently holds, so a caller can tell its own move from an echo.
      get state() { return current === EMPTY ? '' : (current || ''); },
      // A phone that was in the background has had its timers frozen; do not make it serve out
      // the rest of a backoff it did not notice passing.
      poke() { if (!closed && !live && !ws) { clearTimeout(retry); tries = 0; open(); } },
      get online() { return live; },
      get peerOnline() { return peerOnline; },
      token, seat, room: o.room, url,
    };
  }

  const api = { join, BROKERS, newRoomId, brokerOf, PREFIX, EMPTY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FawaneesRelay = api;
})(typeof window !== 'undefined' ? window : globalThis);
