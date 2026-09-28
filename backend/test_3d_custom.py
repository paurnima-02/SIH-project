"""
test_3d_custom.py — test the 3D pipeline on ANY image + a REAL bbox.

Usage:
  python test_3d_custom.py <image.png> <x1> <y1> <x2> <y2> [pixel_size_m] [altitude_m] [mode]

x1,y1,x2,y2 are REQUIRED — the actual pixel box around the object you
want to test, in THIS image. There is no placeholder/default box anymore:
that's what kept producing the same wrong result on every image, because
the leftover placeholder (300,150,380,220) happened to sit across the
nadir gap between sonar swaths, not on any actual object.

How to get x1,y1,x2,y2 for an image you don't have a detector output for:
  - Open the image in Paint / IrfanView / any viewer that shows the
    cursor's pixel position, hover over the object's top-left corner
    (that's x1,y1) and its bottom-right corner (that's x2,y2).
  - Or, if this came from your own /predict endpoint, just use the
    "bbox" field from that response directly.

mode: "schematic" (default — flat plane + the object's real footprint
      shape) or "realistic" (full textured relief — ONLY for scenes with
      real physical terrain like sand ripples).
"""

import sys
import os
from PIL import Image
from reconstruct_3d import reconstruct_patch_from_bbox
from render_3d import render_textured_surface

if len(sys.argv) < 6:
    print(__doc__)
    print("ERROR: missing bbox. You must pass x1 y1 x2 y2 for THIS image.")
    sys.exit(1)

image_path = sys.argv[1]
x1, y1, x2, y2 = (int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]))
pixel_size_m = float(sys.argv[6]) if len(sys.argv) > 6 else 0.1
altitude_m = float(sys.argv[7]) if len(sys.argv) > 7 else 60.0
mode = sys.argv[8] if len(sys.argv) > 8 else "schematic"

print(f"[test_3d_custom] bbox = ({x1},{y1},{x2},{y2}) | mode = {mode!r}")
if mode == "realistic":
    print("[test_3d_custom] WARNING: realistic mode on plain speckle-noise "
          "sonar WILL look spiky — that's expected, not a bug.")

os.makedirs("results", exist_ok=True)
name = os.path.splitext(os.path.basename(image_path))[0].replace(" ", "_")

full_img = Image.open(image_path)
img_width, img_height = full_img.size

if x2 > img_width or y2 > img_height or x1 < 0 or y1 < 0 or x2 <= x1 or y2 <= y1:
    print(f"[test_3d_custom] ERROR: bbox ({x1},{y1},{x2},{y2}) is invalid for "
          f"this image ({img_width}x{img_height}). Check the numbers and re-run.")
    sys.exit(1)

bbox_w, bbox_h = x2 - x1, y2 - y1
if bbox_w > 0.6 * img_width or bbox_h > 0.6 * img_height:
    print(f"[test_3d_custom] WARNING: this bbox covers most of the image "
          f"({bbox_w}x{bbox_h} of {img_width}x{img_height}). That's a survey "
          f"frame, not a per-object crop — output will not look like a single "
          f"detected object. Use a tighter box around just the object.")

margin_x = int(bbox_w * 0.5)
margin_y = int(bbox_h * 0.5)
padded_x1 = max(0, x1 - margin_x)
padded_y1 = max(0, y1 - margin_y)
padded_x2 = min(img_width, x2 + margin_x)
padded_y2 = min(img_height, y2 + margin_y)

crop_path = f"results/{name}_crop.png"
full_img.crop((padded_x1, padded_y1, padded_x2, padded_y2)).save(crop_path)

local_bbox = (x1 - padded_x1, y1 - padded_y1, x2 - padded_x1, y2 - padded_y1)

r = reconstruct_patch_from_bbox(
    crop_path, local_bbox, "./results",
    pixel_size_m=pixel_size_m, sensor_altitude_m=altitude_m,
    name=name, mode=mode,
)
print("estimated_height_m:", r["estimated_height_m"], "| source:", r["height_source"], "| mode:", mode)

out_path = f"results/{name}_3d_preview.png"
render_textured_surface(f"results/{name}_heightmap.npy", crop_path, out_path, pixel_size_m=pixel_size_m)
print("Preview saved at", out_path)
print(f'Open it with:  ii "{out_path}"   (PowerShell)')