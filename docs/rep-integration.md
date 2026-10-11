# Tracking players / awarding rep

The game never talks to a server. It announces what happens to the page that embeds it, and that page (which already
knows the logged-in X user) decides what to record and what rep to give.

## 1. Embed and handshake
```html
<iframe id="catz" src="https://octopussyy.github.io/Catz/" allow="fullscreen; gamepad; autoplay"></iframe>
<script>
  const frame = document.getElementById('catz');
  addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow) return;          // ignore everything else
    const m = e.data;
    if (!m || m.source !== 'catz-fight') return;
    if (m.type === 'catz:ready' && !m.token) {              // game booted: hand it a per-visit token from YOUR backend
      frame.contentWindow.postMessage({ type: 'catz:init', token: SESSION_TOKEN_FROM_YOUR_BACKEND }, '*');
    }
    if (m.type === 'catz:match_end') {
      // POST m to your backend together with the logged-in user's session; the backend validates and awards rep
      fetch('/api/catz/match', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m) });
    }
  });
</script>
```
After the handshake the game only posts to the embedding site's origin and echoes `token` on every event.

## 2. Events (`source: 'catz-fight'`, `v: 1`)
| type | when | useful fields |
|---|---|---|
| `catz:ready` | game loaded (and again after `catz:init`) | `difficulties`, `difficulty` |
| `catz:match_start` | fight begins | `matchId`, `mode` (1 = vs CPU, 2 = two players), `difficulty`, `ladder`, `p1`, `p2` |
| `catz:round_end` | each round | `matchId`, `round`, `winner` (0 = P1, 1 = P2, -1 = draw), `why` (`ko`/`time`), `hp`, `secLeft` |
| `catz:match_end` | match finished | `matchId`, `result` (`win`/`loss` vs CPU), `difficulty`, `ladder`, `rounds`, `roundsWon`, `durationMs`, `score`, `eligible` |
| `catz:match_abandon` | player left mid-match | `matchId`, `durationMs` |

`score` is a suggested leaderboard number (win bonus + health left + time left, x1 / 0.5 / 1.75 for Normal / Easy / Hard, +150 per
extra opponent beaten). `eligible` is true for single-player matches that lasted at least 20 seconds.
The same messages are also fired on the game's own document as a `catz-event` DOM event.

## 3. Treat it as untrusted
The game runs in the player's browser, so anyone can fake these messages from the console. Do not give meaningful rep for a
reported win without server-side checks. Sensible defaults:
- require a logged-in X user and a server-issued `token`; accept each `matchId` once;
- reject `eligible: false`, very short matches, and anything above a daily cap per user;
- give small fixed rep for participation (e.g. finishing a match) and bigger rep only for things you can bound (wins on Hard, capped per day);
- if a leaderboard becomes competitive, cheating can only be prevented by running the match logic on a server.
