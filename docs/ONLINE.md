# Playing a friend on another device

Sharing used to mean sharing a *position*: the whole move list went into the link, so two people
could open the same game and never be in it together, and every turn needed a new link. Sharing is
now a **room**. You open one, send the link once, and you see the other player arrive, move, and
leave.

The page has no backend and nowhere to put one, so the question was how two phones find each other.

## Why a broker and not a direct connection

WebRTC is the obvious answer and the wrong one here. It connects two devices directly, which is
nicer in principle, but mobile carriers put phones behind NAT that a direct connection cannot
cross without a relay of its own (TURN). The failure mode is the worst kind: it works between two
laptops on the same wifi, and fails between two phones on mobile data — which is exactly the case
this feature exists for.

A broker relays, so there is nothing to negotiate and nothing to fail. The cost is that a third
party carries the messages. What it carries is a random room name and a list of move numbers.

**MQTT** rather than a plain WebSocket service, because two of its features are the feature:

- A **last will** is a message the broker publishes on your behalf when your connection dies. That
  is how the other player learns you are gone whether you closed the tab, locked the phone, or
  walked out of signal. Nothing has to notice and report it; it is the protocol.
- A **retained** message is kept by the broker and handed to whoever subscribes next. That is how
  the player who arrives second is given the position immediately instead of waiting for a move,
  and how a reload picks the game back up.

`src/relay.js` is a hand-written MQTT 3.1.1 client, about two hundred lines for the four packet
types this needs, so the published page stays one self-contained file with no library to fetch.

## The brokers

Three free public brokers, reached over `wss`. Measured from Gaza on 24 September 2026, five
connections each, timing from opening the socket to the broker acknowledging it:

| | broker | answered | median | worst |
|---|---|---|---|---|
| 0 | `broker.emqx.io:8084` | 5/5 | 1443 ms | 2724 ms |
| 1 | `broker.hivemq.com:8884` | 5/5 | 8049 ms | 9911 ms |
| 2 | `test.mosquitto.org:8081` | 5/5 | 1549 ms | 3224 ms |

`mqtt.eclipseprojects.io` was also tried and did not answer at all, so it is not in the list.

Two things follow from that table, and both are in the code:

- **hivemq is erratic** — the same broker answered in 625 ms and in 9911 ms within one minute, and
  in an earlier run took about nineteen seconds. So the client waits 22 seconds for an
  acknowledgement before giving up on a socket. A slow broker is not a dead one, and a joiner is
  pinned to whichever broker their link names: giving up early would mean never connecting rather
  than connecting slowly.
- **Trying them in turn is the wrong shape.** Queueing three brokers at twenty seconds each is a
  minute before a link can be sent to anybody. Opening a room now opens one on *each* broker at
  once and keeps whichever answers first; the losers are closed before they have said anything.

A room id begins with the index of the broker it was opened on. Both players must sit on the same
broker to hear each other, so the room *name* has to carry that: a link that landed them on
different brokers would look perfectly connected and hear nothing. It also means the client never
fails over to another broker mid-game, because that would silently split the two devices.

## What goes wrong, and what happens

| | |
|---|---|
| They close the tab, or lock the phone | Explicit goodbye on `pagehide`; the will covers the rest, within about 30 s |
| They refresh | Their new connection says hello; a goodbye only counts from the connection that said hello, so a refresh does not read as leaving |
| You refresh | `sessionStorage` puts you back in your own chair — it survives a reload and belongs to one tab, so a second tab opening the same link still takes the free seat |
| They open your link after closing their own tab | Their chair is taken and the other one is empty, so they move to it rather than two people sharing a colour |
| A third person opens the link | The seated player is told once, not once per heartbeat |
| You move while your connection is down | Only a new game makes a game shorter, so a position that arrives from behind is answered with yours rather than taken |
| The other device sends something impossible | Everything is replayed through the engine; anything the rules refuse is ignored |
| Your phone was in the background for an hour | The socket is re-opened on the next `visibilitychange`, rather than serving out a backoff that was frozen with it |
| There is no network at all | Said immediately, instead of after three brokers have timed out |

## What is measured

`test/browser/online.test.js` runs real browser pages against a real broker — there is no mock,
because every one of the cases above is about what one device learns about another:

- a room, a waiting friend, both seats, moves both ways, a third person, and a goodbye
- a position arriving from behind, an impossible position, and rubbish that is not base64
- reloading back into your own chair and your own game
- a rematch keeping the room
- the swap rule and passing crossing devices

The relay itself is also driven straight from Node, which is the only way to say "now send exactly
this" — a second browser page will only ever send correct things.

`test/browser/pwa.test.js` checks the other side of it: a page that is merely loaded reaches out
to nothing but the font server. The relay connects when someone asks to play a friend, and not
before.
