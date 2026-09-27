"""
crop_image.py — crop a small region out of a larger sonar image before
running the 3D reconstruction on it. Open the full image in Paint/any
viewer first, note the pixel coordinates of the object's bounding box
(top-left and bottom-right corners), then run this.

Usage: python crop_image.py full_image.png x1 y1 x2 y2 output_crop.png
"""
import sys
from PIL import Image

full_path, x1, y1, x2, y2, out_path = sys.argv[1:7]
img = Image.open(full_path)
crop = img.crop((int(x1), int(y1), int(x2), int(y2)))
crop.save(out_path)
print(f"Saved crop ({crop.size[0]}x{crop.size[1]}px) to {out_path}")