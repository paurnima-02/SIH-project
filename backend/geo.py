# backend/geo.py
def nearest_nav_row(nav_df, target_row_index):
    """
    nav_df: the pandas DataFrame from process_xtf_to_waterfall (row_index,
    lat, lon, heading, altitude, timestamp), aligned 1:1 with image rows.
    Returns the nav row closest to target_row_index (a detection's bbox
    y-centre may fall between two ping rows).
    """
    idx = (nav_df["row_index"] - target_row_index).abs().idxmin()
    return nav_df.loc[idx]