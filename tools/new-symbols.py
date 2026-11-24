#!/usr/bin/env python3
"""Draws the symbols added in v1.1.0 of the roadbook symbol library (roundabouts and other
common rally roadbook symbols) and appends them to symbols/manifest.json.

Run from the repo root: python3 tools/new-symbols.py   (idempotent: existing ids are redrawn)
Then: node tools/build-symbols.js  (sprite, contact sheet, src/symbols.js for the app)
"""
import json, math, os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'symbols')
FONT = 'font-family="Arial,Helvetica,sans-serif" font-weight="bold" text-anchor="middle" fill="#000" stroke="none"'


def svg(sid, title, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" id="tb-{sid}"><title>{title}</title>'
            f'<g fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">{body}</g></svg>\n')


def text(t, y, size):
    return f'<text x="32" y="{y}" font-size="{size}" {FONT}>{t}</text>'


def circled(t, size):  # same look as cp / cs / cpv
    return f'<circle cx="32" cy="32" r="27"/>' + text(t, round(32 + size * 0.257, 1), size)


def boxed(t, size):  # code in a box (waypoints, DSS / ASS)
    return f'<rect x="4" y="16" width="56" height="32" rx="3"/>' + text(t, round(32 + size * 0.36, 1), size)


# ---------- roundabouts ----------
C, R, ARM = (32, 30), 11, 27   # ring centre, ring radius, arm length from the centre


def pt(a, r, c=C):  # compass angle (0 = up, 90 = right) -> point
    return (c[0] + r * math.sin(math.radians(a)), c[1] - r * math.cos(math.radians(a)))


def f(p):
    return f'{p[0]:.1f} {p[1]:.1f}'


def arrowhead(a, r, c=C, size=6):
    tip, base = pt(a, r, c), pt(a, r - size * 1.4, c)
    px, py = math.cos(math.radians(a)) * size, math.sin(math.radians(a)) * size
    return f'<path d="M{f(tip)} L{base[0] - px:.1f} {base[1] - py:.1f} L{base[0] + px:.1f} {base[1] + py:.1f} Z" fill="#000" stroke="none"/>'


def ring_route(exit_a, n_label=None, arms=(), c=C, r=R, arm=ARM, uturn=False):
    """Tulip-style roundabout: you arrive from the bottom (dot), drive anticlockwise round the ring
    (right-hand traffic) and leave by the arrow. arms: other exits (compass angles), drawn thin."""
    out = [f'<circle cx="{c[0]}" cy="{c[1]}" r="{r}" stroke-width="2"/>']
    for a in arms:
        out.append(f'<path d="M{f(pt(a, r, c))} L{f(pt(a, arm - 2, c))}" stroke-width="2.5"/>')
    if uturn:  # in on the right lane, out on the left lane of the same road
        e_in, e_out = 155, 205
    else:
        e_in, e_out = 180, exit_a
    start, end = pt(e_in, r, c), pt(e_out, r, c)
    sweep_deg = (e_in - e_out) % 360  # anticlockwise on the map = decreasing compass angle
    large = 1 if sweep_deg > 180 else 0
    bottom = (start[0], c[1] + arm) if not uturn else (pt(e_in, r, c)[0], c[1] + arm)
    path = f'M{f(bottom)} L{f(start)} A{r} {r} 0 {large} 0 {f(end)} L{f(pt(e_out, arm - 6, c) if not uturn else (end[0], c[1] + arm - 8))}'
    out.append(f'<path d="{path}" stroke-width="5"/>')
    out.append(f'<circle cx="{bottom[0]:.1f}" cy="{bottom[1]:.1f}" r="3.5" fill="#000" stroke="none"/>')
    if uturn:
        x, y = end[0], c[1] + arm
        out.append(f'<path d="M{x:.1f} {y:.1f} L{x - 5:.1f} {y - 9:.1f} L{x + 5:.1f} {y - 9:.1f} Z" fill="#000" stroke="none"/>')
    else:
        out.append(arrowhead(e_out, arm, c))
    if n_label:
        out.append(f'<text x="{c[0]}" y="{c[1] + 5}" font-size="14" {FONT}>{n_label}</text>')
    return ''.join(out)


def exit_n(n):
    arms_n = max(4, n + 1)
    angles = [(180 - k * 360 / arms_n) % 360 for k in range(1, arms_n)]
    return ring_route(angles[n - 1], str(n), [a for k, a in enumerate(angles) if k != n - 1])


