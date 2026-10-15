# Catz Fight

A 2D fighting game that plays inside the Catz arcade cabinet. Open `index.html` over http (e.g. `python3 -m http.server`) — no build step.

- `index.html` – the cabinet page (CRT glass is warped onto the machine's keystoned screen; joysticks, buttons and coin slots are clickable)
- `js/game.js` – fighters, moves, hit detection, CPU AI, rounds, HUD, all screens
- `js/rig.js`, `js/poses.js` – paper-doll skeleton (2-bone IK, separate head and fists) and the pose/move table
- `js/stage.js` – procedural neon stages; `js/audio.js` – synthesized sfx + music; `js/input.js` – keyboard/gamepad/touch
- `assets/chars/<id>/` + `js/chars/<id>.js` – a rigged character (generated)
- `tools/build_char.py` – turns a folder of 14 overlapping piece PNGs into a character (finds the joint pivots from the overlaps)
- `js/config.js` – `comingSoon` switch (open the page with `?dev=1` to bypass it)

## Adding a character
1. Cut the character into 14 transparent PNGs on one canvas, all in the assembled standing pose, with overlapping joints:
   Torso, Head, Left/Right upper arm, fore arm, hand, thigh, shin, boot (see docs/character-guide.md).
2. `python3 tools/build_char.py "<folder>" <id>` (add `--print` to only list the detected pivots). Check `assets/chars/<id>/_check.png`.
3. Add `<script src="js/chars/<id>.js">` to `index.html`, then replace one of the locked `{ name: '???', locked: true }` entries in `ROSTER` (`js/game.js`) with `{ name: 'NAME', char: '<id>', hue: 0 }`.
   A character can never be matched against itself (1P: the CPU always gets a different fighter; 2P: the second player cannot pick the first player's fighter).

## Controls
P1: WASD move, J/K punch, L block, U/I kick, O special. P2: arrows + numpad 4 5 6 / 1 2 3. Z view, M mute, P pause, F2 hitboxes.
