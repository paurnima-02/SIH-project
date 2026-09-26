"""
geotag_utils.py

Combined geotagging logic for Task 1's "Dummy Lat/Lon metadata generator"
requirement. Priority order used:

    1. Real EXIF GPS data (if the uploaded image happens to have it --
       rare for sonar images, but checked first, always)
    2. Real NOAA coordinates (if the filename matches a known named
       shipwreck from the AI4Shipwrecks train/test set)
    3. Random dummy coordinates within the Thunder Bay National Marine
       Sanctuary area (Michigan) -- chosen because that's where this
       dataset was ACTUALLY collected, so even the "fake" points sit in
       a geographically honest location for the demo.

Drop this file next to main.py, then in main.py:
    from geotag_utils import resolve_geotag
    ...
    geotag_result = resolve_geotag(file_path=str(file_path), filename=file.filename)
"""

import re
import random
from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS

# ---- Real NOAA-sourced coordinates for named wrecks (confirmed so far) ----
WRECK_COORDS = {
    "isaac_m_scott": {"lat": 45.065333, "lon": -83.039217},
    "dm_wilson":     {"lat": 45.065333, "lon": -83.182133},
    "dr_hanna":      {"lat": 45.084167, "lon": -83.086550},
    "eb_allen":      {"lat": 45.016267, "lon": -83.164983},
    # TODO: add remaining train wrecks here as/when confirmed
    # (Bay City, Egyptian, Grecian, Harvey Bissell, Heart Failure,
    #  Montana, Oscar T Flint, Pewabic, WP Rend)
}

# Thunder Bay National Marine Sanctuary bounding area (Alpena, MI, Lake Huron)
# -- used only when neither real EXIF nor a known wreck name is available
DUMMY_LAT_RANGE = (44.95, 45.15)
DUMMY_LON_RANGE = (-83.35, -83.05)


def _convert_to_degrees(value):
    d, m, s = value
    return float(d) + (float(m) / 60.0) + (float(s) / 3600.0)


def _extract_exif_geotag(image_path: str):
    """Tries to read real GPS EXIF data from the image file."""
    try:
        image = Image.open(image_path)
        exif_data = image._getexif()
        if not exif_data:
            return None

        gps_info = {}
        for tag_id, value in exif_data.items():
            tag = TAGS.get(tag_id, tag_id)
            if tag == "GPSInfo":
                for gps_tag_id, gps_value in value.items():
                    gps_tag = GPSTAGS.get(gps_tag_id, gps_tag_id)
                    gps_info[gps_tag] = gps_value

        if not gps_info:
            return None

        lat = _convert_to_degrees(gps_info["GPSLatitude"])
        if gps_info.get("GPSLatitudeRef") != "N":
            lat = -lat
        lon = _convert_to_degrees(gps_info["GPSLongitude"])
        if gps_info.get("GPSLongitudeRef") != "E":
            lon = -lon

        return {"latitude": round(lat, 6), "longitude": round(lon, 6)}
    except Exception:
        return None


def _normalize_wreck_key(filename: str) -> str:
    """'Isaac_M_Scott_04.png' -> 'isaac_m_scott'"""
    stem = filename.rsplit(".", 1)[0]
    stem = re.sub(r"_\d+$", "", stem)
    return stem.lower()


def _lookup_wreck_coords(filename: str):
    key = _normalize_wreck_key(filename)
    return WRECK_COORDS.get(key)


def _generate_dummy_coords():
    lat = round(random.uniform(*DUMMY_LAT_RANGE), 6)
    lon = round(random.uniform(*DUMMY_LON_RANGE), 6)
    return {"latitude": lat, "longitude": lon}


def resolve_geotag(file_path: str, filename: str):
    """
    Main entry point. Returns:
        {
            "latitude": float,
            "longitude": float,
            "source": "real_exif" | "real_noaa" | "simulated"
        }
    """
    exif_result = _extract_exif_geotag(file_path)
    if exif_result:
        return {**exif_result, "source": "real_exif"}

    wreck_result = _lookup_wreck_coords(filename)
    if wreck_result:
        return {"latitude": wreck_result["lat"], "longitude": wreck_result["lon"], "source": "real_noaa"}

    dummy_result = _generate_dummy_coords()
    return {**dummy_result, "source": "simulated"}


if __name__ == "__main__":
    # Quick self-test -- no real files needed for the fallback cases
    print(resolve_geotag("nonexistent.png", "Isaac_M_Scott_03.png"))
    print(resolve_geotag("nonexistent.png", "SomeRandomTerrain_01.png"))