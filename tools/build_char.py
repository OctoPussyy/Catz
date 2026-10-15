#!/usr/bin/env python3
"""Build a rigged character from a folder of 14 overlapping pieces (one transparent PNG per piece, same canvas,
all in the assembled standing pose).

    python3 tools/build_char.py <folder-with-pieces> <char-id>      e.g.  tools/build_char.py "Prison cat body" prison

Expected pieces (file names are matched loosely, case/spaces ignored):
    Torso, Head, Left/Right upper arm, Left/Right fore arm, Left/Right hand,
    Left/Right thigh, Left/Right shin, Left/Right boot
"Left" = the limb on the viewer's left. The character faces right in the game (viewer-right limbs are the front ones).

Output:  assets/chars/<id>/<part>.png (cropped, half size)  +  js/chars/<id>.js (part boxes + joint pivots)
         assets/chars/<id>/_check.png (assembled + pivots overlay for a quick visual check)

Joint pivots are found automatically from where neighbouring pieces overlap (neck, elbows, wrists, knees, ankles) and from
the top of the upper arm / thigh piece (shoulders, hips). Run with --print to see them without writing anything.
"""
import os, re, sys, json
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
PRESCALE = 0.5

# canonical part name -> loose file-name key
KEYS = {
    'torso': 'torso', 'head': 'head',
    'arm_l_up': 'leftupperarm', 'arm_l_lo': 'leftforearm', 'hand_l': 'lefthand',
    'arm_r_up': 'rightupperarm', 'arm_r_lo': 'rightforearm', 'hand_r': 'righthand',
    'leg_l_th': 'leftthigh', 'leg_l_sh': 'leftshin', 'boot_l': 'leftboot',
    'leg_r_th': 'rightthigh', 'leg_r_sh': 'rightshin', 'boot_r': 'rightboot',
}
ALIASES = {'forearm': 'forearm', 'fore arm': 'forearm', 'lowerarm': 'forearm', 'foot': 'boot', 'leg': 'thigh'}


def norm(s):
    s = os.path.splitext(s)[0].lower()
    s = re.sub(r'[^a-z]', '', s)
    return s.replace('lowerarm', 'forearm').replace('foot', 'boot')


def load_pieces(folder):
    files = {norm(f): f for f in os.listdir(folder) if f.lower().endswith('.png') and not f.startswith('._')}
    out = {}
    for part, key in KEYS.items():
        if key not in files:
            sys.exit(f'missing piece for "{part}" (looking for a file like "{key}") in {folder}\n  found: {sorted(files)}')
        a = np.array(Image.open(os.path.join(folder, files[key])).convert('RGBA'))
        alpha = a[..., 3]
        alpha[alpha < 24] = 0                                              # faint halo
        lab, n = ndi.label(alpha > 0)
        if n > 1:                                                          # drop stray specks
            sizes = ndi.sum(alpha > 0, lab, range(1, n + 1))
            keep = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s >= 60])
            alpha = np.where(keep, alpha, 0).astype(np.uint8)
        a[..., 3] = alpha
        out[part] = a
    return out


def mask(a): return a[..., 3] > 128


def centroid(m):
    ys, xs = np.where(m)
    return (float(xs.mean()), float(ys.mean())) if len(ys) else None


