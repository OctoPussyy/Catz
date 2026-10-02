# Catz Fight

A 2D fighting game that plays inside the Catz arcade cabinet. Open `index.html` over http (e.g. `python3 -m http.server`) — no build step.

- `index.html` – the cabinet page (CRT glass is warped onto the machine's keystoned screen; joysticks, buttons and coin slots are clickable)
- `js/game.js` – fighters, moves, hit detection, CPU AI, rounds, HUD, all screens
- `js/rig.js`, `js/poses.js` – paper-doll skeleton (2-bone IK) and the pose/move table
- `js/stage.js` – procedural neon stages; `js/audio.js` – synthesized sfx + music; `js/input.js` – keyboard/gamepad/touch
- `assets/raw/*.png` – the 5 supplied pieces (torso, 2 arms, 2 legs)
- `tools/build_parts.py` – slices those pieces at elbows/knees/ankles into `assets/parts/*` and writes `js/parts.js`

## Adding a character
Every roster slot currently reuses one sprite set, hue-shifted (`ROSTER` in `js/game.js`).
To give a character its own art, drop its 5 pieces (same 1024x1536 canvas, assembled position) in `assets/raw/`,
adjust joint positions in `tools/build_parts.py`, and point that roster entry at its own parts set.

## Controls
P1: WASD move, J/K punch, L block, U/I kick, O special. P2: arrows + numpad 4 5 6 / 1 2 3. Z view, M mute, P pause, F2 hitboxes.
