#!/usr/bin/env python3
"""
Accent Color Picker — adaptive highlight color for wallpapers.

Features
--------
1) Prepares & classifies palette:
   - Hue diversity (#clusters), dominant-hue weight, saturation/brightness stats,
     global luminance (L*), warm/cool bias

2) Category-driven strategies (color theory):
   - Monochrome / Desaturated     → Add an artificial warm/cool accent with good readability
   - Dominant Color Image         → Complementary accent (brightened)
   - Dual-Tone / Split Palette    → Bridge hue (mid-angle) or brighter cluster accent
   - Multi-Color / Diverse        → Dominant vibrant (area × vibrancy)
   - Low- or High-Brightness bias → Brighten/darken accent for legibility

3) Output:
   - Prints chosen accent and its complement (hex)
   - Optional verbose diagnostics
   - Optional swatch image with rows:
       Row 1: initial palette
       Row 2: filtered bright/vivid candidates
       Row 3: selected accent
       Row 4: complement

Usage
-----
python accent_color_picker.py input.jpg \
  --palette-size 24 --verbose \
  --swatch-out accent_swatch.png
"""

from __future__ import annotations
import argparse
from dataclasses import dataclass
import math
from typing import List, Tuple, Optional

from PIL import Image, ImageDraw, ImageFont
import numpy as np


# --------------------------
# Basic color helpers
# --------------------------


def clamp(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x


def rgb_to_hex(rgb: Tuple[int, int, int]) -> str:
    r, g, b = rgb
    return f"#{r:02X}{g:02X}{b:02X}"


def hex_to_rgb(h: str) -> Tuple[int, int, int]:
    h = h.strip().lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore


def rgb_to_hsv(r: int, g: int, b: int) -> Tuple[float, float, float]:
    rr, gg, bb = [x / 255.0 for x in (r, g, b)]
    mx = max(rr, gg, bb)
    mn = min(rr, gg, bb)
    diff = mx - mn
    if diff == 0:
        h = 0.0
    elif mx == rr:
        h = ((gg - bb) / diff) % 6
    elif mx == gg:
        h = (bb - rr) / diff + 2
    else:
        h = (rr - gg) / diff + 4
    h = (h / 6.0) % 1.0
    s = 0.0 if mx == 0 else diff / mx
    v = mx
    return (h, s, v)


def hsv_to_rgb(h: float, s: float, v: float) -> Tuple[int, int, int]:
    h = (h % 1.0) * 6.0
    i = int(h)
    f = h - i
    p = v * (1 - s)
    q = v * (1 - s * f)
    t = v * (1 - s * (1 - f))
    if i == 0:
        r, g, b = v, t, p
    elif i == 1:
        r, g, b = q, v, p
    elif i == 2:
        r, g, b = p, v, t
    elif i == 3:
        r, g, b = p, q, v
    elif i == 4:
        r, g, b = t, p, v
    else:
        r, g, b = v, p, q
    return (int(round(r * 255)), int(round(g * 255)), int(round(b * 255)))


# sRGB ↔ Lab for perceptual contrast
def _srgb_to_linear(c: float) -> float:
    return (c / 12.92) if c <= 0.04045 else (((c + 0.055) / 1.055) ** 2.4)


def _linear_to_srgb(c: float) -> float:
    return 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def rgb_to_xyz(r: int, g: int, b: int) -> Tuple[float, float, float]:
    R, G, B = [_srgb_to_linear(x / 255.0) for x in (r, g, b)]
    # sRGB D65
    X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375
    Y = R * 0.2126729 + G * 0.7151522 + B * 0.0721750
    Z = R * 0.0193339 + G * 0.1191920 + B * 0.9503041
    return (X, Y, Z)


def xyz_to_lab(x: float, y: float, z: float) -> Tuple[float, float, float]:
    # D65 reference white
    Xn, Yn, Zn = 0.95047, 1.00000, 1.08883

    def f(t):
        return t ** (1 / 3) if t > 0.008856 else (7.787 * t + 16 / 116)

    fx, fy, fz = f(x / Xn), f(y / Yn), f(z / Zn)
    L = 116 * fy - 16
    a = 500 * (fx - fy)
    b = 200 * (fy - fz)
    return (L, a, b)


def rgb_to_lab(rgb: Tuple[int, int, int]) -> Tuple[float, float, float]:
    return xyz_to_lab(*rgb_to_xyz(*rgb))


def delta_e_lab(lab1, lab2) -> float:
    # Simple ΔE*ab (not 2000) is fine for ranking here
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(lab1, lab2)))


