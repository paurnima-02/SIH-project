from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path
import shutil
import uuid

from detector import detect


app = FastAPI(
    title="Marine Debris Detection API",
    description="Backend API for marine debris detection using YOLO",
    version="1.0.0"
)


UPLOAD_DIR = Path("uploads")
RESULT_DIR = Path("results")

UPLOAD_DIR.mkdir(exist_ok=True)
RESULT_DIR.mkdir(exist_ok=True)


@app.get("/")
def root():
    return {
        "message": "Marine Debris Detection API is running"
    }


@app.get("/health")
def health():
    return {
        "status": "healthy"
    }


@app.post("/predict")
async def predict(file: UploadFile = File(...)):

    allowed_types = {
        "image/jpeg",
        "image/png",
        "image/jpg"
    }

    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail="Only JPG and PNG images are allowed."
        )

    # Create a unique filename
    file_id = str(uuid.uuid4())
    file_path = UPLOAD_DIR / f"{file_id}_{file.filename}"

    # Save uploaded image
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Run YOLO detection
    results = detect(str(file_path))

    detections = []

    for result in results:

        # Create annotated image
        annotated_image = result.plot()

        result_filename = f"{file_id}_annotated.jpg"
        result_path = RESULT_DIR / result_filename

        # Save annotated image
        import cv2
        cv2.imwrite(str(result_path), annotated_image)

        # Extract detection information
        boxes = result.boxes

        for box in boxes:

            class_id = int(box.cls[0])
            confidence = float(box.conf[0])

            x1, y1, x2, y2 = box.xyxy[0].tolist()

            detections.append({
                "class": result.names[class_id],
                "confidence": round(confidence, 4),
                "bbox": [
                    round(x1, 2),
                    round(y1, 2),
                    round(x2, 2),
                    round(y2, 2)
                ]
            })

    return {
        "success": True,
        "count": len(detections),
        "detections": detections,
        "annotated_image": f"/results/{result_filename}"
    }


@app.get("/results/{filename}")
def get_result_image(filename: str):

    file_path = RESULT_DIR / filename

    if not file_path.exists():
        raise HTTPException(
            status_code=404,
            detail="Result image not found."
        )

    return FileResponse(
        file_path,
        media_type="image/jpeg"
    )