#!/usr/bin/env python3
"""Slice the 5 supplied character pieces into rigged parts.

Input : assets/raw/{torso,arm_l,arm_r,leg_a,leg_b}.png   (1024x1536, pieces already in assembled position)
Output: assets/parts/*.png (cropped, pre-scaled)  +  js/parts.js (manifest + joint positions)

Each limb is split at its joints. Every joint is a "ball hinge": the upper piece owns everything above
the joint line PLUS a disc around the pivot, the lower piece owns everything below the line PLUS the same
disc. The upper piece is drawn on top, so its disc hides the seam whatever angle the joint bends to.

All coordinates are in the ORIGINAL 1024x1536 sprite space (y down).
"""
import json, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.join(os.path.dirname(__file__), '..')
RAW = os.path.join(ROOT, 'assets', 'raw')
OUT = os.path.join(ROOT, 'assets', 'parts')
PRESCALE = 0.5            # parts are stored at half size (game draws them at roughly 0.3 of original)
os.makedirs(OUT, exist_ok=True)

# ---- joint positions (original sprite coordinates) -------------------------------------------------------
J = dict(
    hip_pivot=(535, 730),                       # torso rotates around this
    ground_y=1527, center_x=540,
    # arms: shoulder, elbow, hand (centre of the fist)
    arm_r=dict(S=(675, 365), E=(715, 650), H=(775, 850), r=64),   # viewer-right arm = FRONT arm (character faces right)
    arm_l=dict(S=(330, 370), E=(292, 615), H=(318, 835), r=64),   # viewer-left  arm = REAR arm
    # legs: hip, knee, ankle
    leg_b=dict(Hp=(625, 725), K=(650, 1055), A=(668, 1385), rk=96, ra=118),  # FRONT leg
    leg_a=dict(Hp=(445, 725), K=(405, 1040), A=(345, 1385), rk=100, ra=122), # REAR leg
)

def load(name):
    im = Image.open(os.path.join(RAW, name + '.png')).convert('RGBA')
    a = np.array(im)
    alpha = a[..., 3].astype(np.uint8)
    alpha[alpha < 40] = 0                                   # kill the faint halo left by the cut-outs
    # drop stray specks / thin outlines left behind by the cut (anything not part of the main body)
    lab, n = ndi.label(alpha > 0)
    if n > 1:
        sizes = ndi.sum(alpha > 0, lab, range(1, n + 1))
        keep = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s > 4000])
        alpha = np.where(keep, alpha, 0).astype(np.uint8)
    a[..., 3] = alpha
    return a

H_, W_ = 1536, 1024
YY, XX = np.mgrid[0:H_, 0:W_].astype(np.float32)

def halfplane(p, d):
    """signed distance along unit vector d from point p (positive = 'below' the joint line)"""
    return (XX - p[0]) * d[0] + (YY - p[1]) * d[1]

def disc(p, r):
    return ((XX - p[0]) ** 2 + (YY - p[1]) ** 2) <= r * r

def unit(a, b):
    v = np.array(b, np.float32) - np.array(a, np.float32)
    return v / np.linalg.norm(v)

def feather(sd, w=1.2):
    return np.clip(0.5 - sd / w, 0, 1)   # 1 above the line, 0 below (anti-aliased)

parts = {}

def emit(name, arr, mask):
    out = arr.copy()
    out[..., 3] = (arr[..., 3].astype(np.float32) * mask).astype(np.uint8)
    ys, xs = np.where(out[..., 3] > 0)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    crop = Image.fromarray(out[y0:y1, x0:x1])
    w, h = max(1, round(crop.width * PRESCALE)), max(1, round(crop.height * PRESCALE))
    crop = crop.resize((w, h), Image.LANCZOS)
    crop.save(os.path.join(OUT, name + '.png'), optimize=True)
    parts[name] = dict(file=f'assets/parts/{name}.png', ox=int(x0), oy=int(y0), w=int(x1 - x0), h=int(y1 - y0))
    return out

ones = np.ones((H_, W_), np.float32)

# ---- torso (with head) -------------------------------------------------------------------------------------
emit('torso', load('torso'), ones)

# ---- arms: upper / lower ------------------------------------------------------------------------------------
for side in ('r', 'l'):
    key = f'arm_{side}'
    a = load(key)
    d = J[key]
    ax = unit(d['S'], d['H'])          # cut line is perpendicular to the overall arm axis
    up = np.maximum(feather(halfplane(d['E'], ax)), disc(d['E'], d['r']).astype(np.float32))
    lo = np.maximum(1 - feather(halfplane(d['E'], ax)), disc(d['E'], d['r']).astype(np.float32))
    emit(f'{key}_up', a, up)
    emit(f'{key}_lo', a, lo)

# ---- legs: thigh / shin / foot -----------------------------------------------------------------------------
for key in ('leg_b', 'leg_a'):
    a = load(key)
    d = J[key]
    ax_k = unit(d['Hp'], d['A'])                       # knee cut: perpendicular to hip->ankle
    ax_a = unit(d['K'], d['A'])                        # ankle cut: perpendicular to shin
    above_k = feather(halfplane(d['K'], ax_k))
    above_a = feather(halfplane(d['A'], ax_a))
    dk = disc(d['K'], d['rk']).astype(np.float32)
    da = disc(d['A'], d['ra']).astype(np.float32)
    thigh = np.maximum(above_k, dk)
    shin = np.maximum(np.minimum(1 - above_k, above_a), da)
    foot = np.maximum(1 - above_a, da)
    emit(f'{key}_th', a, thigh)
    emit(f'{key}_sh', a, shin)
    emit(f'{key}_ft', a, foot)

manifest = dict(scale=PRESCALE, parts=parts, joints=J)
with open(os.path.join(ROOT, 'js', 'parts.js'), 'w') as f:
    f.write('// generated by tools/build_parts.py - do not edit\nconst PARTS = ' + json.dumps(manifest, indent=1) + ';\n')

# ---- self-check: reassemble at rest and compare with the straight merge ------------------------------------
def reassemble():
    bg = Image.new('RGBA', (W_, H_), (0, 0, 0, 0))
    order = ['leg_a_ft', 'leg_a_sh', 'leg_a_th', 'leg_b_ft', 'leg_b_sh', 'leg_b_th', 'torso',
             'arm_l_lo', 'arm_l_up', 'arm_r_lo', 'arm_r_up']
    for n in order:
        p = parts[n]
        im = Image.open(os.path.join(OUT, n + '.png')).resize((p['w'], p['h']), Image.LANCZOS)
        bg.alpha_composite(im, (p['ox'], p['oy']))
    return bg

if __name__ == '__main__':
    r = reassemble()
    ref = Image.new('RGBA', (W_, H_), (0, 0, 0, 0))
    for n in ['leg_b', 'leg_a', 'torso', 'arm_l', 'arm_r']:
        ref.alpha_composite(Image.fromarray(load(n)))
    diff = np.abs(np.array(r).astype(int) - np.array(ref).astype(int))[..., :3].max(2)
    sel = np.array(ref)[..., 3] > 200
    print('parts:', len(parts), ' mean abs diff on opaque pixels: %.2f' % diff[sel].mean())
    bg = Image.new('RGBA', (W_, H_), (40, 20, 60, 255)); bg.alpha_composite(r)
    bg.convert('RGB').save(os.path.join(ROOT, 'assets', 'rest_check.png'))