def joints(P):
    M = {k: mask(v) for k, v in P.items()}
    J = {}
    J['neck'] = centroid(M['torso'] & M['head'])
    for s in 'lr':
        up = M[f'arm_{s}_up']
        ys, xs = np.where(up)
        top = ys.min()
        band = up[top + 55: top + 105]
        bx, _ = np.where(band)[1].mean(), None
        sx = float(np.where(band)[1].mean())
        J[f'arm_{s}'] = dict(
            S=(sx, float(top + 78)),
            E=centroid(up & M[f'arm_{s}_lo']),
            W=centroid(M[f'arm_{s}_lo'] & M[f'hand_{s}']),
            Hc=centroid(M[f'hand_{s}']),
        )
        th = M[f'leg_{s}_th']
        ys, xs = np.where(th)
        top = ys.min()
        band = th[top + 30: top + 70]
        hx = float(np.where(band)[1].mean())
        bo = M[f'boot_{s}']
        yb = np.where(bo)[0].max()
        J[f'leg_{s}'] = dict(
            H=(hx, float(top + 48)),
            K=centroid(th & M[f'leg_{s}_sh']),
            A=centroid(M[f'leg_{s}_sh'] & bo),
            bottom=int(yb),
        )
    area = {s: int(M[f'arm_{s}_up'].sum()) for s in 'lr'}
    # an upper-arm piece that is much smaller than its twin is only the visible sliver of an arm that is mostly behind the chest;
    # it is drawn behind the torso so the chest covers its root
    J['under_torso'] = [s for s in 'lr' if area[s] < 0.6 * area['l' if s == 'r' else 'r']]
    hl, hr = J['leg_l']['H'], J['leg_r']['H']
    J['hip_pivot'] = ((hl[0] + hr[0]) / 2, 730.0)
    J['ground_y'] = max(J['leg_l']['bottom'], J['leg_r']['bottom'])
    J['center_x'] = 540
    return J


def rnd(o):
    if isinstance(o, dict): return {k: rnd(v) for k, v in o.items()}
    if isinstance(o, (tuple, list)):
        return [round(float(x), 1) if isinstance(x, (int, float)) else x for x in o]
    return o


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) < 2: sys.exit(__doc__)
    folder, cid = args[0], args[1]
    P = load_pieces(folder)
    J = joints(P)
    print(json.dumps(rnd(J), indent=1))
    if '--print' in sys.argv: return
    out = os.path.join(ROOT, 'assets', 'chars', cid)
    os.makedirs(out, exist_ok=True)
    parts = {}
    for name, a in P.items():
        ys, xs = np.where(a[..., 3] > 0)
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        im = Image.fromarray(a[y0:y1, x0:x1])
        im = im.resize((max(1, round(im.width * PRESCALE)), max(1, round(im.height * PRESCALE))), Image.LANCZOS)
        im.save(os.path.join(out, name + '.png'), optimize=True)
        parts[name] = dict(file=f'assets/chars/{cid}/{name}.png', ox=int(x0), oy=int(y0), w=int(x1 - x0), h=int(y1 - y0))
    manifest = dict(id=cid, scale=PRESCALE, parts=parts, joints=rnd(J))
    os.makedirs(os.path.join(ROOT, 'js', 'chars'), exist_ok=True)
    with open(os.path.join(ROOT, 'js', 'chars', cid + '.js'), 'w') as f:
        f.write('// generated by tools/build_char.py - do not edit\nwindow.CHARS = window.CHARS || {};\nCHARS[' + json.dumps(cid) + '] = ' + json.dumps(manifest, indent=1) + ';\n')
    # visual check: assembled figure with pivots
    order = ['boot_l', 'leg_l_sh', 'leg_l_th', 'boot_r', 'leg_r_sh', 'leg_r_th', 'torso', 'head',
             'arm_l_lo', 'hand_l', 'arm_l_up', 'arm_r_lo', 'hand_r', 'arm_r_up']
    bg = Image.new('RGBA', (1024, 1536), (40, 20, 60, 255))
    for n in order: bg.alpha_composite(Image.fromarray(P[n]))
    d = ImageDraw.Draw(bg)
    pts = [J['neck']] + [J[f'arm_{s}'][k] for s in 'lr' for k in ('S', 'E', 'W')] + [J[f'leg_{s}'][k] for s in 'lr' for k in ('H', 'K', 'A')]
    for x, y in pts: d.ellipse((x - 8, y - 8, x + 8, y + 8), outline=(255, 255, 0), width=3)
    bg.convert('RGB').save(os.path.join(out, '_check.png'))
    print('wrote', out)


if __name__ == '__main__':
    main()