def perceived_luminance(rgb: Tuple[int, int, int]) -> float:
    # Use Lab L* normalized to 0..1
    L, _, _ = rgb_to_lab(rgb)
    return clamp(L / 100.0, 0.0, 1.0)


# --------------------------
# Palette extraction
# --------------------------


@dataclass
class PaletteEntry:
    rgb: Tuple[int, int, int]
    count: int
    hsv: Tuple[float, float, float]
    lab: Tuple[float, float, float]


def extract_palette(
    img: Image.Image, palette_size: int = 24, sample_px: int = 640
) -> List[PaletteEntry]:
    # Downscale for speed while keeping structure
    w, h = img.size
    scale = min(1.0, sample_px / max(w, h))
    if scale < 1.0:
        img_small = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    else:
        img_small = img.copy()
    img_small = img_small.convert("RGB")

    # Adaptive palette via Pillow (median cut under the hood)
    pal_img = img_small.convert("P", palette=Image.ADAPTIVE, colors=palette_size)
    pal = pal_img.getpalette()  # 768 ints
    # Map indexed image -> counts
    idx = np.array(pal_img)
    unique, counts = np.unique(idx, return_counts=True)

    entries: List[PaletteEntry] = []
    for i, c in zip(unique.tolist(), counts.tolist()):
        r, g, b = pal[3 * i : 3 * i + 3]
        rgb = (r, g, b)
        hsv = rgb_to_hsv(r, g, b)
        lab = rgb_to_lab(rgb)
        entries.append(PaletteEntry(rgb=rgb, count=c, hsv=hsv, lab=lab))

    # Sort by frequency desc
    entries.sort(key=lambda e: e.count, reverse=True)
    return entries


# --------------------------
# Analysis & classification
# --------------------------


@dataclass
class Analysis:
    total_pixels: int
    mean_rgb: Tuple[int, int, int]
    mean_lab: Tuple[float, float, float]
    mean_luminance: float  # 0..1
    hue_spread: float  # circular std in radians scaled to 0..1-ish
    num_hue_clusters: int
    dominant_weight: float  # proportion of top cluster
    sat_mean: float
    sat_std: float


@dataclass
class Category:
    name: str
    reason: str


def circular_stats(angles: List[float]) -> Tuple[float, float]:
    """Return (mean angle, circular std). Angles in radians."""
    if not angles:
        return (0.0, 0.0)
    sin_sum = sum(math.sin(a) for a in angles)
    cos_sum = sum(math.cos(a) for a in angles)
    R = math.hypot(sin_sum, cos_sum) / len(angles)
    mean = math.atan2(sin_sum, cos_sum)
    std = math.sqrt(-2 * math.log(clamp(R, 1e-9, 1.0)))
    return (mean, std)


