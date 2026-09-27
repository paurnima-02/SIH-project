from ultralytics import YOLO
from pathlib import Path


# =====================================================
# DRISHTI SONAR DETECTION MODEL
# =====================================================

MODEL_PATH = Path(__file__).parent / "models" / "best_detector.pt"

print("MODEL PATH:", MODEL_PATH)
print("MODEL EXISTS:", MODEL_PATH.exists())

if not MODEL_PATH.exists():
    raise FileNotFoundError(
        f"DRISHTI model not found at: {MODEL_PATH}"
    )


model = YOLO(str(MODEL_PATH))

print("MODEL CLASSES:", model.names)


# =====================================================
# DETECTION FUNCTION
# =====================================================

def detect(image_path: str):

    results = model.predict(
        source=image_path,
        conf=0.10,
        imgsz=640,
        save=False
    )

    for result in results:

        print("================================")
        print("IMAGE:", image_path)
        print("NUMBER OF BOXES:", len(result.boxes))

        if len(result.boxes) == 0:
            print("NO DETECTIONS FOUND")
            continue

        print("CLASSES:", result.boxes.cls.tolist())
        print("CONFIDENCES:", result.boxes.conf.tolist())

        for box in result.boxes:

            class_id = int(box.cls[0])

            class_name = result.names[class_id]

            confidence = float(box.conf[0])

            x1, y1, x2, y2 = box.xyxy[0].tolist()

            print(
                f"Detection: "
                f"class={class_name}, "
                f"confidence={confidence:.4f}, "
                f"bbox={[x1, y1, x2, y2]}"
            )

    return results