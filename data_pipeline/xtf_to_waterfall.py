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
       (sensor warm-up / turning artifact)
    3. Select a usable sonar channel (here: STBD_HI, 410 kHz)
    4. Apply slant-range-to-ground-range correction using per-ping altitude
    5. Normalize intensity using percentile clipping (robust to outliers)
    6. Apply median filtering for speckle noise reduction
    7. Save the resulting waterfall image (.png) and nav lookup table (.csv)

Tested on: NBP0505 expedition raw XTF files (MGDS, Nathaniel B. Palmer
platform). 8/10 sample files processed successfully; 2 files were corrupted
at the source/download stage (unrelated to this pipeline) and were skipped.

Usage:
    from xtf_to_waterfall import process_xtf_to_waterfall, batch_process_folder

    # Single file
    denoised_img, nav_df = process_xtf_to_waterfall("NBP050504A.XTF", output_prefix="NBP050504A")

    # Whole folder
    results = batch_process_folder(r"C:\\path\\to\\xtf\\folder")
"""

import os
import glob

import numpy as np
import pandas as pd
import pyxtf
from PIL import Image
from scipy.ndimage import median_filter


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def slant_to_ground_correct(row, altitude, sample_interval=1.0):
    """
    Correct a single sonar ping row from slant range to ground range.

    Raw sonar samples are recorded along the diagonal (slant) path from the
    sensor to the seabed, which distorts distances near the nadir (directly
    below the sensor). This resamples the row onto a uniform ground-range
    grid using the known sensor altitude for that ping.

    Args:
        row (np.ndarray): 1D array of raw amplitude samples for one channel/ping.
        altitude (float): Sensor altitude above the seabed for this ping (metres).
        sample_interval (float): Distance represented by each sample index.
            Defaults to 1.0 (relative units) since absolute sample spacing
            was not available in the ping header; adjust if a real value is
            known for your sensor.

    Returns:
        np.ndarray: Ground-range corrected row, same length as input.
    """
    n_samples = len(row)
    slant_ranges = np.arange(n_samples) * sample_interval
    ground_ranges = np.sqrt(np.maximum(slant_ranges**2 - altitude**2, 0))
    corrected = np.interp(np.arange(n_samples), ground_ranges, row)
    return corrected


def normalize_percentile(data, low=2, high=95):
    """
    Normalize an array to 0-255 using percentile clipping instead of raw
    min/max. This prevents a small number of extreme/saturated pixels
    (e.g. sensor artifacts) from washing out the contrast of the entire
    image.

    Args:
        data (np.ndarray): Input array (e.g. stacked ping rows).
        low (float): Lower percentile to clip to. Default 2.
        high (float): Upper percentile to clip to. Default 95.

    Returns:
        np.ndarray: uint8 array, normalized to 0-255.
    """
    p_low, p_high = np.percentile(data, [low, high])
    clipped = np.clip(data, p_low, p_high)
    normalized = ((clipped - p_low) / (p_high - p_low) * 255).astype(np.uint8)
    return normalized


def get_channel_info(file_header):
    """
    Print channel metadata (name, frequency, side) for an opened XTF file.
    Useful for confirming which channel index corresponds to which physical
    sensor channel before picking one for processing.

    For our NBP0505 test files, the mapping was:
        Channel 0 = PORT_LOW (120 kHz)
        Channel 1 = STBD_LOW (120 kHz)
        Channel 2 = PORT_HI  (410 kHz)  -- found to be a bad/washed-out
                                            channel in our sample file
        Channel 3 = STBD_HI  (410 kHz)  -- used as default in this pipeline

    NOTE: Channel mapping is NOT guaranteed to be identical across different
    sonar hardware/surveys. Always verify with this function before trusting
    the default channel_idx=3 in process_xtf_to_waterfall().

    Args:
        file_header: The file_header object returned by pyxtf.xtf_read().
    """
    for i, ch in enumerate(file_header.ChanInfo[:4]):
        name = ch.ChannelName if hasattr(ch, "ChannelName") else "N/A"
        freq = ch.Frequency if hasattr(ch, "Frequency") else "N/A"
        print(f"Channel {i}: Name={name}, Frequency={freq}, TypeOfChannel={ch.TypeOfChannel}")


def find_bad_start_pings(sonar_pings, sample_range=300, step=10, max_value_threshold=30000):
    """
    Diagnostic helper: scans the first `sample_range` pings of a file and
    prints their max amplitude + altitude, to help identify how many pings
    at the start of a survey are corrupted/saturated (a common artifact
    from sensor warm-up or vessel turning at the start of a survey line).

    Use this BEFORE processing a new file to choose an appropriate
    `skip_pings` value for process_xtf_to_waterfall() -- do not assume the
    value of 140 (found for our sample file) applies to every file.

    Args:
        sonar_pings (list): List of ping objects from packets[pyxtf.XTFHeaderType.sonar].
        sample_range (int): How many initial pings to scan. Default 300.
        step (int): Check every Nth ping (for speed). Default 10.
        max_value_threshold (int): Values above this are flagged as
            likely-saturated. Default 30000 (close to uint16 max of 65535,
            but sonar sensor's effective saturation point observed near
            32767 in our data).
    """
    for i in range(0, min(sample_range, len(sonar_pings)), step):
        ping = sonar_pings[i]
        row0 = ping.data[0]
        flag = " <-- possibly bad" if row0.max() >= max_value_threshold else ""
        print(f"Ping {i}: max={row0.max()}, mean={row0.mean():.1f}, "
              f"altitude={ping.SensorPrimaryAltitude:.1f}{flag}")


# ---------------------------------------------------------------------------
# Main pipeline function
# ---------------------------------------------------------------------------

def process_xtf_to_waterfall(file_path, skip_pings=140, channel_idx=3,
                              output_prefix="output", output_dir="."):
    """
    Full pipeline: raw .XTF file -> corrected, denoised waterfall image (.png)
    + per-ping navigation lookup table (.csv).

    Args:
        file_path (str): Path to the input .XTF file.
        skip_pings (int): Number of pings to skip from the start of the file
            (corrupted/saturated startup artifact). Default 140, tuned for
            our NBP0505 sample file -- verify per-file using
            find_bad_start_pings() if outputs look wrong (e.g. a bright
            horizontal band at the top of the image).
        channel_idx (int): Which of the 4 channels to use. Default 3
            (STBD_HI, 410 kHz) -- verify with get_channel_info() if using
            data from a different sonar/survey.
        output_prefix (str): Prefix used for the output filenames
            (e.g. "NBP050504A" -> "NBP050504A_waterfall.png",
            "NBP050504A_nav.csv").
        output_dir (str): Directory to save outputs into. Default current
            directory.

    Returns:
        tuple:
            denoised (np.ndarray): Final uint8 waterfall image array.
            nav_df (pd.DataFrame): Per-ping navigation data (row_index, lat,
                lon, heading, altitude, timestamp), aligned row-for-row with
                the image (row 0 of nav_df corresponds to row 0 of the image).

    Raises:
        Exception: Propagates any pyxtf parsing errors (e.g. from corrupted
            source files) -- callers doing batch processing should catch
            these per-file (see batch_process_folder()).
    """
    (file_header, packets) = pyxtf.xtf_read(file_path)
    sonar_pings = packets[pyxtf.XTFHeaderType.sonar]
    valid_pings = sonar_pings[skip_pings:]
    altitudes = np.array([ping.SensorPrimaryAltitude for ping in valid_pings])

    # --- Slant-range correction ---
    corrected_rows = []
    for i, ping in enumerate(valid_pings):
        row = ping.data[channel_idx]
        alt = altitudes[i]
        corrected = slant_to_ground_correct(row, alt)
        corrected_rows.append(corrected)
    corrected_waterfall = np.array(corrected_rows)

    # --- Normalize + denoise ---
    norm_final = normalize_percentile(corrected_waterfall, low=2, high=95)
    denoised = median_filter(norm_final, size=3)

    # --- Save waterfall image ---
    os.makedirs(output_dir, exist_ok=True)
    img_path = os.path.join(output_dir, f"{output_prefix}_waterfall.png")
    Image.fromarray(denoised).save(img_path)

    # --- Save nav lookup table ---
    nav_data = []
    for i, ping in enumerate(valid_pings):
        nav_data.append({
            "row_index": i,
            "lat": ping.SensorYcoordinate,
            "lon": ping.SensorXcoordinate,
            "heading": ping.SensorHeading,
            "altitude": ping.SensorPrimaryAltitude,
            "timestamp": (f"{ping.Year}-{ping.Month:02d}-{ping.Day:02d} "
                          f"{ping.Hour}:{ping.Minute}:{ping.Second}"),
        })
    nav_df = pd.DataFrame(nav_data)
    csv_path = os.path.join(output_dir, f"{output_prefix}_nav.csv")
    nav_df.to_csv(csv_path, index=False)

    print(f"Done: {img_path}, {csv_path}")
    return denoised, nav_df


# ---------------------------------------------------------------------------
# Batch processing
# ---------------------------------------------------------------------------

def batch_process_folder(folder_path, skip_pings=140, channel_idx=3, output_dir="."):
    """
    Run process_xtf_to_waterfall() on every .XTF file in a folder.
    Failures on individual files (e.g. corrupted downloads) do not stop
    the batch -- they are recorded in the returned results dict.

    Args:
        folder_path (str): Folder containing .XTF files.
        skip_pings (int): Passed through to process_xtf_to_waterfall()
            for every file. NOTE: assumes the same startup-artifact length
            across all files in the folder -- inspect outputs and adjust
            per-file if needed (see find_bad_start_pings()).
        channel_idx (int): Passed through to process_xtf_to_waterfall()
            for every file.
        output_dir (str): Directory to save all outputs into.

    Returns:
        dict: {filename_without_extension: "Success" | "Failed: <error message>"}
    """
    xtf_files = glob.glob(os.path.join(folder_path, "*.XTF"))
    print(f"Total XTF files found: {len(xtf_files)}")

    results = {}
    for f in xtf_files:
        file_name = os.path.splitext(os.path.basename(f))[0]
        print(f"\nProcessing: {file_name}")
        try:
            process_xtf_to_waterfall(
                f, skip_pings=skip_pings, channel_idx=channel_idx,
                output_prefix=file_name, output_dir=output_dir
            )
            results[file_name] = "Success"
        except Exception as e:
            print(f"Error in {file_name}: {e}")
            results[file_name] = f"Failed: {e}"

    print("\n--- Batch Summary ---")
    for k, v in results.items():
        print(f"{k}: {v}")

    return results


# ---------------------------------------------------------------------------
# Script entry point (example usage)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    FOLDER_PATH = r"C:\Users\BabitaPal\Downloads\MGDS_Download (1)\MGDS_Download\NBP0505"
    OUTPUT_DIR = "waterfall_outputs"

    batch_process_folder(FOLDER_PATH, skip_pings=140, channel_idx=3, output_dir=OUTPUT_DIR)
