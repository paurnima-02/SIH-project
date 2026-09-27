"""
reconstruct_3d.py — scoped 3D relief reconstruction for a single detected
sonar anomaly patch (not the whole survey image).

Based on the Lambertian shape-from-shading idea in Coiras et al. 2007
(brightness relates to local surface slope). Two relief modes are
available (pick with `mode=` on reconstruct_patch_from_bbox):

  - "schematic" (default): flat seabed + the object's real footprint
    shape (derived from local pixel brightness, not just its bbox
    rectangle), plus a touch of its own texture and a gentle broad
    seabed undulation. Correct choice for typical side-scan detections
    (valves, pipes, debris) sitting on an essentially flat seabed, where
    the visible "texture" in the raw pixels is speckle noise, not real
    terrain.
  - "realistic": a full multiresolution gradient-integration
    reconstruction across the whole patch, closer to the paper's Fig. 9.
    Only appropriate when the scene has real physical texture (sand
    ripples, rocky terrain) — on plain speckle-noise seabed it reliably
    produces a spiky, mountain-like mess, because there's no real slope
    signal in noise for it to recover.

Uses only cv2/numpy/Pillow — no scipy, no new dependency for this repo.

INPUT: a cropped grayscale patch around ONE detection's bbox (not the
full survey image) — crop it from the corrected sonar image, not the raw
waterfall, since pixel size needs to be real-world accurate here.

OUTPUT: heightmap array + PNG preview + OBJ mesh + JSON summary, matching
the fields added to the Detection model (estimated_height_m,
heightmap_path, mesh_path).
"""

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

print("[reconstruct_3d] loaded v3 — default mode='schematic' (flat + real footprint shape)")


# ---------------------------------------------------------------------------
# Step 1: load a patch
# ---------------------------------------------------------------------------

def load_patch(image_path: str) -> np.ndarray:
    """Load a cropped detection patch as a grayscale float32 array in [0, 1]."""
    img = Image.open(image_path).convert("L")
    arr = np.asarray(img, dtype=np.float32) / 255.0
    return arr


# ---------------------------------------------------------------------------
# Step 2: estimate a real height from the acoustic shadow
# ---------------------------------------------------------------------------

def estimate_height_from_shadow(
    patch: np.ndarray,
    pixel_size_m: float,
    sensor_altitude_m: float,
    shadow_intensity_threshold: float = 0.15,
):
    """
    Classic sonar technique: an object of height h casts a shadow of length
    L. By similar triangles with sensor altitude: h = altitude * L / range.
    Approximate, good enough for a demo number — say so if asked in Q&A.
    Returns None if no clear shadow (dark run) is found.
    """
    row_profile = patch.mean(axis=0)
    is_shadow = row_profile < shadow_intensity_threshold

    if not is_shadow.any():
        return None

    best_len, cur_len, best_start, cur_start = 0, 0, 0, 0
    for i, dark in enumerate(is_shadow):
        if dark:
            if cur_len == 0:
                cur_start = i
            cur_len += 1
            if cur_len > best_len:
                best_len, best_start = cur_len, cur_start
        else:
            cur_len = 0

    if best_len < 2:
        return None

    shadow_len_m = best_len * pixel_size_m
    range_to_far_edge_m = max((best_start + best_len) * pixel_size_m, pixel_size_m)
    height_m = sensor_altitude_m * shadow_len_m / range_to_far_edge_m
    return round(float(height_m), 3)


# ---------------------------------------------------------------------------
# Step 3a: SCHEMATIC relief — flat seabed + raised shape exactly at the
# known detection bbox. Fast, clean, not meant to look like real terrain.
# ---------------------------------------------------------------------------

