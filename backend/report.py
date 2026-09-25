"""
report.py

Handles:
  1. Dummy Lat/Lon fallback (when real EXIF geotag is not available)
  2. Persistent logging of every detection result to a CSV file
  3. /report/csv        -> download the full detection report as CSV
  4. /report/heatmap    -> return geo-tagged detection points for heatmap plotting

NOTE: The fallback lat/lon is SURVEY/NAVIGATION metadata, not something predicted
by the ML model. It exists only so the pipeline keeps working end-to-end when a
sonar image has no real GPS tag attached. Every row generated from a fallback is
explicitly marked with source = "dummy_fallback" so it is never confused with a
real GPS reading in the report or heatmap.
"""

import csv
import random
from pathlib import Path
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse

router = APIRouter()

REPORT_DIR = Path("results")
REPORT_DIR.mkdir(exist_ok=True)
REPORT_CSV_PATH = REPORT_DIR / "detection_report.csv"

CSV_HEADERS = [
    "timestamp",
    "image_id",
    "original_filename",
    "status",
    "detection_count",
    "classes_detected",
    "avg_confidence",
    "latitude",
    "longitude",
    "location_source",   # "exif" or "dummy_fallback"
]

# ── Dummy survey area (edit these bounds to match your actual survey site) ──
# Kept narrow and clearly commented so it's obvious this is a placeholder area,
# not a real vessel track.
DUMMY_LAT_RANGE = (17.9, 18.1)   # example: coastal survey box
DUMMY_LON_RANGE = (82.2, 82.4)


def get_dummy_location() -> dict:
    """Generate a fallback lat/lon inside a fixed dummy survey box."""
    lat = round(random.uniform(*DUMMY_LAT_RANGE), 6)
    lon = round(random.uniform(*DUMMY_LON_RANGE), 6)
    return {"latitude": lat, "longitude": lon, "source": "dummy_fallback"}


def resolve_location(geotag: dict | None) -> dict:
    """
    Given the geotag dict produced by extract_geotag() in main.py
    (or None if EXIF had no GPS data), return a location dict that
    ALWAYS has latitude/longitude/source, falling back to a dummy
    location when real data is unavailable.
    """
    if geotag and geotag.get("latitude") is not None and geotag.get("longitude") is not None:
        return {
            "latitude": geotag["latitude"],
            "longitude": geotag["longitude"],
            "source": "exif",
        }
    return get_dummy_location()


def _ensure_csv_header():
    if not REPORT_CSV_PATH.exists():
        with open(REPORT_CSV_PATH, "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(CSV_HEADERS)


def log_detection_record(
    image_id: str,
    original_filename: str,
    status: str,
    detections: list,
    location: dict,
):
    """Append one row per processed image to the persistent CSV report."""
    _ensure_csv_header()

    classes_detected = ";".join(sorted({d["class"] for d in detections})) if detections else ""
    avg_confidence = (
        round(sum(d["confidence"] for d in detections) / len(detections), 4)
        if detections else 0.0
    )

    row = [
        datetime.now(timezone.utc).isoformat(),
        image_id,
        original_filename,
        status,
        len(detections),
        classes_detected,
        avg_confidence,
        location["latitude"],
        location["longitude"],
        location["source"],
    ]

    with open(REPORT_CSV_PATH, "a", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(row)


# ───────────────────────────── Endpoints ─────────────────────────────

@router.get("/report/csv")
def download_report_csv():
    """Download the full, persistent detection report as a CSV file."""
    if not REPORT_CSV_PATH.exists():
        raise HTTPException(status_code=404, detail="No report data yet. Run /predict first.")
    return FileResponse(
        path=REPORT_CSV_PATH,
        filename="detection_report.csv",
        media_type="text/csv",
    )


@router.get("/report/heatmap")
def get_heatmap_data():
    """
    Return every logged detection as a geo-point for heatmap plotting on the frontend.
    Only rows where debris was actually detected are included (status == debris_detected),
    since a heatmap of "no debris" points isn't meaningful.
    Each point is tagged with location_source so the frontend can visually distinguish
    real EXIF-based points from dummy fallback points if needed.
    """
    if not REPORT_CSV_PATH.exists():
        return JSONResponse({"points": [], "count": 0})

    points = []
    with open(REPORT_CSV_PATH, "r", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row["status"] != "debris_detected":
                continue
            points.append({
                "image_id": row["image_id"],
                "lat": float(row["latitude"]),
                "lng": float(row["longitude"]),
                "detection_count": int(row["detection_count"]),
                "classes": row["classes_detected"].split(";") if row["classes_detected"] else [],
                "location_source": row["location_source"],
                "timestamp": row["timestamp"],
            })

    return JSONResponse({"points": points, "count": len(points)})