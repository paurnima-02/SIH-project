from ultralytics import YOLO
from pathlib import Path

MODEL_PATH = Path(__file__).parent / "models" / "best.pt"

model = YOLO(str(MODEL_PATH))


def detect(image_path: str):
    results = model.predict(
        source=image_path,
        conf=0.25,
        save=False
    )

    return results