def analyze(entries: List[PaletteEntry]) -> Analysis:
    total = sum(e.count for e in entries)
    # Weighted means
    mean_r = int(round(sum(e.rgb[0] * e.count for e in entries) / total))
    mean_g = int(round(sum(e.rgb[1] * e.count for e in entries) / total))
    mean_b = int(round(sum(e.rgb[2] * e.count for e in entries) / total))
    mean_lab = rgb_to_lab((mean_r, mean_g, mean_b))
    lum = perceived_luminance((mean_r, mean_g, mean_b))

    # Hue stats (weight by count but ignore near-greys)
    hs = []
    sats = []
    for e in entries:
        h, s, v = e.hsv
        if s >= 0.08:  # treat very low saturation as grey
            hs.extend([h * 2 * math.pi] * e.count)
            sats.extend([s] * e.count)
    _, hue_std = circular_stats(hs) if hs else (0.0, 0.0)

    # Estimate #clusters: count peaks among top-N by sorting by hue
    top = entries[: min(12, len(entries))]
    hues = []
    weights = []
    for e in top:
        h, s, v = e.hsv
        if s >= 0.08:
            hues.append(h)
            weights.append(e.count)
    # crude cluster count by gaps > 40° on circle
    if hues:
        hw = sorted(zip(hues, weights))
        gaps = []
        for i in range(len(hw)):
            a, _ = hw[i]
            b, _ = hw[(i + 1) % len(hw)]
            d = (b - a) % 1.0
            gaps.append(d)
        big_gaps = sum(1 for g in gaps if g > (30 / 360))
        clusters = max(1, big_gaps)  # heuristic
    else:
        clusters = 1

    dominant_weight = entries[0].count / total if entries else 1.0
    sat_vals = []
    for e in entries:
        sat_vals.extend([e.hsv[1]] * e.count)
    sat_arr = np.array(sat_vals) if sat_vals else np.array([0.0])
    return Analysis(
        total_pixels=total,
        mean_rgb=(mean_r, mean_g, mean_b),
        mean_lab=mean_lab,
        mean_luminance=lum,
        hue_spread=hue_std,  # ~0..1.2 typical
        num_hue_clusters=clusters,
        dominant_weight=dominant_weight,
        sat_mean=float(sat_arr.mean()),
        sat_std=float(sat_arr.std()),
    )


def categorize(ana: Analysis) -> Category:
    # Thresholds chosen empirically; adjust after testing
    mono = ana.sat_mean < 0.18 and ana.sat_std < 0.12
    dark = ana.mean_luminance < 0.40
    bright = ana.mean_luminance > 0.72
    dominant = ana.dominant_weight > 0.58
    dualish = ana.num_hue_clusters == 2 and not dominant
    multicolor = ana.num_hue_clusters >= 3 and ana.hue_spread > 0.35

    if mono:
        return Category(
            "Monochrome/Desaturated",
            f"saturation mean {ana.sat_mean:.2f}, std {ana.sat_std:.2f}",
        )
    if dominant:
        return Category(
            "Dominant Color", f"top cluster weight {ana.dominant_weight:.2f}"
        )
    if dualish:
        return Category(
            "Dual-Tone", f"{ana.num_hue_clusters} hue clusters with balanced weights"
        )
    if multicolor:
        return Category(
            "Multi-Color",
            f"hue spread {ana.hue_spread:.2f}, clusters {ana.num_hue_clusters}",
        )
    if dark:
        return Category(
            "Low Brightness", f"mean luminance L*~{ana.mean_luminance * 100:.0f}"
        )
    if bright:
        return Category(
            "High Brightness", f"mean luminance L*~{ana.mean_luminance * 100:.0f}"
        )
    return Category("Balanced", "no extreme characteristics detected")


# --------------------------
# Strategy implementations
# --------------------------


def score_vibrancy(entry: PaletteEntry) -> float:
    # Nonlinear bump for saturation, soft preference for brightness
    h, s, v = entry.hsv
    return (s**1.2) * 0.65 + (v**1.1) * 0.35


def pick_dominant_vibrant(
    entries: List[PaletteEntry],
) -> Tuple[Tuple[int, int, int], List[PaletteEntry]]:
    # Filter out dull & too-dark, then pick by freq * vibrancy score
    cands = [e for e in entries if e.hsv[1] >= 0.35 and e.hsv[2] >= 0.50]
    if not cands:
        cands = entries[:6]  # fallback
    best = max(cands, key=lambda e: e.count * score_vibrancy(e))
    return best.rgb, cands


def pick_complement_of_dominant(
    entries: List[PaletteEntry],
) -> Tuple[Tuple[int, int, int], List[PaletteEntry]]:
    dom = entries[0]
    h, s, v = dom.hsv
    # Keep saturation; brighten a bit for accent readability
    s2 = clamp(s, 0.55, 0.90)
    v2 = clamp(v * 1.10, 0.60, 0.92)
    h2 = (h + 0.5) % 1.0
    rgb = hsv_to_rgb(h2, s2, v2)
    # candidates for visualization (all vivid)
    cands = [e for e in entries if e.hsv[1] >= 0.35]
    return rgb, cands