def ensure_flat_margin(
    padded_patch: np.ndarray,
    local_bbox: tuple,
    min_margin_frac: float = 0.35,
) -> tuple:
    """
    Guarantees a visible flat border around the object, even if the source
    crop was taken with little or no real margin (e.g. a screenshot
    cropped tight around just one pipe/object). Pads with a constant
    background-level value rather than leaving it to hope the real image
    happened to include enough surrounding seabed — the paper's own
    figures always show a flat plate framing the reconstructed feature,
    and without this, a tightly-cropped input has literally no pixels
    left to show one.

    Returns (possibly larger) padded_patch and the local_bbox shifted to
    match the new coordinates.
    """
    h, w = padded_patch.shape
    x1, y1, x2, y2 = local_bbox
    bbox_w, bbox_h = x2 - x1, y2 - y1

    need_left = max(0, int(min_margin_frac * bbox_w) - x1)
    need_right = max(0, int(min_margin_frac * bbox_w) - (w - x2))
    need_top = max(0, int(min_margin_frac * bbox_h) - y1)
    need_bottom = max(0, int(min_margin_frac * bbox_h) - (h - y2))

    if need_left or need_right or need_top or need_bottom:
        baseline = float(np.median(padded_patch))
        padded_patch = cv2.copyMakeBorder(
            padded_patch, need_top, need_bottom, need_left, need_right,
            cv2.BORDER_CONSTANT, value=baseline,
        )
        local_bbox = (x1 + need_left, y1 + need_top, x2 + need_left, y2 + need_top)

    return padded_patch, local_bbox


def reconstruct_relief_from_bbox(
    padded_patch: np.ndarray,
    local_bbox: tuple,
    footprint_margin: float = 0.25,
    blob_threshold_std: float = 1.0,
    smooth_sigma: float = 2.5,
) -> np.ndarray:
    """
    Derives the object's actual footprint SHAPE from pixel brightness,
    instead of just raising the whole rectangular bbox uniformly. This is
    restricted to a small neighborhood around the bbox (bbox + a margin),
    not the whole padded patch — "is this pixel brighter than its
    immediate local background" is a safe, local question, unlike
    integrating slope across a wide noisy area (which is what blows up
    into spiky mountains on speckle noise). No detection/segmentation
    model needed here: the detector already told us roughly where to
    look, so simple local thresholding recovers the real shape.

    A real object's own return is rarely pixel-uniform, so thresholding
    alone tends to fragment into several separate bright blobs instead of
    one coherent shape. Morphological closing merges those fragments back
    into a single connected footprint before the final smoothing, so the
    result reads as one raised object with texture — not a cluster of
    disconnected spikes.

    padded_patch: the full padded crop (bbox + margin), grayscale float32
        in [0, 1] — same as returned by load_patch().
    local_bbox: (x1, y1, x2, y2) of the detection's bbox in this padded
        crop's own pixel coordinates.
    """
    h, w = padded_patch.shape
    x1, y1, x2, y2 = local_bbox

    margin_x = int((x2 - x1) * footprint_margin)
    margin_y = int((y2 - y1) * footprint_margin)
    rx1, ry1 = max(0, x1 - margin_x), max(0, y1 - margin_y)
    rx2, ry2 = min(w, x2 + margin_x), min(h, y2 + margin_y)

    region = padded_patch[ry1:ry2, rx1:rx2]
    denoised = cv2.GaussianBlur(region, (0, 0), sigmaX=1.0, sigmaY=1.0)

    baseline = float(np.median(denoised))       # local background level
    noise_std = float(denoised.std())
    deviation = denoised - baseline

    threshold = blob_threshold_std * noise_std
    raw_mask = (deviation > threshold).astype(np.uint8)

    # merge nearby bright fragments into one solid blob — a physical
    # object is one coherent shape even if its own return isn't perfectly
    # uniform pixel-by-pixel, so its footprint should read that way too.
    # Kernel scales with the region size so a long/thin object gets a
    # correspondingly larger merge radius, not just a compact one.
    kernel_size = max(3, int(max(region.shape) * 0.08) | 1)  # odd, scales with region size
    kernel = np.ones((kernel_size, kernel_size), np.uint8)
    closed_mask = cv2.morphologyEx(raw_mask, cv2.MORPH_CLOSE, kernel, iterations=2)

    local_height = np.where(closed_mask > 0, np.clip(deviation - threshold, 0, None), 0.0)
    local_height = cv2.GaussianBlur(local_height, (0, 0), sigmaX=smooth_sigma, sigmaY=smooth_sigma)

    mask = np.zeros((h, w), dtype=np.float32)
    mask[ry1:ry2, rx1:rx2] = local_height
    if mask.max() > 0:
        mask /= mask.max()
    return mask


