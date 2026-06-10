#!/usr/bin/env python3
"""Remove a FLAT background via border flood-fill, trim, center on a square
transparent canvas. Flood-fill only clears background-connected pixels, so
interior glows (flames, gems, energy) and same-colored creatures survive.

Usage: process_sprite.py <in.png> <out.png> [size] [anchor] [thresh]
  anchor: 'bottom' (default, feet/base near lower edge) or 'center'
"""
import sys
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

SENTINEL = (255, 0, 255)

def remove_flat_bg(img, thresh=40):
    rgb = img.convert("RGB").copy()
    w, h = rgb.size
    draw_img = rgb
    # flood-fill from a ring of border points so the whole bg is caught even
    # if a corner sits on a stray pixel.
    seeds = []
    for t in range(0, w, max(1, w // 12)):
        seeds += [(t, 0), (t, h - 1)]
    for t in range(0, h, max(1, h // 12)):
        seeds += [(0, t), (w - 1, t)]
    for s in seeds:
        ImageDraw.floodfill(draw_img, s, SENTINEL, thresh=thresh)
    arr = np.array(draw_img)
    is_bg = np.all(arr == np.array(SENTINEL), axis=-1)
    alpha = np.where(is_bg, 0, 255).astype(np.uint8)
    out = img.convert("RGBA")
    a = Image.fromarray(alpha, "L")
    # feather edges by 1px to kill jaggies from the hard mask
    a = a.filter(ImageFilter.GaussianBlur(0.6))
    out.putalpha(a)
    return out

def process(in_path, out_path, size=256, anchor="bottom", thresh=40):
    img = Image.open(in_path).convert("RGBA")
    img = remove_flat_bg(img, thresh)
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    margin = int(size * 0.06)
    avail = size - 2 * margin
    w, h = img.size
    scale = min(avail / w, avail / h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    img = img.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x = (size - nw) // 2
    y = (size - margin - nh) if anchor == "bottom" else (size - nh) // 2
    canvas.paste(img, (x, y), img)
    canvas.save(out_path)
    print(f"saved {out_path} ({size}x{size}, content {nw}x{nh})")

if __name__ == "__main__":
    inp, outp = sys.argv[1], sys.argv[2]
    size = int(sys.argv[3]) if len(sys.argv) > 3 else 256
    anchor = sys.argv[4] if len(sys.argv) > 4 else "bottom"
    thresh = int(sys.argv[5]) if len(sys.argv) > 5 else 40
    process(inp, outp, size, anchor, thresh)
