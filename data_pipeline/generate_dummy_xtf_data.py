"""
generate_dummy_xtf_data.py
------------------------------
Real XTF files (NBP050506B etc.) gave 0 / low-confidence debris detections
because the model, trained on AI4Shipwrecks, sees a different sonar "look"
(different frequency, gain, seafloor texture) than real-world survey data.
That's a genuine domain-mismatch problem, not a bug.

To keep testing/demo work moving without waiting on real-data retraining,
this script generates SYNTHETIC ping-level sonar data matching your team's
schema:

    ping_id / timestamp
    port_channel_samples[]
    starboard_channel_samples[]
    sample_interval
    slant_range
    altitude
    speed
    heading
    latitude
    longitude

...with a deliberately injected "debris signature" (bright return + acoustic
shadow, the classic side-scan look for a solid object on the seafloor) in a
known fraction of pings. Because the signature is clean and strong, the
existing model should detect it with high confidence -- good for a
"pipeline works end-to-end" demo, while the real-XTF domain-mismatch issue
is worked on separately.

Outputs:
    <out_dir>/pings.json          - full ping records (schema above, as float lists)
    <out_dir>/pings_meta.csv       - lightweight per-ping metadata (no raw arrays)
    <out_dir>/waterfall.png        - stacked port+starboard image (for YOLO input)
    <out_dir>/ground_truth.json    - which pings/columns actually have injected debris
                                      (for evaluating detector performance -- NOT
                                      to be fed into the model itself)

Usage:
    python generate_dummy_xtf_data.py --n_pings 500 --debris_ratio 0.15 --out synthetic_survey_01
"""
import argparse
import json
import csv
import math
import random
from pathlib import Path

import numpy as np
from PIL import Image


def move_latlon(lat, lon, heading_deg, distance_m):
    """Move a lat/lon point forward by distance_m along a compass heading."""
    R = 6371000.0  # Earth radius in meters
    heading_rad = math.radians(heading_deg)
    lat_rad = math.radians(lat)
    lon_rad = math.radians(lon)

    new_lat_rad = math.asin(
        math.sin(lat_rad) * math.cos(distance_m / R)
        + math.cos(lat_rad) * math.sin(distance_m / R) * math.cos(heading_rad)
    )
    new_lon_rad = lon_rad + math.atan2(
        math.sin(heading_rad) * math.sin(distance_m / R) * math.cos(lat_rad),
        math.cos(distance_m / R) - math.sin(lat_rad) * math.sin(new_lat_rad),
    )
    return math.degrees(new_lat_rad), math.degrees(new_lon_rad)


def generate_channel(n_samples: int, noise_level: float, rng: np.random.Generator):
    """Background seafloor speckle noise (Rayleigh-distributed, typical for sonar backscatter)."""
    return rng.rayleigh(scale=noise_level, size=n_samples).astype(np.float32)