def mid_hue(a: float, b: float) -> float:
    # Circular midpoint on hue circle
    da = (b - a) % 1.0
    return (a + da / 2.0) % 1.0


def pick_dualtone_bridge(
    entries: List[PaletteEntry],
) -> Tuple[Tuple[int, int, int], List[PaletteEntry]]:
    # Take top two distinct hues (ignore greys)
    vivid = [e for e in entries if e.hsv[1] >= 0.15]
    if len(vivid) < 2:
        return pick_dominant_vibrant(entries)
    h1 = vivid[0].hsv[0]
    # find a second with hue far enough
    second = None
    for e in vivid[1:]:
        dh = min((e.hsv[0] - h1) % 1.0, (h1 - e.hsv[0]) % 1.0)
        if dh > (40 / 360):
            second = e
            break
    if not second:
        return pick_dominant_vibrant(entries)
    h2 = second.hsv[0]
    h = mid_hue(h1, h2)
    s = clamp(max(vivid[0].hsv[1], second.hsv[1]) * 0.9, 0.5, 0.9)
    v = clamp(max(vivid[0].hsv[2], second.hsv[2]) * 1.05, 0.6, 0.92)
    return hsv_to_rgb(h, s, v), vivid[:8]


def pick_multicolor(
    entries: List[PaletteEntry],
) -> Tuple[Tuple[int, int, int], List[PaletteEntry]]:
    # Choose the most "vibrant-major" cluster: freq × vibrancy, but avoid neon extremes
    cands = [e for e in entries if 0.45 <= e.hsv[2] <= 0.95]
    if not cands:
        cands = entries[:8]
    best = max(cands, key=lambda e: e.count * score_vibrancy(e))
    # Slightly raise V for border legibility
    h, s, v = best.hsv
    rgb = hsv_to_rgb(h, clamp(s, 0.55, 0.9), clamp(v * 1.05, 0.6, 0.92))
    return rgb, cands


def pick_contrast_safe(
    entries: List[PaletteEntry], mean_lab: Tuple[float, float, float]
) -> Tuple[Tuple[int, int, int], List[PaletteEntry]]:
    # Maximize ΔE from average image color, within vivid & bright bounds
    cands = [e for e in entries if e.hsv[1] >= 0.4 and 0.55 <= e.hsv[2] <= 0.92]
    if not cands:
        cands = entries[:8]
    best = max(cands, key=lambda e: delta_e_lab(e.lab, mean_lab))
    # Slight saturation polish
    h, s, v = best.hsv
    rgb = hsv_to_rgb(h, clamp(s * 1.05, 0.5, 0.95), v)
    return rgb, cands


def pick_monochrome_accent(
    ana: Analysis,
) -> Tuple[Tuple[int, int, int], List[PaletteEntry]]:
    # Create a synthetic accent that contrasts global luminance and warms/cools by bias
    # Warm for dark images, cool for bright images (pleasant pop)
    if ana.mean_luminance < 0.5:
        h = 35 / 360  # warm amber
        s = 0.80
        v = 0.82
    else:
        h = 200 / 360  # cool cyan-blue
        s = 0.70
        v = 0.68
    return hsv_to_rgb(h, s, v), []


def adjust_for_scene_luminance(
    rgb: Tuple[int, int, int], ana: Analysis
) -> Tuple[int, int, int]:
    # Final polish: if scene is dark, ensure accent V≥0.70; if bright, ensure V≤0.85
    h, s, v = rgb_to_hsv(*rgb)
    if ana.mean_luminance < 0.40:
        v = max(v, 0.72)
        s = clamp(s, 0.65, 0.95)
    elif ana.mean_luminance > 0.72:
        v = min(v, 0.85)
        s = clamp(s, 0.55, 0.90)
    return hsv_to_rgb(h, s, v)