def circ_arrows(c, r, n=3, size=4.5):  # arrowheads round a ring, pointing anticlockwise
    out = []
    for k in range(n):
        a = 45 + k * 360 / n
        p = pt(a, r, c)
        d = math.radians(a - 90)  # anticlockwise tangent on screen
        tx, ty = math.sin(d), -math.cos(d)
        nx, ny = -ty, tx
        tip = (p[0] + tx * size, p[1] + ty * size)
        b1 = (p[0] - tx * size + nx * size, p[1] - ty * size + ny * size)
        b2 = (p[0] - tx * size - nx * size, p[1] - ty * size - ny * size)
        out.append(f'<path d="M{f(tip)} L{f(b1)} L{f(b2)} Z" fill="#000" stroke="none"/>')
    return ''.join(out)


S = []  # (id, fr, en, category, abbr, body)
S.append(('roundabout', 'Rond-point (giratoire)', 'Roundabout', 'navigation', 'RP',
          f'<circle cx="32" cy="30" r="13"/>{circ_arrows((32, 30), 13)}<path d="M32 43 V58 M45 30 H58 M32 17 V4 M19 30 H6" stroke-width="2.5"/>'
          f'<circle cx="32" cy="58" r="3.5" fill="#000" stroke="none"/>'))
for n in range(1, 7):
    ordn = {1: '1re', 2: '2e', 3: '3e', 4: '4e', 5: '5e', 6: '6e'}[n]
    ordn_en = {1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th', 6: '6th'}[n]
    S.append((f'roundabout_exit{n}', f'Rond-point, {ordn} sortie', f'Roundabout, {ordn_en} exit', 'navigation', f'RP S{n}', exit_n(n)))
S.append(('roundabout_right', 'Rond-point, à droite (AD)', 'Roundabout, turn right', 'navigation', 'RP AD', ring_route(90, None, [0, 270])))
S.append(('roundabout_straight', 'Rond-point, tout droit (TD)', 'Roundabout, straight on', 'navigation', 'RP TD', ring_route(0, None, [90, 270])))
S.append(('roundabout_left', 'Rond-point, à gauche (AG)', 'Roundabout, turn left', 'navigation', 'RP AG', ring_route(270, None, [90, 0])))
S.append(('roundabout_uturn', 'Rond-point, demi-tour', 'Roundabout, U-turn', 'navigation', 'RP 1/2T', ring_route(180, None, [90, 0, 270], uturn=True)))
S.append(('mini_roundabout', 'Mini rond-point (franchissable)', 'Mini roundabout', 'navigation', None,
          f'<circle cx="32" cy="30" r="5" fill="#000" stroke="none"/><circle cx="32" cy="30" r="12" stroke-dasharray="4 4"/>{circ_arrows((32, 30), 12, 3, 3.5)}'
          f'<path d="M32 42 V58 M44 30 H58 M32 18 V4 M20 30 H6" stroke-width="2.5"/><circle cx="32" cy="58" r="3.5" fill="#000" stroke="none"/>'))
S.append(('double_roundabout', 'Double rond-point', 'Double roundabout', 'navigation', None,
          '<circle cx="32" cy="45" r="8"/><circle cx="32" cy="17" r="8"/><path d="M32 53 V61 M32 37 V25 M32 9 V2 M40 45 H52 M24 17 H12 M40 17 H52" stroke-width="2.5"/>'
          f'{circ_arrows((32, 45), 8, 2, 3)}{circ_arrows((32, 17), 8, 2, 3)}'))
S.append(('roundabout_sign', 'Panneau carrefour à sens giratoire', 'Roundabout ahead sign', 'sign', None,
          '<path d="M32 5 L60 56 H4 Z"/>' + f'<circle cx="32" cy="38" r="9"/>{circ_arrows((32, 38), 9, 3, 3.5)}'))

# ---------- controls ----------
S += [
    ('dss', 'DSS – Départ secteur sélectif', 'DSS – Start of selective section', 'control', 'DSS', boxed('DSS', 22)),
    ('ass', 'ASS – Arrivée secteur sélectif', 'ASS – End of selective section', 'control', 'ASS', boxed('ASS', 22)),
    ('wpv', 'WPV – Waypoint visible', 'WPV – Visible waypoint', 'control', 'WPV', boxed('WPV', 22)),
    ('wps', 'WPS – Waypoint de sécurité', 'WPS – Safety waypoint', 'control', 'WPS', boxed('WPS', 22)),
    ('wpe', 'WPE – Waypoint éclipse', 'WPE – Eclipse waypoint', 'control', 'WPE', boxed('WPE', 22)),
    ('wpc', 'WPC – Waypoint de contrôle', 'WPC – Control waypoint', 'control', 'WPC', boxed('WPC', 22)),
    ('dn', 'DN – Début de neutralisation', 'DN – Start of neutralisation', 'control', 'DN', circled('DN', 28)),
    ('fn', 'FN – Fin de neutralisation', 'FN – End of neutralisation', 'control', 'FN', circled('FN', 28)),
    ('customs', 'Douane, frontière', 'Customs, border post', 'service', None,
     '<rect x="6" y="18" width="52" height="28"/>' + text('DOUANE', 36.5, 11)),
]

# ---------- signs ----------
S += [
    ('give_way', 'Cédez le passage', 'Give way', 'sign', None, '<path d="M5 8 H59 L32 58 Z"/><path d="M15 14 H49 L32 46 Z" stroke-width="2"/>'),
    ('keep_right', 'Contournement obligatoire par la droite', 'Keep right', 'sign', None,
     '<circle cx="32" cy="32" r="27"/><path d="M22 20 L42 42 M42 30 V42 H30" stroke-width="5"/>'),
    ('keep_left', 'Contournement obligatoire par la gauche', 'Keep left', 'sign', None,
     '<circle cx="32" cy="32" r="27"/><path d="M42 20 L22 42 M22 30 V42 H34" stroke-width="5"/>'),
    ('hairpin', 'Virage en épingle', 'Hairpin bend', 'sign', None,
     '<path d="M32 5 L60 56 H4 Z"/><path d="M26 50 V32 C26 22 38 22 38 32 V50" stroke-width="4"/><path d="M33 44 L38 51 L43 44" stroke-width="3"/>'),
    ('level_crossing', 'Passage à niveau', 'Level crossing', 'sign', None,
     '<path d="M8 12 L56 52 M56 12 L8 52" stroke-width="7"/><path d="M8 12 L56 52 M56 12 L8 52" stroke="#fff" stroke-width="2"/>'),
    ('parking', 'Parking', 'Parking', 'service', 'P',
     '<rect x="8" y="8" width="48" height="48" rx="5"/>' + text('P', 45, 36)),
]

# ---------- terrain ----------
S += [
    ('crest', 'Bosse aveugle, sommet sans visibilité', 'Blind crest', 'terrain', None,
     '<path d="M4 50 C20 50 22 22 32 22 C42 22 44 50 60 50"/><path d="M14 16 L32 10 L50 16" stroke-width="2" stroke-dasharray="3 4"/><circle cx="32" cy="22" r="2.5" fill="#000" stroke="none"/>'),
    ('jump', 'Saut', 'Jump', 'terrain', None,
     '<path d="M4 52 H18 L34 36 V52 H60"/><path d="M34 34 C42 18 52 22 58 36" stroke-width="2.5" stroke-dasharray="4 4"/><path d="M53 33 L58 38 L60 31" stroke-width="2.5"/>'),
    ('step', 'Marche, cassure', 'Step, sharp drop', 'terrain', None,
     '<path d="M4 24 H30 V44 H60" stroke-width="4"/><path d="M36 16 L44 24 L36 32" stroke-width="2.5"/>'),
    ('compression', 'Compression (creux brutal)', 'Compression (sharp dip)', 'terrain', None,
     '<path d="M4 24 H20 L32 46 L44 24 H60" stroke-width="4"/><path d="M28 12 L32 18 L36 12" stroke-width="2.5"/>'),
    ('rut', 'Ornières', 'Ruts', 'terrain', None,
     '<path d="M18 6 C14 22 22 42 18 58 M46 6 C42 22 50 42 46 58" stroke-width="4"/><path d="M24 10 C20 26 28 40 24 54 M40 10 C36 26 44 40 40 54" stroke-width="1.5"/>'),
    ('mud', 'Boue, flaque', 'Mud, puddle', 'terrain', None,
     '<path d="M10 40 C6 30 18 24 26 28 C30 20 44 20 46 28 C56 26 60 38 52 44 C44 50 18 50 10 40 Z"/><path d="M20 38 H30 M36 36 H46" stroke-width="2"/>'),
    ('gravel', 'Gravier, piste caillouteuse fine', 'Gravel', 'terrain', None,
     ''.join(f'<circle cx="{x}" cy="{y}" r="2.6" fill="#000" stroke="none"/>' for x, y in
             [(12, 14), (26, 10), (40, 16), (54, 12), (18, 26), (34, 28), (50, 26), (10, 40), (26, 42), (42, 40), (56, 44), (18, 54), (34, 54), (50, 56)])),
    ('dune_crest', 'Crête de dune (cassure à l\'arrière)', 'Dune crest (drop behind)', 'terrain', None,
     '<path d="M4 54 C18 50 30 30 40 18 L46 54"/><path d="M40 18 L48 30" stroke-width="2"/><path d="M50 8 V14 M50 18 V20" stroke-width="3"/>'),
    ('ford', 'Gué (passage d\'eau)', 'Ford (water crossing)', 'terrain', None,
     '<path d="M22 4 V20 M42 4 V20 M22 44 V60 M42 44 V60" stroke-width="3"/><path d="M4 28 C12 24 18 32 26 28 C34 24 40 32 48 28 C54 25 58 28 60 28 M4 38 C12 34 18 42 26 38 C34 34 40 42 48 38 C54 35 58 38 60 38" stroke-width="2.5"/>'),
]

# ---------- navigation ----------
S += [
    ('faint_track', 'Piste peu marquée', 'Faint track', 'navigation', None,
     '<path d="M32 58 V8" stroke-width="3" stroke-dasharray="2 9"/><path d="M22 18 L32 8 L42 18" stroke-width="3"/>'),
]

# ---------- landmarks ----------
S += [
    ('railway', 'Voie ferrée', 'Railway line', 'landmark', None,
     '<path d="M4 24 H60 M4 40 H60" stroke-width="3"/><path d="M10 18 V46 M22 18 V46 M34 18 V46 M46 18 V46 M58 18 V46" stroke-width="2.5"/>'),
    ('cattle_grid', 'Grille à bétail (passage canadien)', 'Cattle grid', 'landmark', None,
     '<rect x="8" y="14" width="48" height="36"/><path d="M16 14 V50 M24 14 V50 M32 14 V50 M40 14 V50 M48 14 V50" stroke-width="2.5"/>'),
    ('church', 'Église, chapelle', 'Church, chapel', 'landmark', None,
     '<path d="M14 58 V30 L32 18 L50 30 V58 Z"/><path d="M32 18 V4 M26 9 H38" stroke-width="3"/><path d="M27 58 V46 C27 40 37 40 37 46 V58" stroke-width="2.5"/>'),
    ('wreck', 'Épave (véhicule)', 'Wreck (vehicle)', 'landmark', None,
     '<path d="M6 42 V32 L16 30 L24 20 H42 L50 30 L58 32 V42 Z"/><circle cx="18" cy="44" r="6"/><circle cx="46" cy="44" r="6"/><path d="M26 6 L38 16 M38 6 L26 16" stroke-width="3"/>'),
    ('animals', 'Animaux, troupeau', 'Animals, herd', 'landmark', None,
     '<path d="M12 30 C12 22 40 22 44 26 L52 18 L58 22 L52 30 C50 36 48 38 44 38 H18 C14 38 12 34 12 30 Z"/><path d="M18 38 V52 M26 38 V52 M38 38 V52 M44 38 V52" stroke-width="3"/><path d="M12 30 L6 40" stroke-width="2.5"/>'),
    ('pipeline', 'Pipeline, canalisation', 'Pipeline', 'landmark', None,
     '<path d="M4 26 H60 M4 38 H60" stroke-width="3"/><path d="M18 22 V42 M42 22 V42" stroke-width="5"/>'),
    ('water_point', 'Point d\'eau, robinet', 'Water point, tap', 'service', None,
     '<path d="M10 20 H36 V14 H44 V26 H36 V24 H18 V30 H10 Z"/><path d="M28 14 V8 M22 8 H34" stroke-width="3"/><path d="M40 34 C36 42 36 46 40 48 C44 46 44 42 40 34 Z" fill="#000" stroke-width="2"/>'),
    ('ferry', 'Port, bac, ferry', 'Port, ferry', 'service', None,
     '<path d="M6 36 H58 L50 48 H14 Z"/><path d="M18 36 V26 H44 V36 M26 26 V18 H36 V26" stroke-width="2.5"/><path d="M4 56 C12 52 18 60 26 56 C34 52 40 60 48 56 C54 53 58 56 60 56" stroke-width="2.5"/>'),
]


def main():
    man_p = os.path.join(ROOT, 'manifest.json')
    man = json.load(open(man_p, encoding='utf-8'))
    have = {s['id']: s for s in man['symbols']}
    for sid, fr, en, cat, abbr, body in S:
        with open(os.path.join(ROOT, 'svg', sid + '.svg'), 'w', encoding='utf-8') as fh:
            fh.write(svg(sid, en, body))
        entry = {'id': sid, 'label_fr': fr, 'label_en': en, 'category': cat, 'svg': f'svg/{sid}.svg',
                 'in_official_legend': False, 'used_in_roadbooks': have.get(sid, {}).get('used_in_roadbooks', 0), 'abbr': abbr, 'since': '1.1.0'}
        if sid in have:
            have[sid].update(entry)
        else:
            man['symbols'].append(entry); have[sid] = entry
    man['version'] = '1.1.0'
    man['source'] = ('4L Trophy 2026 roadbooks, Étapes 1–5 (legend page + symbols found in the tulip boxes); '
                     'v1.1.0 adds roundabouts (direction and exit number) and other common rally roadbook symbols')
    json.dump(man, open(man_p, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(len(S), 'symbols drawn,', len(man['symbols']), 'in the manifest')


if __name__ == '__main__':
    main()
