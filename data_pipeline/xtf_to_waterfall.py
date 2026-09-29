"""
xtf_to_waterfall.py

AquaScan (SIH26057) — Team Catalyst
Data Ingestion & Preprocessing Pipeline

Purpose:
    Convert raw side-scan sonar .XTF files into clean, corrected waterfall
    images, along with a per-ping navigation lookup table (lat/lon/heading/
    altitude/timestamp) for downstream geotagging.

Pipeline steps:
    1. Parse raw pings from the .XTF file (pyxtf)
    2. Skip corrupted/saturated pings at the start of the survey
    3. Select a usable sonar channel (STBD_HI by default)
    4. Apply slant-range-to-ground-range correction
    5. Normalize intensity using percentile clipping
    6. Apply median filtering for speckle noise reduction
    7. Save the original grayscale waterfall used by the model
    8. Save a separate enhanced display waterfall for humans
    9. Save the per-ping navigation lookup table

IMPORTANT:
    The enhanced display image is NOT used as the YOLO/DRISHTI model input.
    This keeps the existing detection behavior unchanged while making the
    waterfall much easier to view in the dashboard/demo.
"""

import os
import glob

import numpy as np
import pandas as pd
import pyxtf
from PIL import Image
from scipy.ndimage import median_filter
import cv2


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def slant_to_ground_correct(row, altitude, sample_interval=1.0):
    n_samples = len(row)
    slant_ranges = np.arange(n_samples) * sample_interval
    ground_ranges = np.sqrt(np.maximum(slant_ranges**2 - altitude**2, 0))
    corrected = np.interp(np.arange(n_samples), ground_ranges, row)
    return corrected


def normalize_percentile(data, low=2, high=95):
    p_low, p_high = np.percentile(data, [low, high])

    if p_high <= p_low:
        return np.zeros_like(data, dtype=np.uint8)

    clipped = np.clip(data, p_low, p_high)
    normalized = (
        (clipped - p_low) / (p_high - p_low) * 255
    ).astype(np.uint8)

    return normalized


def enhance_waterfall_for_display(
    grayscale_image,
    clip_limit=2.0,
    tile_grid_size=(8, 8)
):
    """
    Create a clearer visualization of the sonar waterfall.

    This is DISPLAY ONLY. It is deliberately kept separate from the
    grayscale image sent to DRISHTI/YOLO.
    """
    # CLAHE improves local contrast without changing the model input.
    clahe = cv2.createCLAHE(
        clipLimit=clip_limit,
        tileGridSize=tile_grid_size
    )

    enhanced = clahe.apply(grayscale_image)

    # Very mild denoising for presentation.
    enhanced = cv2.GaussianBlur(enhanced, (3, 3), 0)

    # Mild contrast stretch for a cleaner demo image.
    low, high = np.percentile(enhanced, [1, 99])

    if high > low:
        enhanced = np.clip(
            (enhanced.astype(np.float32) - low)
            / (high - low)
            * 255,
            0,
            255
        ).astype(np.uint8)

    return enhanced


def get_channel_info(file_header):
    for i, ch in enumerate(file_header.ChanInfo[:4]):
        name = ch.ChannelName if hasattr(ch, "ChannelName") else "N/A"
        freq = ch.Frequency if hasattr(ch, "Frequency") else "N/A"
        print(
            f"Channel {i}: Name={name}, Frequency={freq}, "
            f"TypeOfChannel={ch.TypeOfChannel}"
        )


def find_bad_start_pings(
    sonar_pings,
    sample_range=300,
    step=10,
    max_value_threshold=30000
):
    for i in range(0, min(sample_range, len(sonar_pings)), step):
        ping = sonar_pings[i]
        row0 = ping.data[0]
        flag = (
            " <-- possibly bad"
            if row0.max() >= max_value_threshold
            else ""
        )
        print(
            f"Ping {i}: max={row0.max()}, "
            f"mean={row0.mean():.1f}, "
            f"altitude={ping.SensorPrimaryAltitude:.1f}{flag}"
        )


# ---------------------------------------------------------------------------
# Main pipeline function
# ---------------------------------------------------------------------------