def complement(rgb: Tuple[int, int, int]) -> Tuple[int, int, int]:
    h, s, v = rgb_to_hsv(*rgb)
    return hsv_to_rgb((h + 0.5) % 1.0, s, v)


# --------------------------
# Swatch rendering
# --------------------------


def render_swatch_with_reference(
    ref_image,
    rows,  # List[List[(r,g,b)]]
    labels,  # List[str] (row labels)
    selected_rgb,  # (r,g,b) overlayed on the image
    *,
    cell_labels=None,  # Optional: List[List[str]] parallel to rows
    complement_rgb=None,  # optional
    cell: int = 60,
    padding: int = 8,
    label_height: int = 22,
    ref_max_side: int = 380,
    overlay_size: int = 110,
    overlay_alpha: int = 196,
    overlay_corner: str = "br",
):
    # --- prepare reference image ---
    w, h = ref_image.size
    if w >= h:
        new_w = min(ref_max_side, w)
        new_h = int(round(h * (new_w / w)))
    else:
        new_h = min(ref_max_side, h)
        new_w = int(round(w * (new_h / h)))
    ref_disp = ref_image.convert("RGB").resize((new_w, new_h), Image.LANCZOS)

    cols = max((len(r) for r in rows), default=1)
    swatch_width = cols * cell + (cols + 1) * padding
    swatch_height = padding + sum(label_height + cell + padding for _ in rows)

    left_w, left_h = new_w, new_h
    right_w, right_h = swatch_width, swatch_height
    canvas_w = padding + left_w + padding + right_w + padding
    canvas_h = padding + max(left_h, right_h) + padding

    canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    # fonts
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None
    label_font = font
    tiny_font = font

    # --- paste reference ---
    left_x = padding
    left_y = padding
    canvas.paste(ref_disp, (left_x, left_y))

    # --- overlay selected color on reference ---
    ox = left_x + (
        left_w - overlay_size - padding if overlay_corner in ("tr", "br") else padding
    )
    oy = left_y + (
        left_h - overlay_size - padding if overlay_corner in ("bl", "br") else padding
    )

    # shadow
    shadow_pad = 3
    shadow_rect = [
        ox + shadow_pad,
        oy + shadow_pad,
        ox + overlay_size + shadow_pad,
        oy + overlay_size + shadow_pad,
    ]
    draw.rounded_rectangle(shadow_rect, radius=10, fill=(0, 0, 0, 90))

    sr, sg, sb = selected_rgb
    overlay_rect = [ox, oy, ox + overlay_size, oy + overlay_size]
    draw.rounded_rectangle(
        overlay_rect,
        radius=10,
        fill=(sr, sg, sb, overlay_alpha),
        outline=(0, 0, 0, 160),
        width=2,
    )

    if font:
        hex_text = f"#{sr:02X}{sg:02X}{sb:02X}"
        luminance = (0.2126 * sr + 0.7152 * sg + 0.0722 * sb) / 255.0
        text_fill = (0, 0, 0, 230) if luminance > 0.6 else (255, 255, 255, 230)
        tw = draw.textlength(hex_text, font=font)
        th = font.size
        tx = ox + overlay_size - padding - int(tw)
        ty = oy + overlay_size - padding - th
        bg = [tx - 3, ty - 2, tx + int(tw) + 3, ty + th + 2]
        draw.rounded_rectangle(bg, radius=4, fill=(0, 0, 0, 60))
        draw.text((tx, ty), hex_text, font=font, fill=text_fill)

    # --- swatch area on the right ---
    right_x = left_x + left_w + padding
    y = padding

    for ri, row in enumerate(rows):
        # row label
        if ri < len(labels) and label_font:
            draw.text(
                (right_x + padding, y),
                labels[ri],
                fill=(255, 255, 255, 230),
                font=label_font,
            )
        y += label_height

        x = right_x + padding
        for ci in range(cols):
            rect = [x, y, x + cell, y + cell]
            if ci < len(row):
                r, g, b = row[ci]
                draw.rectangle(rect, fill=(r, g, b, 255), outline=(0, 0, 0, 160))
                # per-cell small label (if provided)
                if cell_labels and ri < len(cell_labels) and ci < len(cell_labels[ri]):
                    txt = cell_labels[ri][ci]
                    if txt:
                        # draw a small translucent ribbon at bottom of the cell
                        ribbon_h = 14
                        ribbon = [rect[0], rect[3] - ribbon_h, rect[2], rect[3]]
                        draw.rectangle(ribbon, fill=(0, 0, 0, 120))
                        if tiny_font:
                            # clamp/ellipsis label to fit
                            maxw = cell - 6
                            s = txt
                            while (
                                draw.textlength(s, font=tiny_font) > maxw and len(s) > 1
                            ):
                                s = s[:-2] + "…"
                            tx = rect[0] + 3
                            ty = rect[3] - ribbon_h + (ribbon_h - tiny_font.size) // 2
                            draw.text(
                                (tx, ty), s, fill=(255, 255, 255, 230), font=tiny_font
                            )
            else:
                draw.rectangle(rect, fill=(0, 0, 0, 0), outline=(40, 40, 40, 160))
            x += cell + padding

        y += cell + padding

    return canvas


