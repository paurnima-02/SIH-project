from ultralytics import YOLO

# Fresh start from COCO-pretrained weights (not continuing the old
# checkpoint, which learned on squished/invisible tiny boxes at imgsz=640).
# yolov8s (small) instead of yolov8n (nano) -- a bit more capacity helps
# with genuinely small/hard objects like these thin debris boxes.
model = YOLO("yolov8s.pt")  # auto-downloads on first run

results = model.train(
    data="yolo_dataset/data.yaml",
    epochs=100,          # patience will stop early if it plateaus, so this is a ceiling
    patience=30,          # stop if no improvement for 30 epochs (avoids wasting time)
    imgsz=1280,           # key fix: keeps tiny debris boxes visible during training
    batch=8,              # reduce to 4 if you get an out-of-memory error
    name="shipwreck_detector_v2_hires",
)

print("Done. Check the LAST line of:")
print("  runs/detect/shipwreck_detector_v2_hires/results.csv")
print("Look at mAP50 specifically -- that's the number that tells us if this worked.")