def add_surface_detail(
    height: np.ndarray,
    patch: np.ndarray,
    local_bbox: tuple,
    detail_strength: float = 0.05,
) -> np.ndarray:
    """
    Optional: blend in a little of the object's own real texture so the
    raised shape isn't a totally featureless mound. Kept subtle and
    heavily smoothed — this should read as gentle surface variation, like
    Fig. 10/11 in the paper, not visible pixel noise. Detail is masked to
    only apply where the dome already has height, so the flat background
    is never touched by this.
    """
    x1, y1, x2, y2 = local_bbox
    detail = np.zeros_like(height)
    region = patch[y1:y2, x1:x2].astype(np.float32)
    region = (region - region.mean()) / (region.std() + 1e-6)
    region = cv2.GaussianBlur(region, (0, 0), sigmaX=2.0, sigmaY=2.0)
    detail[y1:y2, x1:x2] = region

    combined = height + detail_strength * detail * (height > 0.05)
    combined = np.clip(combined, 0, None)
    if combined.max() > 0:
        combined /= combined.max()
    return combined


def add_gentle_seabed_texture(
    height: np.ndarray,
    patch: np.ndarray,
    strength: float = 0.06,
    sigma: float = 15.0,
) -> np.ndarray:
    """
    Blends in a small amount of very broad, low-frequency intensity
    variation from the real patch, so the background reads as a gently
    uneven seabed instead of a mathematically perfect flat plane —
    without reintroducing pixel-level speckle as fake terrain. This is
    the key difference from full gradient-integration: a large sigma
    blur here removes essentially all speckle, leaving only slow, real
    brightness trends (lighting falloff, broad reflectivity changes) —
    it cannot produce spikes because speckle-scale variation is gone
    before this ever gets used.
    """
    broad = cv2.GaussianBlur(patch.astype(np.float32), (0, 0), sigmaX=sigma, sigmaY=sigma)
    broad = broad - broad.mean()
    peak = float(np.abs(broad).max())
    if peak > 0:
        broad = broad / peak

    combined = height + strength * broad
    combined = np.clip(combined, 0, None)
    if combined.max() > 0:
        combined /= combined.max()
    return combined


# ---------------------------------------------------------------------------
# Step 3b: REALISTIC relief — multiresolution gradient integration.
#
# This is the actual photoclinometry idea from Coiras et al.: brightness
# encodes local across-track slope, and integrating that slope rebuilds
# the surface. Naive single-pass cumsum integration amplifies speckle
# noise into "spiky mountains" (a known weakness the paper itself notes
# — see their Fig. 3 before multiresolution regularization is applied).
#
# The fix used here mirrors the paper's coarse-to-fine idea without
# needing scipy or an EM optimizer: integrate the gradient at several
# downsampled scales (noise partly cancels out at each coarser stage,
# since it's less correlated pixel-to-pixel once you've shrunk the
# image), blend the scales weighted toward the coarser ones, strip the
# residual large-scale tilt/ramp, and clip outliers before normalizing
# instead of letting a few noisy pixels dominate the range.
# ---------------------------------------------------------------------------