def process_xtf_to_waterfall(
    file_path,
    skip_pings=140,
    channel_idx=3,
    output_prefix="output",
    output_dir="."
):
    """
    Raw XTF -> model-input waterfall + enhanced display waterfall + nav CSV.

    Returns:
        tuple:
            model_waterfall_path (str)
            nav_df (pd.DataFrame)

    The function keeps the original return shape expected by the backend.
    The enhanced display path is also created next to the model waterfall
    using the same output prefix.
    """

    (file_header, packets) = pyxtf.xtf_read(file_path)

    sonar_pings = packets[pyxtf.XTFHeaderType.sonar]
    valid_pings = sonar_pings[skip_pings:]

    if not valid_pings:
        raise ValueError("No valid sonar pings remain after skip_pings.")

    altitudes = np.array(
        [ping.SensorPrimaryAltitude for ping in valid_pings]
    )

    # --- Slant-range correction ---
    corrected_rows = []

    for i, ping in enumerate(valid_pings):
        row = ping.data[channel_idx]
        alt = altitudes[i]

        corrected = slant_to_ground_correct(
            row,
            alt
        )

        corrected_rows.append(corrected)

    corrected_waterfall = np.array(corrected_rows)

    # --- Normalize + denoise ---
    norm_final = normalize_percentile(
        corrected_waterfall,
        low=2,
        high=95
    )

    denoised = median_filter(
        norm_final,
        size=3
    ).astype(np.uint8)

    # --- Save model-input waterfall ---
    os.makedirs(output_dir, exist_ok=True)

    img_path = os.path.join(
        output_dir,
        f"{output_prefix}_waterfall.png"
    )

    Image.fromarray(denoised).save(img_path)

    # --- Save separate enhanced DISPLAY waterfall ---
    display_image = enhance_waterfall_for_display(
        denoised
    )

    display_path = os.path.join(
        output_dir,
        f"{output_prefix}_waterfall_display.png"
    )

    Image.fromarray(display_image).save(display_path)

    print(f"Model waterfall: {img_path}")
    print(f"Display waterfall: {display_path}")

    # --- Save nav lookup table ---
    nav_data = []

    for i, ping in enumerate(valid_pings):
        nav_data.append({
            "row_index": i,
            "lat": ping.SensorYcoordinate,
            "lon": ping.SensorXcoordinate,
            "heading": ping.SensorHeading,
            "altitude": ping.SensorPrimaryAltitude,
            "timestamp": (
                f"{ping.Year}-{ping.Month:02d}-{ping.Day:02d} "
                f"{ping.Hour}:{ping.Minute}:{ping.Second}"
            ),
        })

    nav_df = pd.DataFrame(nav_data)

    csv_path = os.path.join(
        output_dir,
        f"{output_prefix}_nav.csv"
    )

    nav_df.to_csv(
        csv_path,
        index=False
    )

    print(f"Navigation CSV: {csv_path}")

    # Keep the original backend contract:
    # first item = model-input waterfall path
    # second item = nav dataframe
    return img_path, nav_df


# ---------------------------------------------------------------------------
# Batch processing
# ---------------------------------------------------------------------------

def batch_process_folder(
    folder_path,
    skip_pings=140,
    channel_idx=3,
    output_dir="."
):
    xtf_files = glob.glob(
        os.path.join(folder_path, "*.XTF")
    )

    print(
        f"Total XTF files found: {len(xtf_files)}"
    )

    results = {}

    for f in xtf_files:
        file_name = os.path.splitext(
            os.path.basename(f)
        )[0]

        print(
            f"\nProcessing: {file_name}"
        )

        try:
            process_xtf_to_waterfall(
                f,
                skip_pings=skip_pings,
                channel_idx=channel_idx,
                output_prefix=file_name,
                output_dir=output_dir
            )

            results[file_name] = "Success"

        except Exception as e:
            print(
                f"Error in {file_name}: {e}"
            )

            results[file_name] = (
                f"Failed: {e}"
            )

    print("\n--- Batch Summary ---")

    for k, v in results.items():
        print(f"{k}: {v}")

    return results


# ---------------------------------------------------------------------------
# Script entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    FOLDER_PATH = (
        r"C:\Users\BabitaPal\Downloads"
        r"\MGDS_Download (1)\MGDS_Download\NBP0505"
    )

    OUTPUT_DIR = "waterfall_outputs"

    batch_process_folder(
        FOLDER_PATH,
        skip_pings=140,
        channel_idx=3,
        output_dir=OUTPUT_DIR
    )
