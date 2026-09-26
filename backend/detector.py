from ultralytics import YOLO
from pathlib import Path


# ---------------------------------------------------------
# MODEL
# ---------------------------------------------------------

MODEL_PATH = Path(__file__).parent / "models" / "best.pt"

print("MODEL PATH:", MODEL_PATH)
print("MODEL EXISTS:", MODEL_PATH.exists())

if not MODEL_PATH.exists():
    raise FileNotFoundError(
        f"YOLO model not found at: {MODEL_PATH}"
    )

model = YOLO(str(MODEL_PATH))

print("MODEL CLASSES:", model.names)


# ---------------------------------------------------------
# DETECTION
# ---------------------------------------------------------

def detect(image_path: str):

    results = model.predict(
        source=image_path,
        conf=0.01,
        save=False
    )

    for result in results:

        print("================================")
        print("IMAGE:", image_path)
        print("NUMBER OF BOXES:", len(result.boxes))

        if len(result.boxes) > 0:

            print(
                "CLASSES:",
                result.boxes.cls.tolist()
            )

            print(
                "CONFIDENCES:",
                result.boxes.conf.tolist()
            )

            for box in result.boxes:

                class_id = int(box.cls[0])
                confidence = float(box.conf[0])

                print(
                    f"Detection: "
                    f"class={result.names[class_id]}, "
                    f"confidence={confidence:.4f}"
                )

        else:
            print("NO DETECTIONS FOUND")

    return results