def inject_debris(channel: np.ndarray, start: int, width: int, rng: np.random.Generator):
    """
    Classic side-scan debris signature: a bright specular return
    immediately followed by a dark acoustic shadow (object blocks
    the sonar beam from reaching the seafloor behind it).
    """
    n = len(channel)
    bright_end = min(start + width, n)
    channel[start:bright_end] += np.linspace(0.9, 0.4, bright_end - start).astype(np.float32)

    shadow_start = bright_end
    shadow_len = int(width * 1.6)
    shadow_end = min(shadow_start + shadow_len, n)
    if shadow_end > shadow_start:
        channel[shadow_start:shadow_end] *= 0.08
    return start, shadow_end  # full extent of the injected feature, for ground truth


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n_pings", type=int, default=500, help="Number of pings to simulate")
    ap.add_argument("--n_samples", type=int, default=1024, help="Samples per channel (matches your XTF: 1024/channel)")
    ap.add_argument("--sample_interval", type=float, default=0.0000217, help="Seconds between samples")
    ap.add_argument("--slant_range", type=float, default=50.0, help="Meters, max range per channel")
    ap.add_argument("--altitude", type=float, default=5.0, help="Tow-fish altitude above seafloor, meters")
    ap.add_argument("--speed", type=float, default=2.5, help="Tow speed, meters/second")
    ap.add_argument("--heading", type=float, default=90.0, help="Compass heading, degrees")
    ap.add_argument("--start_lat", type=float, default=45.0450)
    ap.add_argument("--start_lon", type=float, default=-83.3277)
    ap.add_argument("--ping_rate_hz", type=float, default=5.0, help="Pings per second (for timestamp + distance-per-ping)")
    ap.add_argument("--debris_ratio", type=float, default=0.15, help="Fraction of pings that get an injected debris signature")
    ap.add_argument("--noise_level", type=float, default=0.05, help="Background speckle noise scale")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default="synthetic_survey", help="Output directory")
    args = ap.parse_args()

    rng = np.random.default_rng(args.seed)
    random.seed(args.seed)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    pings = []
    meta_rows = []
    ground_truth = []

    lat, lon = args.start_lat, args.start_lon
    dist_per_ping = args.speed / args.ping_rate_hz

    port_rows = []
    starboard_rows = []

    for i in range(args.n_pings):
        timestamp = round(i / args.ping_rate_hz, 3)

        port = generate_channel(args.n_samples, args.noise_level, rng)
        starboard = generate_channel(args.n_samples, args.noise_level, rng)

        has_debris = rng.random() < args.debris_ratio
        if has_debris:
            channel_name = rng.choice(["port", "starboard"])
            width = int(rng.integers(15, 35))
            start = int(rng.integers(80, args.n_samples - 150))
            target = port if channel_name == "port" else starboard
            feat_start, feat_end = inject_debris(target, start, width, rng)
            ground_truth.append({
                "ping_id": i,
                "channel": channel_name,
                "sample_start": feat_start,
                "sample_end": feat_end,
            })

        lat, lon = move_latlon(lat, lon, args.heading, dist_per_ping)

        pings.append({
            "ping_id": i,
            "timestamp": timestamp,
            "port_channel_samples": port.tolist(),
            "starboard_channel_samples": starboard.tolist(),
            "sample_interval": args.sample_interval,
            "slant_range": args.slant_range,
            "altitude": args.altitude,
            "speed": args.speed,
            "heading": args.heading,
            "latitude": round(lat, 6),
            "longitude": round(lon, 6),
        })

        meta_rows.append({
            "ping_id": i, "timestamp": timestamp, "latitude": round(lat, 6),
            "longitude": round(lon, 6), "has_injected_debris": has_debris,
        })

        port_rows.append(port)
        starboard_rows.append(starboard)

    # Full ping records (matches your exact schema)
    with open(out_dir / "pings.json", "w") as f:
        json.dump(pings, f)

    # Lightweight metadata CSV (no raw arrays) for quick inspection
    with open(out_dir / "pings_meta.csv", "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(meta_rows[0].keys()))
        writer.writeheader()
        writer.writerows(meta_rows)

    # Ground truth of injected debris (for evaluating the detector, not for feeding the model)
    with open(out_dir / "ground_truth.json", "w") as f:
        json.dump(ground_truth, f, indent=2)

    # Waterfall image: starboard | port side by side, each row = one ping,
    # matching the usual side-scan waterfall layout (time/along-track on Y,
    # slant range on X).
    port_arr = np.array(port_rows)
    starboard_arr = np.array(starboard_rows)
    waterfall = np.concatenate([starboard_arr[:, ::-1], port_arr], axis=1)

    # Normalize to 0-255 for a viewable grayscale image
    waterfall_norm = np.clip(waterfall / (waterfall.max() + 1e-6), 0, 1)
    waterfall_img = (waterfall_norm * 255).astype(np.uint8)
    Image.fromarray(waterfall_img, mode="L").save(out_dir / "waterfall.png")

    print(f"Generated {args.n_pings} pings ({sum(1 for m in meta_rows if m['has_injected_debris'])} with injected debris)")
    print(f"Saved to: {out_dir}/")
    print(f"  pings.json        - full schema records")
    print(f"  pings_meta.csv     - quick-look metadata")
    print(f"  ground_truth.json  - injected debris locations (for evaluation)")
    print(f"  waterfall.png      - ready to feed into your YOLO inference script")


if __name__ == "__main__":
    main()