def geometric_incidence_correction(
    patch: np.ndarray,
    pixel_size_m: float,
    altitude_m: float,
    nadir_col_px: int = None,
) -> np.ndarray:
    """
    Removes the EXPECTED brightness falloff with range that exists even on
    a perfectly flat seabed, because incidence angle shallows out away
    from the nadir. Uses REAL sensor altitude and pixel size (from your
    nav data), with an idealized flat-seabed Lambertian cosine law
    standing in for the real beam-pattern/TVG curve you don't have —
    that's the "dummy" part, but it's a principled physical
    approximation, not an arbitrary guess. What's left after dividing this
    out is the actual local reflectivity/slope signal — real terrain and
    objects — instead of a mix of real terrain and pure geometry.
    """
    h, w = patch.shape
    if nadir_col_px is None:
        nadir_col_px = w // 2

    cols = np.arange(w)
    ground_range = np.abs(cols - nadir_col_px) * pixel_size_m
    ground_range = np.maximum(ground_range, pixel_size_m * 0.5)  # avoid singular point at nadir

    # cos(incidence angle) for a flat seabed at this altitude/range —
    # the idealized Lambertian falloff shape
    expected_falloff = altitude_m / np.sqrt(altitude_m ** 2 + ground_range ** 2)
    expected_falloff = expected_falloff / expected_falloff.max()

    # fit an overall brightness scale from the image's own per-column
    # median (since we don't have the real absolute TVG/gain constant) —
    # this only fits ONE scalar, the falloff SHAPE itself stays physical
    col_median = np.median(patch, axis=0) + 1e-6
    k = float(np.sum(col_median * expected_falloff) / np.sum(expected_falloff ** 2))
    predicted_baseline = np.maximum(k * expected_falloff, 1e-3)

    corrected = patch / predicted_baseline[np.newaxis, :]
    corrected = corrected / (np.percentile(corrected, 98) + 1e-6)
    return np.clip(corrected, 0, 1).astype(np.float32)


def reconstruct_relief_platform(
    patch: np.ndarray,
    smooth_sigma: float = 4.0,
    contrast_boost: float = 2.5,
    clahe_clip: float = 2.5,
    clahe_grid: int = 8,
) -> np.ndarray:
    """
    Builds a gently-undulating "platform" directly from local brightness —
    NO slope integration, no cumsum anywhere. This is a first-order
    approximation ("brighter looks slightly higher") rather than a true
    physical slope reconstruction, but it is inherently stable: with no
    accumulation step, there is nothing for residual noise to compound
    into spikes, no matter how noisy the source image is.

    Uses CLAHE (adaptive local contrast) instead of one global
    normalization — a real waterfall image often has one big uniform
    region (the nadir gap between swaths, or a shadow) that's much
    darker/brighter than everything else. Normalizing globally lets that
    one region set the whole scale and crushes every other real feature
    (ripples, the actual object) into near-uniform flatness. CLAHE
    equalizes contrast in local tiles instead, so small real local
    variation stays visible everywhere, not just in the most extreme
    region of the frame.
    """
    img8 = (np.clip(patch, 0, 1) * 255).astype(np.uint8)
    denoised = cv2.medianBlur(img8, 5)
    denoised = cv2.bilateralFilter(denoised, d=9, sigmaColor=40, sigmaSpace=9)

    clahe = cv2.createCLAHE(clipLimit=clahe_clip, tileGridSize=(clahe_grid, clahe_grid))
    equalized = clahe.apply(denoised)

    smoothed = cv2.GaussianBlur(equalized.astype(np.float32), (0, 0), sigmaX=smooth_sigma, sigmaY=smooth_sigma)
    smoothed = smoothed / 255.0

    baseline = float(np.median(smoothed))
    relief = (smoothed - baseline) * contrast_boost

    lo, hi = np.percentile(relief, [2, 98])
    relief = np.clip(relief, lo, hi)

    relief -= relief.min()
    if relief.max() > 0:
        relief /= relief.max()

    # trim the noisiest few pixels of border (CLAHE has less context to
    # work with right at the image edge, which is what makes the
    # perimeter look ragged rather than a clean rectangle like Fig. 6d)
    trim = max(2, int(min(relief.shape) * 0.02))
    relief[:trim, :] = relief[trim:trim + 1, :]
    relief[-trim:, :] = relief[-trim - 1:-trim, :]
    relief[:, :trim] = relief[:, trim:trim + 1]
    relief[:, -trim:] = relief[:, -trim - 1:-trim]

    return relief.astype(np.float32)


