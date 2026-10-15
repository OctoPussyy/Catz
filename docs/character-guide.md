# Making a character

The game needs **14 transparent PNGs per character**, all on the **same canvas** (the prison cat set uses 1024x1536),
all in the **assembled standing pose**, so stacking them rebuilds the figure.

| piece | notes |
|---|---|
| Torso | chest, belly, hips and belt; keep the shoulder sockets and the neck base painted in |
| Head | the neck runs down into the torso |
| Left / Right upper arm | shoulder to elbow, rounded ends |
| Left / Right fore arm | elbow to wrist |
| Left / Right hand | clenched fist with a short wrist stub |
| Left / Right thigh | hip to knee |
| Left / Right shin | knee to ankle, including the jeans cuff |
| Left / Right boot | |

"Left" is the limb on the viewer's left. The character faces right in the game (viewer-right limbs are the front ones).

## Rules that keep it from looking broken
- Every joint end is rounded and **overlaps** the neighbouring piece by about half a limb-width.
- No outline on the overlapping ends (only on the outer edges).
- Never rub the torso out under the arms or legs; paint it complete.
- Draw limbs straight; all bending happens in code.
- No baked cast shadows between pieces; shade each piece on its own.
- Keep detail (tattoos, logos) away from the exact joint centres.

## Build
```
python3 tools/build_char.py "<folder with the 14 PNGs>" <id>
```
File names are matched loosely (`Left upper arm.png`, `left_forearm.png` ...). The script finds every joint pivot from the overlaps and
writes `assets/chars/<id>/` plus `js/chars/<id>.js`; open `assets/chars/<id>/_check.png` to see the pivots on the assembled figure.
Then register the character in `index.html` and `ROSTER` (see README).

## Quick quality test before doing the other characters
Open `tools/posesheet.html` through a local server (`python3 -m http.server`) and look at the crouch, block, kick and "elbows 90" poses.
Any gap or hard edge at a joint means the overlap on that piece needs to be larger or rounder.
