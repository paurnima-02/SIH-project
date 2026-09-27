"""
auto_3d.py — ONE command, does ONE thing: flat seabed + the object raised
in its own real shape. No modes to pick, no bbox to type by hand.

Usage: python auto_3d.py <image.png> [pixel_size_m] [altitude_m]

It finds the brightest connected blob in the image automatically (that's
your object) and reconstructs around it. If your image has more than one
object and you need a SPECIFIC one, use test_3d_custom.py with its real
bbox instead — this script always goes after the single brightest blob.
"""

import sys
import os
import cv2
import numpy as np
from PIL import Image
from reconstruct_3d import reconstruct_patch_from_bbox, load_patch
from render_3d import render_textured_surface


def auto_detect_bbox(patch: np.ndarray):
    """Finds the largest bright connected blob and returns its (x1,y1,x2,y2)."""
    img8 = (np.clip(patch, 0, 1) * 255).astype(np.uint8)
    blurred = cv2.GaussianBlur(img8, (0, 0), sigmaX=2)
    _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    largest = max(contours, key=cv2.contourArea)
    x, y, w, h = cv2.boundingRect(largest)
    return (x, y, x + w, y + h)


image_path = sys.argv[1]
pixel_size_m = float(sys.argv[2]) if len(sys.argv) > 2 else 0.1
altitude_m = float(sys.argv[3]) if len(sys.argv) > 3 else 60.0

os.makedirs("results", exist_ok=True)
name = os.path.splitext(os.path.basename(image_path))[0].replace(" ", "_")

patch = load_patch(image_path)
bbox = auto_detect_bbox(patch)

if bbox is None:
    print("Could not find a distinct bright object in this image. "
          "Use test_3d_custom.py with a manual bbox instead.")
    sys.exit(1)

x1, y1, x2, y2 = bbox
print(f"[auto_3d] auto-detected object bbox: {bbox}")

full_img = Image.open(image_path)
img_width, img_height = full_img.size

bbox_w, bbox_h = x2 - x1, y2 - y1
bbox_area_frac = (bbox_w * bbox_h) / (img_width * img_height)
if bbox_area_frac > 0.85:
    print("[auto_3d] note: the detected object covers most of this image — "
          "proceeding anyway, but if this looks wrong, try "
          "test_3d_whole_frame.py instead.")

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
    name=name, mode="schematic",
)
print("estimated_height_m:", r["estimated_height_m"], "| source:", r["height_source"])

out_path = f"results/{name}_3d_preview.png"
render_textured_surface(f"results/{name}_heightmap.npy", crop_path, out_path, pixel_size_m=pixel_size_m)
print("Preview saved at", out_path)
print(f'Open it with:  ii "{out_path}"   (PowerShell)')