def compute_other_method_choices(entries, ana, selected_method_name, mean_lab):
    """
    Returns a list of (label, rgb) for all strategies except `selected_method_name`.
    """
    # Strategy functions should return (rgb, candidates) except monochrome which returns (rgb, [])
    strategies = [
        ("Dominant Vibrant", lambda: pick_dominant_vibrant(entries)[0]),
        ("Complement of Dominant", lambda: pick_complement_of_dominant(entries)[0]),
        ("Dual-Tone Bridge", lambda: pick_dualtone_bridge(entries)[0]),
        ("Multi-Color Dominant", lambda: pick_multicolor(entries)[0]),
        ("Contrast-Safe Vivid", lambda: pick_contrast_safe(entries, mean_lab)[0]),
        ("Monochrome Accent", lambda: pick_monochrome_accent(ana)[0]),
    ]
    out = []
    for name, fn in strategies:
        if name == selected_method_name:
            continue
        try:
            rgb = fn()
            out.append((name, rgb))
        except Exception:
            # Be resilient: skip failures for edge cases
            pass
    return out


def method_name_for_category(cat_name: str) -> str:
    if cat_name == "Monochrome/Desaturated":
        return "Monochrome Accent"
    if cat_name == "Dominant Color":
        return "Complement of Dominant"
    if cat_name == "Dual-Tone":
        return "Dual-Tone Bridge"
    if cat_name == "Multi-Color":
        return "Multi-Color Dominant"
    # Low/High/Balanced fall back to contrast-safe
    return "Contrast-Safe Vivid"


def render_swatch(
    rows: List[List[Tuple[int, int, int]]],
    labels: List[str],
    cell: int = 60,
    padding: int = 6,
) -> Image.Image:
    cols = max((len(r) for r in rows), default=1)
    width = cols * cell + (cols + 1) * padding
    height = len(rows) * cell + (len(rows) + 1) * padding + 24  # space for labels
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # try a default font; silently skip if missing
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None

    y = padding
    for ri, row in enumerate(rows):
        x = padding
        # label
        label = labels[ri] if ri < len(labels) else ""
        if font:
            draw.text((x, y), label, fill=(255, 255, 255, 255), font=font)
        y += 24
        x = padding
        for col in range(cols):
            rect = [x, y, x + cell, y + cell]
            if col < len(row):
                r, g, b = row[col]
                draw.rectangle(rect, fill=(r, g, b, 255), outline=(0, 0, 0, 255))
            else:
                draw.rectangle(rect, fill=(0, 0, 0, 0), outline=(40, 40, 40, 255))
            x += cell + padding
        y += cell + padding
    return img


# --------------------------
# Main pipeline
# --------------------------


