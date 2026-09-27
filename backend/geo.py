
import math
 
EARTH_RADIUS_M = 6371000.0
 
 
def destination_point(lat, lon, bearing_deg, distance_m):
    """Standard spherical 'destination point given start, bearing, distance'."""
    lat1 = math.radians(lat)
    lon1 = math.radians(lon)
    brg = math.radians(bearing_deg)
    d_r = distance_m / EARTH_RADIUS_M
 
    lat2 = math.asin(
        math.sin(lat1) * math.cos(d_r) + math.cos(lat1) * math.sin(d_r) * math.cos(brg)
    )
    lon2 = lon1 + math.atan2(
        math.sin(brg) * math.sin(d_r) * math.cos(lat1),
        math.cos(d_r) - math.sin(lat1) * math.sin(lat2),
    )
    return math.degrees(lat2), (math.degrees(lon2) + 540) % 360 - 180
 
 
def pixel_to_latlon(sensor_lat, sensor_lon, heading_deg, col_px, nadir_col_px, pixel_size_m):
    """
    col_px: the detection's column in the waterfall/corrected image (e.g.
    bbox x-centre). nadir_col_px: the image column directly beneath the
    sensor (usually image_width // 2). Positive offset = starboard side.
    """
    across_track_m = (col_px - nadir_col_px) * pixel_size_m
    bearing = (heading_deg + 90) % 360 if across_track_m >= 0 else (heading_deg - 90) % 360
    return destination_point(sensor_lat, sensor_lon, bearing, abs(across_track_m))
 
 
def nearest_nav_row(nav_rows, target_row_index):
    """
    nav_rows: list of dicts, each with 'row_index', 'lat', 'lon', 'heading'
    (i.e. one row per line of Member 1's *_nav.csv, loaded with csv.DictReader).
    Returns the row whose row_index is closest to target_row_index (a
    detection's bbox y-centre may fall between two ping rows).
    """
    return min(nav_rows, key=lambda r: abs(r["row_index"] - target_row_index))