def frankot_chellappa(p: np.ndarray, q: np.ndarray) -> np.ndarray:
    """
    Frankot & Chellappa (1988): recovers a surface Z from a gradient field
    (p = dZ/dx, q = dZ/dy) via a single global least-squares solve in the
    frequency domain, instead of accumulating left-to-right like a naive
    cumsum. This is the actual mathematical fix for the earlier
    spiky-mountain failures: integration here is a division by (wx^2+wy^2)
    in frequency space, which naturally attenuates high-frequency
    components — i.e. noise gets damped, not amplified, purely as a
    consequence of the method, not from extra denoising/clipping tuning.
    """
    rows, cols = p.shape
    wx = np.fft.fftfreq(cols).reshape(1, -1) * 2 * np.pi
    wy = np.fft.fftfreq(rows).reshape(-1, 1) * 2 * np.pi
    wx, wy = np.meshgrid(np.fft.fftfreq(cols) * 2 * np.pi, np.fft.fftfreq(rows) * 2 * np.pi)

    P = np.fft.fft2(p)
    Q = np.fft.fft2(q)
    denom = wx ** 2 + wy ** 2
    denom[0, 0] = 1.0  # avoid divide-by-zero at DC (mean height is undefined from gradients anyway)

    Z_hat = (-1j * wx * P - 1j * wy * Q) / denom
    Z_hat[0, 0] = 0.0
    return np.real(np.fft.ifft2(Z_hat))


def reconstruct_relief_slope(
    patch: np.ndarray,
    clip_percentile: float = 98.0,
) -> np.ndarray:
    """
    Real slope-based reconstruction: brightness is treated as encoding
    across-track slope (dZ/dx) — the same Lambertian assumption the paper
    uses — with no independent along-track slope signal assumed (q = 0,
    matching side-scan sonar's beam geometry). Heavy denoising first kills
    speckle before it ever becomes a gradient; Frankot-Chellappa then
    integrates it globally, which is what actually keeps this stable
    instead of a small tuning tweak papering over an unstable method.
    """
    img8 = (np.clip(patch, 0, 1) * 255).astype(np.uint8)
    denoised = cv2.medianBlur(img8, 5)
    denoised = cv2.bilateralFilter(denoised, d=9, sigmaColor=40, sigmaSpace=9)
    smoothed = denoised.astype(np.float64) / 255.0

    p = np.gradient(smoothed, axis=1)   # dZ/dx from brightness
    q = np.zeros_like(p)                # no independent along-track slope assumed

    relief = frankot_chellappa(p, q)

    lo, hi = np.percentile(relief, [100 - clip_percentile, clip_percentile])
    relief = np.clip(relief, lo, hi)
    relief -= relief.min()
    if relief.max() > 0:
        relief /= relief.max()

    trim = max(2, int(min(relief.shape) * 0.02))
    relief[:trim, :] = relief[trim:trim + 1, :]
    relief[-trim:, :] = relief[-trim - 1:-trim, :]
    relief[:, :trim] = relief[:, trim:trim + 1]
    relief[:, -trim:] = relief[:, -trim - 1:-trim]

    return relief.astype(np.float32)


