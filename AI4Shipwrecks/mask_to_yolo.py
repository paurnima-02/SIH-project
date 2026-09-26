from PIL import Image
from pathlib import Path

def convert_split(split):
    mask_dir = Path(split) / "labels"
    output_dir = Path(split) / "yolo_labels"
    output_dir.mkdir(exist_ok=True)

    masks = list(mask_dir.glob("*.png"))

    converted = 0
    empty = 0

    for mask_path in masks:
        img = Image.open(mask_path).convert("L")
        width, height = img.size

        bbox = img.getbbox()

        output_path = output_dir / f"{mask_path.stem}.txt"

        if bbox is None:
            # Empty mask = no object
            output_path.write_text("")
            empty += 1
            continue

        left, top, right, bottom = bbox

        # YOLO normalized coordinates
        x_center = ((left + right) / 2) / width
        y_center = ((top + bottom) / 2) / height
        box_width = (right - left) / width
        box_height = (bottom - top) / height

        # Class 0 = marine debris
        line = f"0 {x_center:.6f} {y_center:.6f} {box_width:.6f} {box_height:.6f}\n"

        output_path.write_text(line)
        converted += 1

    print(f"{split}:")
    print(f"  Total masks: {len(masks)}")
    print(f"  Non-empty converted: {converted}")
    print(f"  Empty masks: {empty}")
    print(f"  YOLO labels created: {len(masks)}")


convert_split("train")
convert_split("test")

print("\nConversion complete.")