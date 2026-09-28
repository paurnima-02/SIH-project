"""
test_3d_whole_frame.py — reconstruct an ENTIRE waterfall/survey image as
one 3-D relief, no bbox, no single-object pointer. This is what matches
Fig. 6(d) / 9(d) in the Coiras et al. paper: the whole highlighted region
reconstructed together, ripples and any embedded features all showing up
from the shading.

Usage: python test_3d_whole_frame.py <image.png> [pixel_size_m] [altitude_m]

For a single detected object instead, use test_3d_custom.py (which needs
a real bbox and produces a schematic pointer, not a full-scene relief).
"""

import sys
import os
from reconstruct_3d import reconstruct_patch
from render_3d import render_textured_surface, render_elevation_map

image_path = sys.argv[1]
pixel_size_m = float(sys.argv[2]) if len(sys.argv) > 2 else 0.1
altitude_m = float(sys.argv[3]) if len(sys.argv) > 3 else 60.0

os.makedirs("results", exist_ok=True)
name = os.path.splitext(os.path.basename(image_path))[0].replace(" ", "_")

r = reconstruct_patch(
    image_path, "./results",
    pixel_size_m=pixel_size_m, sensor_altitude_m=altitude_m,
    name=name, mode="physical",
)
print("estimated_height_m:", r["estimated_height_m"], "| source:", r["height_source"])

out_path = f"results/{name}_3d_preview.png"
render_textured_surface(f"results/{name}_heightmap.npy", image_path, out_path, pixel_size_m=pixel_size_m, colormap="gray")
print("3D preview saved at", out_path)

elevation_path = f"results/{name}_elevation_map.png"
render_elevation_map(f"results/{name}_heightmap.npy", pixel_size_m, elevation_path)
print("Elevation map saved at", elevation_path, "  <-- this is the Fig. 6(c)-style output")
print(f'Open it with:  ii "{elevation_path}"   (PowerShell)')