def reconstruct_relief_multires(
    patch: np.ndarray,
    num_scales: int = 5,
    clip_percentile: float = 92.0,
    ramp_removal_sigma: float = 30.0,
) -> np.ndarray:
    """
    Returns a relative relief in [0, 1] for the WHOLE padded patch —
    ripple texture and any embedded object both show up, the way
    Fig. 6(d)/9(d) in the paper look, rather than a bare flat plane with
    a bump on it.

    Real sonar speckle is much stronger than a small Gaussian blur can
    remove — that under-denoising is what previously turned this into
    spiky mountains. Bilateral + median filtering here kill speckle far
    more aggressively (bilateral preserves genuine edges/ripple crests
    while median kills the salt-and-pepper-like speckle grain), and using
    5 pyramid levels (matching the paper's 5-level multiresolution setup,
    which they show outperforms 3-level and single-stage in their Fig. 8)
    weighted heavily toward the coarse end keeps this from re-amplifying
    whatever speckle survives.
    """
    patch_u8 = (np.clip(patch, 0, 1) * 255).astype(np.uint8)
    denoised_u8 = cv2.medianBlur(patch_u8, 5)
    denoised_u8 = cv2.bilateralFilter(denoised_u8, d=9, sigmaColor=40, sigmaSpace=9)
    smoothed = denoised_u8.astype(np.float64) / 255.0

    h, w = smoothed.shape
    accum = np.zeros((h, w), dtype=np.float64)
    total_weight = 0.0

    for level in range(num_scales):
        scale = 2 ** level
        small_w = max(1, w // scale)
        small_h = max(1, h // scale)
        small = cv2.resize(smoothed, (small_w, small_h), interpolation=cv2.INTER_AREA)

        grad_x = np.gradient(small.astype(np.float64), axis=1)
        # remove each row's mean gradient before integrating — otherwise
        # a small constant bias turns into an unbounded ramp across the
        # row once you cumsum it
        grad_x -= grad_x.mean(axis=1, keepdims=True)
        integrated = np.cumsum(grad_x, axis=1)

        upsampled = cv2.resize(integrated, (w, h), interpolation=cv2.INTER_CUBIC)

        # coarser scales carry the real large-scale shape with much less
        # accumulated noise, so they dominate the blend — exponential
        # weighting pushes this further than the earlier linear version
        level_weight = float(2 ** level)
        accum += level_weight * upsampled
        total_weight += level_weight

    relief = accum / total_weight

    # strip any remaining large-scale tilt (sensor geometry / TVG
    # artifacts) while keeping ripple-scale and object-scale detail
    low_freq = cv2.GaussianBlur(
        relief.astype(np.float32), (0, 0), sigmaX=ramp_removal_sigma, sigmaY=ramp_removal_sigma
    )
    relief = relief - low_freq

    # clip outliers instead of avoiding gradient integration altogether —
    # tighter than before, since real speckle-scale noise still leaves a
    # residual even after the stronger denoising above
    lo, hi = np.percentile(relief, [100 - clip_percentile, clip_percentile])
    relief = np.clip(relief, lo, hi)

    relief -= relief.min()
    if relief.max() > 0:
        relief /= relief.max()
    return relief.astype(np.float32)


def emphasize_bbox_region(
    height: np.ndarray,
    local_bbox: tuple,
    boost: float = 0.35,
    edge_softness: float = 6.0,
) -> np.ndarray:
    """
    The multiresolution relief already shows the object (it's genuinely
    brighter/different in the sonar return), but for a detection view we
    still want it to read clearly as THE thing someone should look at, so
    nudge the known bbox region upward a bit rather than relying purely
    on shading to make it stand out. Kept gentle and additive so it
    doesn't flatten the surrounding ripple texture like the schematic
    mode does.
    """
    x1, y1, x2, y2 = local_bbox
    mask = np.zeros_like(height)
    mask[y1:y2, x1:x2] = 1.0
    mask = cv2.GaussianBlur(mask, (0, 0), sigmaX=edge_softness, sigmaY=edge_softness)
    if mask.max() > 0:
        mask /= mask.max()

    boosted = height + boost * mask * height.max()
    boosted = np.clip(boosted, 0, None)
    if boosted.max() > 0:
        boosted /= boosted.max()
    return boosted


# ---------------------------------------------------------------------------
# Step 4: calibrate to real units and export
# ---------------------------------------------------------------------------

def _write_obj_mesh(heightmap_m: np.ndarray, pixel_size_m: float, out_path: Path) -> None:
    """Write a simple grid mesh (quads as two triangles) for a Three.js viewer."""
    rows, cols = heightmap_m.shape
    lines = []
    for r in range(rows):
        for c in range(cols):
            x = c * pixel_size_m
            y = r * pixel_size_m
            z = float(heightmap_m[r, c])
            lines.append(f"v {x:.4f} {y:.4f} {z:.4f}")

    def vid(r, c):
        return r * cols + c + 1

    for r in range(rows - 1):
        for c in range(cols - 1):
            a, b, cc, d = vid(r, c), vid(r, c + 1), vid(r + 1, c + 1), vid(r + 1, c)
            lines.append(f"f {a} {b} {cc}")
            lines.append(f"f {a} {cc} {d}")

    out_path.write_text("\n".join(lines))


def calibrate_and_export(
    relief_relative: np.ndarray,
    estimated_height_m,
    pixel_size_m: float,
    out_dir: str,
    name: str = "detection",
) -> dict:
    """
    Scales the relative relief to metres (using the shadow-based height if
    available, else a flagged default) and writes:
      {name}_heightmap.npy, {name}_heightmap.png, {name}_mesh.obj, {name}_report.json
    """
    out_dir_path = Path(out_dir)
    out_dir_path.mkdir(parents=True, exist_ok=True)

    used_default = estimated_height_m is None
    target_height_m = estimated_height_m if not used_default else 0.5
    heightmap_m = relief_relative * target_height_m

    np.save(out_dir_path / f"{name}_heightmap.npy", heightmap_m)

    preview = (relief_relative * 255).astype(np.uint8)
    Image.fromarray(preview).save(out_dir_path / f"{name}_heightmap.png")

    obj_path = out_dir_path / f"{name}_mesh.obj"
    _write_obj_mesh(heightmap_m, pixel_size_m, obj_path)

    report = {
        "heightmap": heightmap_m.tolist(),
        "estimated_height_m": target_height_m,
        "height_source": "shadow" if not used_default else "default_fallback",
        "grid_shape": list(heightmap_m.shape),
        "heightmap_png_path": str(out_dir_path / f"{name}_heightmap.png"),
        "mesh_path": str(obj_path),
    }
    (out_dir_path / f"{name}_report.json").write_text(json.dumps(report, indent=2))
    return report


# ---------------------------------------------------------------------------
# Primary entry point
# ---------------------------------------------------------------------------

def reconstruct_patch_from_bbox(
    padded_patch_path: str,
    local_bbox: tuple,
    out_dir: str,
    pixel_size_m: float = 0.05,
    sensor_altitude_m: float = 5.0,
    name: str = "detection",
    mode: str = "schematic",
) -> dict:
    """
    Use this instead of reconstruct_patch() when you have the detector's
    bbox available (which you always do, since this runs right after
    detection). Crop the image with margin around the bbox BEFORE calling
    this, so real seabed surrounds the object.

    mode="schematic" (default): flat plane + a raised dome at the bbox,
        with a touch of the object's own texture and a gentle broad
        seabed undulation. This is the right choice for most side-scan
        detections (valves, pipes, debris) sitting on an essentially flat
        seabed — which is almost all speckle noise in the raw pixels, not
        real terrain, so there is nothing physically real to reconstruct
        away from the object.
    mode="realistic": full multiresolution gradient-integration relief
        across the whole padded patch. ONLY use this on scenes that
        actually contain real physical texture (sand ripples, rocky
        terrain) the way Fig. 9 in Coiras et al. does. Run on plain
        speckle-noise seabed, it reliably produces a spiky, mountain-like
        mess — that is not a bug to tune away, it is what integrating
        pure noise looks like, because there's no real slope signal for
        it to recover.
    """
    padded_patch = load_patch(padded_patch_path)
    padded_patch, local_bbox = ensure_flat_margin(padded_patch, local_bbox)
    est_height = estimate_height_from_shadow(padded_patch, pixel_size_m, sensor_altitude_m)

    if mode == "realistic":
        height = reconstruct_relief_multires(padded_patch)
        height = emphasize_bbox_region(height, local_bbox)
    else:
        height = reconstruct_relief_from_bbox(padded_patch, local_bbox)
        scaled_patch = (padded_patch * 255).astype(np.uint8)
        height = add_surface_detail(height, scaled_patch, local_bbox)
        height = add_gentle_seabed_texture(height, padded_patch)
        # final overall smoothing pass, SCALED TO THE OBJECT'S SIZE — a
        # fixed small sigma smooths out a compact object fine but leaves
        # a long/thin object (a pipe, say) reading as several separate
        # peaks instead of one continuous ridge. Regardless of how noisy
        # the raw pixels underneath were, this is what keeps the visible
        # shape clean (like the pipe/spheres in the paper's Fig. 10/11).
        lx1, ly1, lx2, ly2 = local_bbox
        obj_extent = max(lx2 - lx1, ly2 - ly1)
        final_sigma = min(max(2.5, 0.08 * obj_extent), 25.0)
        height = cv2.GaussianBlur(height, (0, 0), sigmaX=final_sigma, sigmaY=final_sigma)
        if height.max() > 0:
            height /= height.max()

    return calibrate_and_export(height, est_height, pixel_size_m, out_dir, name)


# ---------------------------------------------------------------------------
# Convenience: run the whole thing on one patch, no known bbox
# ---------------------------------------------------------------------------

def reconstruct_patch(
    image_path: str,
    out_dir: str,
    pixel_size_m: float = 0.05,
    sensor_altitude_m: float = 5.0,
    name: str = "detection",
    mode: str = "flat",
    nadir_col_px: int = None,
) -> dict:
    """
    No-bbox, whole-image path — this is what matches Fig. 6(d)/9(d) in the
    paper (reconstruct the whole highlighted region, no single "here's
    the object" emphasis).

    mode="flat" (default): always safe — flat plane + a gentle broad
        undulation. Use this if you're not sure the image has real
        terrain in it.
    mode="platform": brightness mapped directly to height, no geometric
        correction — inherently stable but conflates real terrain with
        range-dependent brightness falloff.
    mode="slope": Frankot-Chellappa gradient integration (still brightness-
        as-slope under the hood, so similar look to "platform" in practice).
    mode="realistic": the earlier row-by-row cumsum approach. Kept only
        for reference.
    mode="physical": platform reconstruction AFTER removing the expected
        flat-seabed range/incidence-angle brightness falloff, using real
        altitude + pixel size and an idealized Lambertian model standing
        in for the real beam-pattern/TVG curve. This is the most
        physically grounded of the four — try this one first.
    """
    patch = load_patch(image_path)
    est_height = estimate_height_from_shadow(patch, pixel_size_m, sensor_altitude_m)
    print(f"[reconstruct_patch] mode = {mode!r}")
    if mode == "realistic":
        height = reconstruct_relief_multires(patch)
    elif mode == "slope":
        height = reconstruct_relief_slope(patch)
    elif mode == "platform":
        height = reconstruct_relief_platform(patch)
    elif mode == "physical":
        corrected = geometric_incidence_correction(patch, pixel_size_m, sensor_altitude_m, nadir_col_px)
        height = reconstruct_relief_platform(corrected)
    else:
        height = add_gentle_seabed_texture(np.zeros_like(patch), patch)
    return calibrate_and_export(height, est_height, pixel_size_m, out_dir, name)