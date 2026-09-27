from ultralytics import YOLO

# yolov8n (nano) instead of yolov8s -- much faster per epoch, and with a
# small dataset the extra capacity of "s" wasn't helping anyway.
model = YOLO("yolov8n.pt")

results = model.train(
    data="yolo_dataset/data.yaml",
    epochs=20,            # realistic for a 5-hour budget at this speed
    patience=10,           # stop early if it's not improving
    imgsz=960,             # smaller than 1280 (faster), still much bigger than 640
                            # (keeps the tiny debris boxes visible, just less extreme)
    batch=4,               # smaller, more stable, less memory pressure
    lr0=0.001,              # MUCH lower than default -- this is why the last run
                            # diverged (loss exploded to 12855). Lower LR = stable.
    freeze=10,              # freeze the first 10 backbone layers -- keeps the
                            # pretrained COCO features intact, only fine-tunes the
                            # detection head. Much more stable on a small dataset.
    optimizer="SGD",        # more stable/predictable than AdamW for this kind of
                            # small-dataset fine-tuning
    name="shipwreck_detector_v3_stable",
)

print("Done. Check the LAST line of:")
print("  runs/detect/shipwreck_detector_v3_stable/results.csv")
print("Watch metrics/mAP50 -- it should be INCREASING and val/cls_loss DECREASING,")
print("not exploding like the last run.")
