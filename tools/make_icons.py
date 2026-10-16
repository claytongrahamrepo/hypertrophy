"""Generate app icons. Run: python3 tools/make_icons.py"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')
BG = (17, 17, 16, 255)
BAR = (240, 239, 236, 255)
PLATE = (57, 135, 229, 255)

def draw(size, pad_frac, radius_frac):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=size * radius_frac, fill=BG)
    cy = size / 2
    pad = size * pad_frac
    bar_h = size * 0.06
    d.rounded_rectangle([pad, cy - bar_h / 2, size - pad, cy + bar_h / 2], radius=bar_h / 2, fill=BAR)
    pw, ph = size * 0.09, size * 0.42
    x0 = pad + size * 0.08
    for x in (x0, size - x0 - pw):
        d.rounded_rectangle([x, cy - ph / 2, x + pw, cy + ph / 2], radius=pw * 0.3, fill=PLATE)
    pw2, ph2 = size * 0.07, size * 0.30
    x1 = x0 + pw + size * 0.02
    for x in (x1, size - x1 - pw2):
        d.rounded_rectangle([x, cy - ph2 / 2, x + pw2, cy + ph2 / 2], radius=pw2 * 0.3, fill=PLATE)
    return img

os.makedirs(OUT, exist_ok=True)
specs = [
    ('icon-512.png', 512, 0.12, 0.22),
    ('icon-192.png', 192, 0.12, 0.22),
    ('icon-maskable-512.png', 512, 0.20, 0.0),
    ('apple-touch-icon.png', 180, 0.12, 0.0),
]
for name, size, pad, radius in specs:
    draw(size, pad, radius).save(os.path.join(OUT, name))
    print('wrote', name)
