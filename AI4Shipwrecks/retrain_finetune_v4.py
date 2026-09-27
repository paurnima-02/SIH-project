from ultralytics import YOLO

# Continue from the STABLE checkpoint (v3), not from scratch --
# it already learned real features without diverging.
model = YOLO("runs/detect/shipwreck_detector_v3_stable/weights/best.pt")

results = model.train(
    data="yolo_dataset/data.yaml",
    epochs=40,            # ~2.35 min/epoch observed -> roughly 1.5 hours
    patience=15,
    imgsz=960,
    batch=4,
    lr0=0.0005,             # even lower than before -- fine-tuning an already-decent
                            # model needs gentler updates, not big jumps
    freeze=5,               # unfreeze a bit more than before (was 10) -- backbone
                            # is more adapted now, can afford to fine-tune deeper
    optimizer="SGD",
    name="shipwreck_detector_v4_finetune",
)

print("Done. Check the LAST line of:")
print("  runs/detect/shipwreck_detector_v4_finetune/results.csv")