def main():
    ap = argparse.ArgumentParser(
        description="Pick a bright, vibrant accent color from a wallpaper."
    )
    ap.add_argument("image", help="Input image path")
    ap.add_argument(
        "--palette-size", type=int, default=24, help="Palette size (default: 24)"
    )
    ap.add_argument("--verbose", action="store_true", help="Print diagnostics")
    ap.add_argument("--swatch-out", default=None, help="Path to save a swatch PNG")
    args = ap.parse_args()

    img = Image.open(args.image).convert("RGB")
    entries = extract_palette(img, palette_size=args.palette_size)

    ana = analyze(entries)
    cat = categorize(ana)

    if args.verbose:
        print(f"Category: {cat.name} — {cat.reason}")
        print(f"Mean luminance (L*): {ana.mean_luminance * 100:.1f}")
        print(f"Saturation mean/std: {ana.sat_mean:.3f}/{ana.sat_std:.3f}")
        print(
            f"Dominant weight: {ana.dominant_weight:.2f}, Hue clusters: {ana.num_hue_clusters}, Hue spread: {ana.hue_spread:.2f}"
        )
        print("\nTop palette entries:")
        for e in entries[: min(10, len(entries))]:
            print(
                f"  {rgb_to_hex(e.rgb)} count={e.count:>6}  H={e.hsv[0]:.3f} S={e.hsv[1]:.3f} V={e.hsv[2]:.3f}"
            )

    # Choose strategy per category
    selected_rgb: Tuple[int, int, int]
    candidates: List[PaletteEntry]

    if cat.name == "Monochrome/Desaturated":
        selected_rgb, _ = pick_monochrome_accent(ana)
        candidates = []
    elif cat.name == "Dominant Color":
        selected_rgb, candidates = pick_complement_of_dominant(entries)
    elif cat.name == "Dual-Tone":
        selected_rgb, candidates = pick_dualtone_bridge(entries)
    elif cat.name == "Multi-Color":
        selected_rgb, candidates = pick_multicolor(entries)
    elif cat.name in ("Low Brightness", "High Brightness", "Balanced"):
        # Contrast-safe but still vivid (solid default)
        selected_rgb, candidates = pick_contrast_safe(entries, ana.mean_lab)
    else:
        selected_rgb, candidates = pick_dominant_vibrant(entries)

    # Scene-based polish
    selected_rgb = adjust_for_scene_luminance(selected_rgb, ana)
    comp_rgb = complement(selected_rgb)

    print(rgb_to_hex(selected_rgb))
    print(f"Selected:   {rgb_to_hex(selected_rgb)}")
    print(f"Complement: {rgb_to_hex(comp_rgb)}")

    selected_method = method_name_for_category(cat.name)

    # Compute other methods' picks
    variants = compute_other_method_choices(entries, ana, selected_method, ana.mean_lab)
    # Cap to 8 cells to keep layout tidy (optional)
    variants = variants[:8]

    # Build rows and per-cell labels
    palette_row = [e.rgb for e in entries[: min(16, len(entries))]]
    filtered_row = [e.rgb for e in entries if e.hsv[1] >= 0.35 and e.hsv[2] >= 0.50][
        :16
    ]
    selected_row = [selected_rgb]
    complement_row = [comp_rgb]
    others_row = [rgb for _, rgb in variants]

    rows = [palette_row, filtered_row, selected_row, complement_row, others_row]
    labels = [
        "Initial palette",
        "Vivid candidates",
        "Selected accent",
        "Complement",
        "Other methods",
    ]

    # Per-cell labels (only for the last row)
    cell_labels = [
        [],
        [],
        [],
        [],
        [name for name, _ in variants],  # labels under each cell in "Other methods"
    ]

    # Create the composite swatch (with reference image on the left)
    swatch_img = render_swatch_with_reference(
        ref_image=img,
        rows=rows,
        labels=labels,
        selected_rgb=selected_rgb,
        cell_labels=cell_labels,  # <-- new
        ref_max_side=380,
        overlay_size=110,
        overlay_alpha=196,
        overlay_corner="br",
    )
    swatch_img.save(args.swatch_out)

    if args.verbose:
        print(f"Swatch written to: {args.swatch_out}")


if __name__ == "__main__":
    main()
