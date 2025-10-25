#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Score & Select accent color from a wallpaper, with ranked candidates visualized
under the image preview.

Methods included:
- Dominant Vibrant
- Complement of Dominant (brightened)
- Contrast-Safe Vivid (max ΔE to global mean within vivid bounds)
- Dual-Tone Bridge (with guardrails + chromatic midpoint local search)
- Cool Contrast Heuristic (for warm wood/stone scenes)

Swatch:
- Left: reference image with overlay of the selected color
- Under the image: ranked candidates (name + score)
- Right: initial palette and vivid candidates for context

Usage:
  python accent_picker_ranked.py <image> --swatch-out out.png --verbose
"""

from __future__ import annotations
import argparse
import math
from dataclasses import dataclass
from typing import List, Tuple, Dict, Any
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from skimage import color as skcolor


# ---------------------- Color helpers ----------------------
def clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


def rgb_to_hex(rgb):
    r, g, b = rgb
    return f"#{r:02X}{g:02X}{b:02X}"


def rgb_to_hsv(r, g, b):
    r, g, b = [x / 255.0 for x in (r, g, b)]
    mx, mn = max(r, g, b), min(r, g, b)
    diff = mx - mn
    if diff == 0:
        h = 0.0
    elif mx == r:
        h = ((g - b) / diff) % 6
    elif mx == g:
        h = (b - r) / diff + 2
    else:
        h = (r - g) / diff + 4
    h = (h / 6.0) % 1.0
    s = 0.0 if mx == 0 else diff / mx
    v = mx
    return (h, s, v)


def hsv_to_rgb(h, s, v):
    h = (h % 1.0) * 6
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


def _srgb_to_linear(c):
    return (c / 12.92) if c <= 0.04045 else (((c + 0.055) / 1.055) ** 2.4)


def rgb_to_xyz(r, g, b):
    R, G, B = [_srgb_to_linear(x / 255.0) for x in (r, g, b)]
    X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375
    Y = R * 0.2126729 + G * 0.7151522 + B * 0.0721750
    Z = R * 0.0193339 + G * 0.1191920 + B * 0.9503041
    return (X, Y, Z)


def xyz_to_lab(x, y, z):
    Xn, Yn, Zn = 0.95047, 1.0, 1.08883

    def f(t):
        return t ** (1 / 3) if t > 0.008856 else (7.787 * t + 16 / 116)

    fx, fy, fz = f(x / Xn), f(y / Yn), f(z / Zn)
    L = 116 * fy - 16
    a = 500 * (fx - fy)
    b = 200 * (fy - fz)
    return (L, a, b)


def rgb_to_lab(rgb):
    return xyz_to_lab(*rgb_to_xyz(*rgb))


def delta_e_lab(l1, l2):
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(l1, l2)))


def perceived_luminance(rgb):
    L, _, _ = rgb_to_lab(rgb)
    return clamp(L / 100.0, 0, 1)


# ---------------------- Palette extraction ----------------------
@dataclass
class PaletteEntry:
    rgb: Tuple[int, int, int]
    count: int
    hsv: Tuple[float, float, float]
    lab: Tuple[float, float, float]


@dataclass
class PaletteEntry:
    rgb: Tuple[int, int, int]
    count: int
    hsv: Tuple[float, float, float]
    lab: Tuple[float, float, float]


def _downscale(img: Image.Image, sample_px: int) -> Image.Image:
    w, h = img.size
    scale = min(1.0, sample_px / max(w, h))
    if scale < 1.0:
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    return img.convert("RGB")


def _sobel_magnitude(gray: np.ndarray) -> np.ndarray:
    # gray: HxW float32 0..1
    # simple 3x3 Sobel
    kx = np.array([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], dtype=np.float32)
    ky = np.array([[1, 2, 1], [0, 0, 0], [-1, -2, -1]], dtype=np.float32)
    from scipy.signal import (
        convolve2d,
    )  # if you don't want scipy, do separable convs manually

    gx = convolve2d(gray, kx, mode="same", boundary="symm")
    gy = convolve2d(gray, ky, mode="same", boundary="symm")
    mag = np.hypot(gx, gy)
    return mag


def _center_prior(h: int, w: int) -> np.ndarray:
    y, x = np.mgrid[0:h, 0:w]
    cy, cx = (h - 1) / 2.0, (w - 1) / 2.0
    r = np.hypot((y - cy) / h, (x - cx) / w)
    # 1 at center, ~0.2 at far corners
    prior = np.exp(-((r / 0.5) ** 2))
    prior = 0.2 + 0.8 * (prior - prior.min()) / (prior.max() - prior.min() + 1e-6)
    return prior.astype(np.float32)


def _rgb_to_hsv_np(rgb: np.ndarray) -> np.ndarray:
    # rgb uint8 HxWx3 -> hsv float32 HxWx3 (h 0..1, s 0..1, v 0..1)
    r = rgb[..., 0] / 255.0
    g = rgb[..., 1] / 255.0
    b = rgb[..., 2] / 255.0
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    diff = mx - mn
    h = np.zeros_like(mx)
    mask = diff != 0
    # avoid divide-by-zero
    rmask = (mx == r) & mask
    gmask = (mx == g) & mask
    bmask = (mx == b) & mask
    h[rmask] = ((g[rmask] - b[rmask]) / diff[rmask]) % 6.0
    h[gmask] = ((b[gmask] - r[gmask]) / diff[gmask]) + 2.0
    h[bmask] = ((r[bmask] - g[bmask]) / diff[bmask]) + 4.0
    h = (h / 6.0) % 1.0
    s = np.where(mx == 0, 0.0, diff / (mx + 1e-8))
    v = mx
    hsv = np.stack([h, s, v], axis=-1).astype(np.float32)
    return hsv


def _sample_weight_map(rgb_np: np.ndarray) -> np.ndarray:
    # rgb_np: HxWx3 uint8
    h, w, _ = rgb_np.shape
    hsv = _rgb_to_hsv_np(rgb_np)
    s = hsv[..., 1]
    v = hsv[..., 2]
    # vibrancy
    vibr = (s**1.2) * 0.65 + (v**1.0) * 0.35
    # structure via Sobel on luma
    luma = (
        0.2126 * rgb_np[..., 0] + 0.7152 * rgb_np[..., 1] + 0.0722 * rgb_np[..., 2]
    ) / 255.0
    try:
        grad = _sobel_magnitude(luma.astype(np.float32))
        grad = grad / (grad.max() + 1e-8)
    except Exception:
        grad = np.zeros_like(luma, dtype=np.float32)
    center = _center_prior(h, w)
    # combine (weights tuned gently)
    w_map = 0.55 * vibr + 0.30 * grad + 0.15 * center
    # downweight near-greys a little more
    w_map = w_map * (0.5 + 0.5 * np.clip((s - 0.08) / 0.4, 0, 1))
    # avoid zeros
    w_map = np.clip(w_map, 1e-6, None)
    return w_map.astype(np.float32), hsv


def _weighted_choice_idx(
    weights: np.ndarray, k: int, rng: np.random.Generator
) -> np.ndarray:
    # sample k indices without replacement, proportional to weights
    w = weights.copy()
    w_sum = w.sum()
    if w_sum <= 0 or k >= w.size:
        return np.arange(min(k, w.size))
    idxs = []
    for _ in range(k):
        r = rng.random() * w_sum
        acc = 0.0
        j = 0
        # accelerate with cumulative sum search
        cs = np.cumsum(w)
        j = np.searchsorted(cs, r)
        idxs.append(int(j))
        w_sum -= w[j]
        w[j] = 0.0
        if w_sum <= 0:
            break
    return np.array(idxs, dtype=np.int32)


def _lab_array_from_rgb(rgb_smpl: np.ndarray) -> np.ndarray:
    # rgb_smpl: Nx3 uint8 -> Nx3 float Lab
    out = np.empty((rgb_smpl.shape[0], 3), dtype=np.float32)
    for i, (r, g, b) in enumerate(rgb_smpl.tolist()):
        L, a, b2 = rgb_to_lab((r, g, b))
        out[i] = (L, a, b2)
    return out


def _kmeans_pp_init_lab(
    lab: np.ndarray, weights: np.ndarray, k: int, rng: np.random.Generator
) -> np.ndarray:
    # lab: Nx3, weights: N
    N = lab.shape[0]
    centers = []
    # first center: weighted choice
    p0 = _weighted_choice_idx(weights, 1, rng)[0]
    centers.append(lab[p0])
    # next centers by distance^2 * weight
    d2 = np.full(N, np.inf, dtype=np.float64)
    for _ in range(1, k):
        # update d2
        last = centers[-1]
        dist = np.sum((lab - last) ** 2, axis=1)
        d2 = np.minimum(d2, dist)
        probs = d2 * (weights + 1e-12)
        if probs.sum() <= 0:
            p = rng.integers(0, N)
        else:
            probs = probs / probs.sum()
            p = rng.choice(N, p=probs)
        centers.append(lab[p])
    return np.stack(centers, axis=0)


def _weighted_kmeans_lab(
    lab: np.ndarray,
    weights: np.ndarray,
    k: int,
    iters: int = 12,
    rng: np.random.Generator = None,
) -> Tuple[np.ndarray, np.ndarray]:
    if rng is None:
        rng = np.random.default_rng(42)
    centers = _kmeans_pp_init_lab(lab, weights, k, rng)
    N = lab.shape[0]
    assign = np.zeros(N, dtype=np.int32)
    for _ in range(iters):
        # assign
        dists = np.sum((lab[:, None, :] - centers[None, :, :]) ** 2, axis=2)  # NxK
        assign = np.argmin(dists, axis=1)
        # update
        for j in range(k):
            m = assign == j
            if not np.any(m):
                # re-seed to a random point
                jnew = rng.integers(0, N)
                centers[j] = lab[jnew]
                continue
            w = weights[m][:, None]
            centers[j] = np.sum(lab[m] * w, axis=0) / (w.sum() + 1e-8)
    return centers, assign


def extract_palette_advanced(
    img: Image.Image, palette_size: int = 24, sample_px: int = 720, rng_seed: int = 1234
) -> List[PaletteEntry]:
    """
    Advanced palette extractor that keeps minority vivid highlights.
    Returns PaletteEntry list sorted by weighted cluster size.
    """
    rng = np.random.default_rng(rng_seed)
    im = _downscale(img, sample_px)
    rgb = np.array(im, dtype=np.uint8)  # HxWx3
    H, W, _ = rgb.shape

    # weights from vibrancy + edges + center; also hava HSV for gates
    w_map, hsv = _sample_weight_map(rgb)
    weights_flat = w_map.reshape(-1)
    rgb_flat = rgb.reshape(-1, 3)
    hsv_flat = hsv.reshape(-1, 3)

    # build a stratified sample: keep more vivid pixels, plus a slice of the rest
    vivid_mask = (hsv_flat[:, 1] >= 0.35) & (hsv_flat[:, 2] >= 0.50)
    idx_vivid = np.where(vivid_mask)[0]
    idx_rest = np.where(~vivid_mask)[0]

    # sample sizes
    N_total = min(40000, rgb_flat.shape[0])
    N_vivid = min(int(N_total * 0.70), idx_vivid.size)
    N_rest = min(N_total - N_vivid, idx_rest.size)

    if N_vivid > 0:
        w_v = weights_flat[idx_vivid]
        w_v = w_v / (w_v.sum() + 1e-8)
        smp_v = rng.choice(idx_vivid, size=N_vivid, replace=False, p=w_v)
    else:
        smp_v = np.array([], dtype=np.int64)

    if N_rest > 0:
        w_r = weights_flat[idx_rest]
        w_r = w_r / (w_r.sum() + 1e-8)
        smp_r = rng.choice(idx_rest, size=N_rest, replace=False, p=w_r)
    else:
        smp_r = np.array([], dtype=np.int64)

    smp_idx = np.concatenate([smp_v, smp_r])
    smp_rgb = rgb_flat[smp_idx]
    smp_hsv = hsv_flat[smp_idx]
    smp_w = weights_flat[smp_idx].astype(np.float64)
    smp_w = smp_w / (smp_w.sum() + 1e-12)

    # k split: major vs accent seeds
    k = palette_size
    k_major = max(1, int(round(k * 0.7)))
    k_accent = max(1, k - k_major)

    # Run weighted k-means (one pass) on all samples
    smp_lab = _lab_array_from_rgb(smp_rgb)

    # Two-phase init: major seeds by overall mass, accent seeds by vivid, low-density
    centers_major, assign_major = _weighted_kmeans_lab(
        smp_lab, smp_w, k_major, iters=6, rng=rng
    )

    # density estimate (distance to nearest major center)
    d2 = np.min(
        np.sum((smp_lab[:, None, :] - centers_major[None, :, :]) ** 2, axis=2), axis=1
    )
    # accent weights: vivid, far from majors
    accent_gate = (smp_hsv[:, 1] >= 0.55) & (
        smp_hsv[:, 2].between(0.60, 0.92, inclusive="neither")
        if hasattr(np.ndarray, "between")
        else ((smp_hsv[:, 2] >= 0.60) & (smp_hsv[:, 2] <= 0.92))
    )
    accent_score = (smp_hsv[:, 1] ** 1.2) * 0.7 + (smp_hsv[:, 2] ** 1.0) * 0.3
    accent_w = (accent_score * (d2 / (d2.max() + 1e-8))) * smp_w
    # pick accent seeds via kmeans++ with accent weights
    if accent_w.sum() > 0 and k_accent > 0:
        accent_w = accent_w / accent_w.sum()
        # seed set: choose k_accent points ~ accent_w
        idx_accent = _weighted_choice_idx(accent_w, k_accent, rng)
        centers_accent = smp_lab[idx_accent]
        centers_init = np.vstack([centers_major, centers_accent])
    else:
        centers_init = centers_major
        k_accent = 0  # none found

    # final kmeans starting from combined centers
    # lightweight re-run: a few iterations to refine
    def _kmeans_from_init(lab, weights, init, iters=8):
        centers = init.copy()
        N = lab.shape[0]
        K = centers.shape[0]
        for _ in range(iters):
            dists = np.sum((lab[:, None, :] - centers[None, :, :]) ** 2, axis=2)
            assign = np.argmin(dists, axis=1)
            for j in range(K):
                m = assign == j
                if not np.any(m):
                    # re-seed from farthest point
                    far = np.argmax(np.min(dists, axis=1))
                    centers[j] = lab[far]
                    continue
                w = weights[m][:, None]
                centers[j] = np.sum(lab[m] * w, axis=0) / (w.sum() + 1e-8)
        return centers, assign

    centers, assign = _kmeans_from_init(smp_lab, smp_w, centers_init, iters=8)

    # gather clusters → PaletteEntry
    K = centers.shape[0]
    out: List[PaletteEntry] = []
    for j in range(K):
        m = assign == j
        if not np.any(m):
            continue
        w = smp_w[m][:, None]
        rgb_mean = np.sum(smp_rgb[m] * w, axis=0) / (w.sum() + 1e-8)
        rgb_mean = np.clip(np.round(rgb_mean), 0, 255).astype(np.uint8)
        rgb_tuple = (int(rgb_mean[0]), int(rgb_mean[1]), int(rgb_mean[2]))
        hsv = rgb_to_hsv(*rgb_tuple)
        lab = rgb_to_lab(rgb_tuple)
        count = int(round((smp_w[m].sum()) * (H * W)))  # pseudo-count (scaled)
        out.append(PaletteEntry(rgb_tuple, count, hsv, lab))

    # merge near-duplicates in Lab (ΔE < 5)
    merged: List[PaletteEntry] = []
    taken = [False] * len(out)
    for i, e in enumerate(out):
        if taken[i]:
            continue
        accum_w = e.count
        sum_rgb = np.array(e.rgb, dtype=np.float64) * e.count
        members = [i]
        for j, f in enumerate(out[i + 1 :], start=i + 1):
            if taken[j]:
                continue
            if delta_e_lab(e.lab, f.lab) < 5.0:
                taken[j] = True
                accum_w += f.count
                sum_rgb += np.array(f.rgb, dtype=np.float64) * f.count
                members.append(j)
        rgb_mean = np.clip(np.round(sum_rgb / max(accum_w, 1)), 0, 255).astype(np.uint8)
        rgb_tuple = (int(rgb_mean[0]), int(rgb_mean[1]), int(rgb_mean[2]))
        merged.append(
            PaletteEntry(
                rgb_tuple, accum_w, rgb_to_hsv(*rgb_tuple), rgb_to_lab(rgb_tuple)
            )
        )

    # Accent promotion: ensure at least 3 minor vivid clusters survive
    merged.sort(key=lambda e: e.count, reverse=True)
    vivid_sorted = sorted(
        merged, key=lambda e: (-(e.hsv[1] ** 1.2 * 0.7 + e.hsv[2] * 0.3), -e.count)
    )
    # ensure we have at least M vivid accents in top palette
    M = min(3, max(1, palette_size // 8))
    promoted = vivid_sorted[:M]
    # build final set: take top (palette_size-M) by count + promoted, dedup by hex
    by_count = merged[: max(0, palette_size - len(promoted))]
    final = promoted + by_count
    # dedup stable
    seen = set()
    uniq: List[PaletteEntry] = []
    for e in final:
        key = e.rgb
        if key in seen:
            continue
        seen.add(key)
        uniq.append(e)

    # If still short (rare), fill with next vivid
    kshort = palette_size - len(uniq)
    if kshort > 0:
        for e in vivid_sorted[M:]:
            if e.rgb in seen:
                continue
            uniq.append(e)
            seen.add(e.rgb)
            if len(uniq) >= palette_size:
                break

    # sort by pseudo-frequency but keep vivid ones near front
    uniq.sort(
        key=lambda e: (e.count, (e.hsv[1] ** 1.2) * 0.7 + e.hsv[2] * 0.3), reverse=True
    )
    return uniq


# ---------------------- Analysis ----------------------
@dataclass
class Analysis:
    total: int
    mean_rgb: Tuple[int, int, int]
    mean_lab: Tuple[float, float, float]
    mean_L: float
    dominant_hue: float


def analyze(entries: List[PaletteEntry]) -> Analysis:
    total = sum(e.count for e in entries)
    mr = int(round(sum(e.rgb[0] * e.count for e in entries) / total))
    mg = int(round(sum(e.rgb[1] * e.count for e in entries) / total))
    mb = int(round(sum(e.rgb[2] * e.count for e in entries) / total))
    mean_rgb = (mr, mg, mb)
    mean_lab = rgb_to_lab(mean_rgb)
    mean_L = perceived_luminance(mean_rgb)
    # dominant hue: first vivid entry
    dom_hue = 0.0
    for e in entries:
        if e.hsv[1] >= 0.12:
            dom_hue = e.hsv[0]
            break
    return Analysis(total, mean_rgb, mean_lab, mean_L, dom_hue)


# ---------------------- Scoring (with breakdown) ----------------------
# Tunable weights
W_VIB = 0.4  # vibrancy: how lively the color is (S,V)
W_DE = 0.2  # perceptual contrast (ΔE to image mean)
W_HARM = 0.15  # harmony bonus (complement / split complement)
W_SCENE = 0.05  # legibility in dark/bright scenes
W_PAL = 0.15  # proximity to actual palette hues (guards "unfitting" complements)
W_MUD = -0.15  # -0.15


def vibrancy_score(hsv):
    h, s, v = hsv
    return (s**1.2) * 0.70 + (v**1.1) * 0.30  # 0..1-ish


def harmony_bonus(h_candidate, h_dominant):
    # + if near complement or split-complement
    def circ_dist(a, b):
        return abs((a - b + 0.5) % 1.0 - 0.5)  # 0..0.5 (0..180°)

    d = circ_dist(h_candidate, (h_dominant + 0.5) % 1.0)  # complement
    split1 = circ_dist(h_candidate, (h_dominant + 1 / 3) % 1.0)  # +120°
    split2 = circ_dist(h_candidate, (h_dominant - 1 / 3) % 1.0)  # -120°
    comp = max(0.0, 1.0 - d * 6)  # ~within 30° gets near 1
    split = max(0.0, 1.0 - min(split1, split2) * 6)
    return max(0.4 * comp, 0.25 * split)  # keep modest


def scene_fit_bonus(hsv, mean_L):
    _, s, v = hsv
    good_sv = (0.55 <= s <= 0.95) and (0.60 <= v <= 0.90)
    if mean_L < 0.40:
        v_ok = v >= 0.70
    elif mean_L > 0.72:
        v_ok = v <= 0.85
    else:
        v_ok = True
    return 1.0 if (good_sv and v_ok) else 0.0


def normalized_deltaE(lab, mean_lab):
    # ΔE ~0..100 → normalize to 0..1; 60 is "very different"
    import math

    return clamp(delta_e_lab(lab, mean_lab) / 60.0, 0.0, 1.0)


def hue_gap_deg(a, b):
    # hues 0..1 → gap in degrees 0..180
    return abs(((a - b + 0.5) % 1.0) - 0.5) * 360.0


def palette_proximity_bonus(h, s, vivid_hues):
    """
    NEW: How well the candidate hue exists in the image's own vivid hues.
    - Find nearest palette hue (using only vivid entries, s>=0.25).
    - 1.0 when gap ≤ 0°, → 0.0 when gap ≥ 40°.
    - Also damp if candidate saturation is low (avoid muddy bridge).
    """
    if not vivid_hues:
        return 0.0
    nearest = min(hue_gap_deg(h, hv) for hv in vivid_hues)
    base = max(0.0, 1.0 - nearest / 40.0)  # 0..1
    sat_gate = clamp((s - 0.40) / 0.40, 0.0, 1.0)  # 0 at s=0.4 → 1 at s=0.8
    return base * sat_gate


def mud_penalty(h, s, v):
    deg = h * 360
    return 0.0 if not (30 <= deg <= 75 and s < 0.80) else 1


def score_components(hsv, lab, *, mean_lab, mean_L, h_dom, vivid_hues):
    vib = vibrancy_score(hsv)
    de = normalized_deltaE(lab, mean_lab)
    harm = harmony_bonus(hsv[0], h_dom)
    scene = scene_fit_bonus(hsv, mean_L)
    pal = palette_proximity_bonus(hsv[0], hsv[1], vivid_hues)
    mud = mud_penalty(hsv[0], hsv[1], hsv[2])
    total = (
        W_VIB * vib
        + W_DE * de
        + W_HARM * harm
        + W_SCENE * scene
        + W_PAL * pal
        + W_MUD * mud
    )
    return total, {
        "vibrancy": vib,
        "deltaE": de,
        "harmony": harm,
        "scene": scene,
        "pal_prox": pal,
        "mud": mud,
    }


# ---------------------- Methods ----------------------
def pick_dominant_vibrant(entries):
    cands = [e for e in entries if e.hsv[1] >= 0.35 and e.hsv[2] >= 0.50] or entries[:6]
    best = max(cands, key=lambda e: e.count * vibrancy_score(e.hsv))
    return best.rgb, {"note": "freq×vibrancy"}, False


def pick_complement_of_dominant(entries):
    dom = entries[0]
    h, s, v = dom.hsv
    s2 = clamp(max(s, 0.55), 0.55, 0.92)
    v2 = clamp(v * 1.10, 0.60, 0.92)
    rgb = hsv_to_rgb((h + 0.5) % 1.0, s2, v2)
    return rgb, {"note": "180° hue of dominant"}, False


def pick_contrast_safe(entries, mean_lab):
    cands = [
        e for e in entries if e.hsv[1] >= 0.45 and 0.55 <= e.hsv[2] <= 0.92
    ] or entries[:8]
    best = max(cands, key=lambda e: delta_e_lab(e.lab, mean_lab))
    h, s, v = best.hsv
    rgb = hsv_to_rgb(h, clamp(s * 1.05, 0.5, 0.95), v)
    return rgb, {"note": "max ΔE to mean"}, False


def _hue_gap(a, b):
    d = abs((a - b + 0.5) % 1.0 - 0.5)
    return d  # 0..0.5 (0..180°)


def pick_dual_tone_bridge(entries):
    # guardrails: two vivid clusters, separated ≥60°
    vivid = [e for e in entries if e.hsv[1] >= 0.30 and e.hsv[2] >= 0.45]
    if len(vivid) < 2:
        return entries[0].rgb, {"note": "bridge fallback"}, True
    h1 = vivid[0].hsv[0]
    second = None
    for e in vivid[1:]:
        if _hue_gap(h1, e.hsv[0]) >= (60 / 360):
            second = e
            break
    if not second:
        return entries[0].rgb, {"note": "bridge gap<60°"}, True

    # chromatic midpoint: try short & long arc midpoints; search ±15° among palette
    def hue_mid(a, b, short_arc=True):
        da = (b - a) % 1.0
        if not short_arc:
            da = da - 1.0  # go the long way
        return (a + da / 2.0) % 1.0

    mids = [hue_mid(h1, second.hsv[0], True), hue_mid(h1, second.hsv[0], False)]
    pool = [e for e in entries if e.hsv[2] >= 0.50]  # avoid too-dark
    best = None
    best_score = -1
    for m in mids:
        for e in pool:
            # within ±15°
            if _hue_gap(m, e.hsv[0]) <= (15 / 360):
                s_ok = e.hsv[1] >= 0.45
                if not s_ok:
                    continue
                sc = vibrancy_score(e.hsv)
                if sc > best_score:
                    best, best_score = e, sc
    if not best:
        return entries[0].rgb, {"note": "bridge local search failed"}, True
    # polish
    h, s, v = best.hsv
    rgb = hsv_to_rgb(h, clamp(s, 0.55, 0.90), clamp(v * 1.05, 0.60, 0.92))
    return rgb, {"note": "chromatic midpoint"}, False


def pick_cool_contrast_heuristic(entries):
    # If top hues are warm/earthy, try cool accent (190°–230°) with vivid bounds
    warm = 0
    for e in entries[:5]:
        h, s, _ = e.hsv
        deg = h * 360
        if 20 <= deg <= 60 and s < 0.6:
            warm += 1
    cool_pool = [
        e
        for e in entries
        if (190 <= e.hsv[0] * 360 <= 230)
        and e.hsv[1] >= 0.55
        and 0.60 <= e.hsv[2] <= 0.90
    ]
    if warm >= 2 and cool_pool:
        best = max(cool_pool, key=lambda e: e.count * vibrancy_score(e.hsv))
        return best.rgb, {"note": "cool contrast for warm scene"}, False
    # otherwise signal “not applicable”
    return entries[0].rgb, {"note": "not warm scene"}, True


def _hue_gap(a, b):
    # 0..0.5 (0..180°)
    return abs((a - b + 0.5) % 1.0 - 0.5)


def pick_minor_highlight(entries):
    """
    Pick a less-common but vivid 'highlight' hue distinct from the dominant.
    Guardrails:
      - hue gap ≥ ~50°
      - saturation ≥ 0.55, value in [0.60, 0.92]
      - share between ~1.5% and ~28% of pixels (rare but not too tiny/common)
    Score within this subset by vibrancy × contrast-to-dominant,
    with a small prior that prefers clusters around ~8% share.
    """
    if not entries:
        return (255, 255, 255), {"note": "no entries"}, True

    total = sum(e.count for e in entries)
    dom = entries[0]
    dom_h = dom.hsv[0]
    dom_lab = dom.lab

    cands = []
    for e in entries[1:]:
        share = e.count / total
        h, s, v = e.hsv

        # print("Candidate:", rgb_to_hex(e.rgb), h, s, v, "HG", _hue_gap(dom_h, h), share)

        if _hue_gap(dom_h, h) < (50 / 360):  # far enough from dominant hue
            continue
        if s < 0.55 or not (0.60 <= v <= 0.92):  # vibrant & readable
            continue
        if not (0.015 <= share <= 0.28):  # rare but not tiny/common
            continue

        # Core score: vibrancy × (normalized ΔE to dominant)
        vib = vibrancy_score(e.hsv)  # 0..1-ish
        de_dom = clamp(delta_e_lab(e.lab, dom_lab) / 60.0, 0.0, 1.0)

        # Prior: prefer ~8% share; smooth bell around this (avoids micro-noise)
        # exp(-((share-0.08)/0.06)^2) ranges ~1 near 8%, falls off gently
        prior = math.exp(-(((share - 0.08) / 0.06) ** 2))

        score = (0.65 * vib + 0.35 * de_dom) * (0.75 + 0.25 * prior)
        cands.append((score, e, share, vib, de_dom, prior))

    if not cands:
        return dom.rgb, {"note": "no suitable minor vivid cluster"}, True

    _, best, share, vib, de_dom, prior = max(cands, key=lambda t: t[0])

    # Polish for accent legibility
    h, s, v = best.hsv
    s = clamp(s, 0.60, 0.95)
    v = clamp(v, 0.65, 0.90)
    rgb = hsv_to_rgb(h, s, v)

    meta = {
        "note": f"minor hue; share={share:.1%}",
        "share": share,
        "vib": vib,
        "de_to_dom": de_dom,
        "prior": prior,
    }
    return rgb, meta, False


# ---------------------- Swatch rendering ----------------------
def render_ranked_with_reference(
    ref_image: Image.Image,
    ranked: List[Dict[str, Any]],  # [{name, rgb, score, failed, hex}]
    palette_row: List[Tuple[int, int, int]],
    vivid_row: List[Tuple[int, int, int]],
    *,
    cell: int = 60,
    padding: int = 10,
    label_h: int = 20,
    ref_max_side: int = 420,
    overlay_size: int = 120,
    overlay_alpha: int = 255,
    overlay_corner: str = "br",
) -> Image.Image:
    # Prepare reference image
    w, h = ref_image.size
    if w >= h:
        nw = min(ref_max_side, w)
        nh = int(round(h * (nw / w)))
    else:
        nh = min(ref_max_side, h)
        nw = int(round(w * (nh / h)))
    ref_disp = ref_image.convert("RGB").resize((nw, nh), Image.LANCZOS)

    # Layout: left column = image + ranked row below; right = palette rows
    cols_rank = max(1, len(ranked))
    rank_width = cols_rank * cell + (cols_rank + 1) * padding
    right_cols = max(len(palette_row), len(vivid_row))
    right_cols = max(1, right_cols)
    right_width = right_cols * cell + (right_cols + 1) * padding
    # heights
    right_height = padding + (label_h + cell + padding) * 2  # two rows + labels
    left_height = nh + padding + label_h + cell + padding
    canvas_w = padding + nw + padding + max(rank_width, right_width) + padding
    canvas_h = padding + max(left_height, right_height) + padding

    img = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None

    # Paste reference
    left_x = padding
    left_y = padding
    img.paste(ref_disp, (left_x, left_y))

    # Overlay selected (ranked[0])
    if ranked:
        sr, sg, sb = ranked[0]["rgb"]
        # position
        ox = left_x + (
            nw - overlay_size - padding if overlay_corner in ("tr", "br") else padding
        )
        oy = left_y + (
            nh - overlay_size - padding if overlay_corner in ("bl", "br") else padding
        )
        # shadow
        d.rounded_rectangle(
            [ox + 3, oy + 3, ox + overlay_size + 3, oy + overlay_size + 3],
            radius=10,
            fill=(0, 0, 0, 90),
        )
        # overlay
        d.rounded_rectangle(
            [ox, oy, ox + overlay_size, oy + overlay_size],
            radius=10,
            fill=(sr, sg, sb, overlay_alpha),
            outline=(0, 0, 0, 180),
            width=2,
        )
        if font:
            hex_text = ranked[0]["hex"]
            lum = (0.2126 * sr + 0.7152 * sg + 0.0722 * sb) / 255.0
            fill = (0, 0, 0, 230) if lum > 0.6 else (255, 255, 255, 230)
            tw = d.textlength(hex_text, font=font)
            th = font.size
            tx = ox + overlay_size - padding - int(tw)
            ty = oy + overlay_size - padding - th
            d.rounded_rectangle(
                [tx - 3, ty - 2, tx + int(tw) + 3, ty + th + 2],
                radius=4,
                fill=(0, 0, 0, 60),
            )
            d.text((tx, ty), hex_text, fill=fill, font=font)

    # Ranked candidates row under image
    rx = left_x
    ry = left_y + nh + padding
    if font:
        d.text((rx, ry), "Ranked candidates", fill=(255, 255, 255, 230), font=font)
    ry += label_h
    cx = left_x + padding
    for i, cand in enumerate(ranked):
        rect = [cx, ry, cx + cell, ry + cell]
        r, g, b = cand["rgb"]
        d.rectangle(rect, fill=(r, g, b, 255), outline=(0, 0, 0, 160))
        # rank badge & tiny label
        if font:
            # top-left rank
            badge = f"#{i + 1}"
            bw = d.textlength(badge, font=font)
            d.rectangle(
                [rect[0], rect[1], rect[0] + bw + 8, rect[1] + font.size + 6],
                fill=(0, 0, 0, 120),
            )
            d.text(
                (rect[0] + 4, rect[1] + 3), badge, fill=(255, 255, 255, 230), font=font
            )
            # bottom ribbon with name + score
            ribbon_h = 14
            d.rectangle(
                [rect[0], rect[3] - ribbon_h, rect[2], rect[3]], fill=(0, 0, 0, 120)
            )
            # bottom ribbon with name + score (+ top 1-2 contributing terms)
            parts = cand.get("parts", {})
            # compute weighted contributions for ranking which mattered most
            wc = {
                "V": W_VIB * parts.get("vibrancy", 0),
                "ΔE": W_DE * parts.get("deltaE", 0),
                "H": W_HARM * parts.get("harmony", 0),
                "S": W_SCENE * parts.get("scene", 0),
                "P": W_PAL * parts.get("pal_prox", 0),
            }
            top = sorted(wc.items(), key=lambda kv: kv[1], reverse=True)[:2]
            contrib = " + ".join([f"{k}" for k, _ in top])
            txt = f"{cand['name']} · {cand['score']:.2f} · {contrib}"
            # trim to fit
            maxw = cell - 6
            s = txt
            while d.textlength(s, font=font) > maxw and len(s) > 1:
                s = s[:-2] + "…"
            d.text(
                (rect[0] + 3, rect[3] - ribbon_h + (ribbon_h - font.size) // 2),
                s,
                fill=(255, 255, 255, 230),
                font=font,
            )
        cx += cell + padding

    # Right side: palette + vivid rows for context
    right_x = left_x + nw + padding
    y = padding
    if font:
        d.text(
            (right_x + padding, y),
            "Initial palette",
            fill=(255, 255, 255, 230),
            font=font,
        )
    y += label_h
    cols = max(len(palette_row), 1)
    x = right_x + padding
    for i in range(cols):
        rect = [x, y, x + cell, y + cell]
        if i < len(palette_row):
            r, g, b = palette_row[i]
            d.rectangle(rect, fill=(r, g, b, 255), outline=(0, 0, 0, 160))
        else:
            d.rectangle(rect, outline=(40, 40, 40, 160))
        x += cell + padding
    y += cell + padding

    if font:
        d.text(
            (right_x + padding, y),
            "Vivid candidates",
            fill=(255, 255, 255, 230),
            font=font,
        )
    y += label_h
    cols = max(len(vivid_row), 1)
    x = right_x + padding
    for i in range(cols):
        rect = [x, y, x + cell, y + cell]
        if i < len(vivid_row):
            r, g, b = vivid_row[i]
            d.rectangle(rect, fill=(r, g, b, 255), outline=(0, 0, 0, 160))
        else:
            d.rectangle(rect, outline=(40, 40, 40, 160))
        x += cell + padding

    return img


def ensure_min_luminance(rgb, min_L):
    """
    Raise a color to at least `min_L` perceived luminance (0..1) using Lab space,
    via skimage.color for correct conversions.
    """

    # rgb -> [0,1] float -> Lab
    arr = np.array(
        [[[rgb[0] / 255.0, rgb[1] / 255.0, rgb[2] / 255.0]]], dtype=np.float64
    )  # shape (1,1,3)
    lab = skcolor.rgb2lab(arr)  # L in [0,100], a/b roughly [-128,127]

    L, a, b = lab[0, 0]
    target_L = max(L, min_L * 100.0)  # clamp up to at least min_L
    lab[0, 0, 0] = target_L

    # Lab -> rgb [0,1] -> 8-bit
    out = skcolor.lab2rgb(lab)  # returns float in [0,1], clipped
    r, g, b = (np.clip(np.round(out[0, 0] * 255), 0, 255)).astype(np.uint8)
    return (int(r), int(g), int(b))


# ---------------------- Main ----------------------
def main():
    ap = argparse.ArgumentParser(
        description="Score & select a vibrant accent color; render ranked candidates under preview."
    )
    ap.add_argument("image")
    ap.add_argument("--palette-size", type=int, default=24)
    ap.add_argument("--swatch-out", default=None)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    if args.verbose:
        print("Processing:", args.image, "...")

    img = Image.open(args.image).convert("RGB")
    entries = extract_palette_advanced(img, palette_size=args.palette_size)

    ana = analyze(entries)

    # Build candidate set (method name → rgb)
    methods = [
        ("Dominant Vibrant", lambda: pick_dominant_vibrant(entries)),
        ("Complement of Dominant", lambda: pick_complement_of_dominant(entries)),
        ("Contrast-Safe Vivid", lambda: pick_contrast_safe(entries, ana.mean_lab)),
        ("Minor Highlight", lambda: pick_minor_highlight(entries)),
        ("Dual-Tone Bridge", lambda: pick_dual_tone_bridge(entries)),
        ("Cool Contrast", lambda: pick_cool_contrast_heuristic(entries)),
    ]

    # hues from palette entries that are at least somewhat vivid
    vivid_hues = [e.hsv[0] for e in entries if e.hsv[1] >= 0.25]

    candidates = []
    for name, fn in methods:
        rgb, meta, failed = fn()
        h, s, v = rgb_to_hsv(*rgb)
        lab = rgb_to_lab(rgb)

        total, parts = score_components(
            (h, s, v),
            lab,
            mean_lab=ana.mean_lab,
            mean_L=ana.mean_L,
            h_dom=ana.dominant_hue,
            vivid_hues=vivid_hues,
        )

        # If a method tripped guardrails, apply a soft penalty (still visible, rarely wins)
        if failed:
            total *= 0.85

        candidates.append(
            {
                "name": name,
                "rgb": rgb,
                "hex": rgb_to_hex(rgb),
                "score": float(total),
                "failed": bool(failed),
                "note": meta.get("note", ""),
                "parts": parts,  # <- breakdown for printing/labels
            }
        )

    # Rank
    candidates.sort(key=lambda c: c["score"], reverse=True)
    winner = candidates[0]

    # Clamp to minimum luminance 0.5
    winner["rgb"] = ensure_min_luminance(winner["rgb"], min_L=0.3)
    winner["hex"] = rgb_to_hex(winner["rgb"])

    print(winner["hex"])
    if args.verbose:
        print(
            "Selected:", winner["name"], winner["hex"], f"score={winner['score']:.3f}"
        )

        print("\nScore breakdown (weighted → total):")
        print(
            "Method".ljust(22), "Total | Vib   ΔE    Harm  Scene PalProx Mud   | Notes"
        )
        for c in candidates:
            p = c["parts"]
            # show *weighted* contributions so you can see which term drove the win
            w_v = W_VIB * p["vibrancy"]
            w_d = W_DE * p["deltaE"]
            w_h = W_HARM * p["harmony"]
            w_s = W_SCENE * p["scene"]
            w_p = W_PAL * p["pal_prox"]
            w_m = W_MUD * p["mud"]
            line = (
                f"{c['name']:<22} {c['score']:.3f} | "
                f"{w_v:>.3f} {w_d:>.3f} {w_h:>.3f} {w_s:>.3f} {w_p:>.3f}   {w_m:>.2f} | {c['note']}"
            )
            if c["failed"]:
                line += " (penalized)"

            tail = ""
            if c["name"] == "Minor Highlight":
                # these keys exist in meta; fall back if absent
                tail = f"  share={c.get('note', '')}"
            print(line + tail)

    if args.swatch_out:
        palette_row = [e.rgb for e in entries[: min(16, len(entries))]]
        vivid_row = [e.rgb for e in entries if e.hsv[1] >= 0.35 and e.hsv[2] >= 0.50][
            :16
        ]
        swatch = render_ranked_with_reference(
            ref_image=img,
            ranked=candidates,
            palette_row=palette_row,
            vivid_row=vivid_row,
            ref_max_side=420,
            overlay_size=120,
            overlay_alpha=196,
            overlay_corner="br",
        )
        swatch.save(args.swatch_out)


if __name__ == "__main__":
    main()
