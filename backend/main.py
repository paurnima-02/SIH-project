from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi import FastAPI, UploadFile, File, HTTPException, Form, Depends
from sqlalchemy.orm import Session
from typing import Optional
from pathlib import Path
from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS
import shutil
import uuid
import cv2
import json

from detector import detect
from database import engine,get_db
from models import Base,Detection
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Marine Debris Detection API",
    description="Backend API for marine debris detection using YOLO",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path("uploads")
RESULT_DIR = Path("results")

UPLOAD_DIR.mkdir(exist_ok=True)
RESULT_DIR.mkdir(exist_ok=True)


def convert_to_degrees(value):
    """Convert GPS coordinates from EXIF (degrees, minutes, seconds) to decimal degrees."""
    d, m, s = value
    return float(d) + (float(m) / 60.0) + (float(s) / 3600.0)


def extract_geotag(image_path: str):
    """Extract GPS latitude/longitude from image EXIF data, if present."""
    try:
        image = Image.open(image_path)
        exif_data = image._getexif()

        if not exif_data:
            return None

        gps_info = {}
        for tag_id, value in exif_data.items():
            tag = TAGS.get(tag_id, tag_id)
            if tag == "GPSInfo":
                for gps_tag_id, gps_value in value.items():
                    gps_tag = GPSTAGS.get(gps_tag_id, gps_tag_id)
                    gps_info[gps_tag] = gps_value

        if not gps_info:
            return None

        lat = convert_to_degrees(gps_info["GPSLatitude"])
        if gps_info.get("GPSLatitudeRef") != "N":
            lat = -lat

        lon = convert_to_degrees(gps_info["GPSLongitude"])
        if gps_info.get("GPSLongitudeRef") != "E":
            lon = -lon

        return {"latitude": round(lat, 6), "longitude": round(lon, 6)}

    except Exception:
        return None


def resolve_location(geotag):
    """Return a location object with a consistent shape for the API response."""
    if geotag:
        return {
            "latitude": geotag["latitude"],
            "longitude": geotag["longitude"],
            "source": "exif",
        }

    # Keep the response shape stable when an image has no EXIF GPS data.
    return {
        "latitude": None,
        "longitude": None,
        "source": "dummy_fallback",
    }


@app.get("/")
def root():
    return {"message": "Marine Debris Detection API is running"}


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    survey_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):

    allowed_types = {"image/jpeg", "image/png", "image/jpg"}

    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail="Only JPG and PNG images are allowed."
        )

    file_id = str(uuid.uuid4())
    original_filename = f"{file_id}_{file.filename}"
    file_path = UPLOAD_DIR / original_filename

    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to save uploaded file.")

    # Extract geotag from EXIF, falling back to dummy survey coordinates if missing
    geotag = extract_geotag(str(file_path))
    location = resolve_location(geotag)  # always populated: real EXIF or dummy_fallback

    try:
        with Image.open(file_path) as img:
            img_width, img_height = img.size
    except Exception:
        img_width, img_height = None, None

    try:
        results = detect(str(file_path))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Detection failed: {str(e)}")

    detections = []
    result_filename = f"{file_id}_annotated.jpg"
    result_path = RESULT_DIR / result_filename

    for result in results:
        annotated_image = result.plot()
        cv2.imwrite(str(result_path), annotated_image)

        for box in result.boxes:
            class_id = int(box.cls[0])
            confidence = float(box.conf[0])
            x1, y1, x2, y2 = box.xyxy[0].tolist()

            detections.append({
                "class": result.names[class_id],
                "confidence": round(confidence, 4),
                "bbox": [round(x1, 2), round(y1, 2), round(x2, 2), round(y2, 2)]
            })

    # ── save each detection into the database ──
    db_rows = []
    lat = geotag["latitude"] if geotag else None
    lon = geotag["longitude"] if geotag else None

    for d in detections:
        row = Detection(
            class_name=d["class"],
            confidence=d["confidence"],
            latitude=lat,
            longitude=lon,
            survey_id=survey_id,
            status="NEW",
        )
        db.add(row)
        db_rows.append(row)

    db.commit()

    for d, row in zip(detections, db_rows):
        db.refresh(row)
        d["id"] = row.id
        d["status"] = row.status

    interpretation = {
        "image_id": file_id,
        "geotag": geotag,
        "detection_count": len(detections),
        "detections": detections,
        "status": "debris_detected" if len(detections) > 0 else "no_debris_detected"
    }

    interpretation_filename = f"{file_id}_interpretation.json"
    interpretation_path = RESULT_DIR / interpretation_filename
    with open(interpretation_path, "w") as f:
        json.dump(interpretation, f, indent=2)

    return {
        "success": True,
        "original_image": f"/uploads/{original_filename}",
        "annotated_image": f"/results/{result_filename}",
        "interpretation": interpretation,
        "interpretation_file": f"/results/{interpretation_filename}",
        "detections": detections,
        "geotag": {
            "lat": geotag["latitude"] if geotag else None,
            "lng": geotag["longitude"] if geotag else None,
        },
        "image_width": img_width,
        "image_height": img_height,
    }


    # Build the interpretation object (kept for the searchable log / JSON export requirement)
    interpretation = {
        "image_id": file_id,
        "geotag": geotag,
        "location": location,
        "detection_count": len(detections),
        "detections": detections,
        "status": "debris_detected" if len(detections) > 0 else "no_debris_detected"
    }

    interpretation_filename = f"{file_id}_interpretation.json"
    interpretation_path = RESULT_DIR / interpretation_filename
    with open(interpretation_path, "w") as f:
        json.dump(interpretation, f, indent=2)

    # Persist this record into the report log (used by /report/csv and /report/heatmap)
    log_detection_record(
        image_id=file_id,
        original_filename=file.filename,
        status=interpretation["status"],
        detections=detections,
        location=location,
    )

    return {
        "success": True,
        "original_image": f"/uploads/{original_filename}",
        "annotated_image": f"/results/{result_filename}",
        "interpretation": interpretation,
        "interpretation_file": f"/results/{interpretation_filename}",

        # ── Top-level fields for frontend (api.ts) compatibility ──
        "detections": detections,
        "geotag": {
            "lat": location["latitude"],
            "lng": location["longitude"],
            "source": location["source"],  # "exif" or "dummy_fallback"
        },
        "image_width": img_width,
        "image_height": img_height,
    }


@app.get("/results/{filename}")
def get_result_file(filename: str):
    file_path = RESULT_DIR / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found.")
    return FileResponse(file_path)

def detection_to_dict(row: Detection):
    """Serialize a Detection ORM row into a plain JSON-safe dict."""
    return {
        "id": row.id,
        "class_name": row.class_name,
        "confidence": row.confidence,
        "latitude": row.latitude,
        "longitude": row.longitude,
        "dimensions": row.dimensions,
        "survey_id": row.survey_id,
        "status": row.status,
        "last_seen": row.last_seen.isoformat() if row.last_seen else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@app.get("/detections")
def get_detections(
    survey_id: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """List detections, newest first. Optional filters: ?survey_id=...&status=..."""
    query = db.query(Detection)

    if survey_id:
        query = query.filter(Detection.survey_id == survey_id)
    if status:
        query = query.filter(Detection.status == status)

    rows = query.order_by(Detection.id.desc()).all()
    return [detection_to_dict(row) for row in rows]


@app.get("/detections/{id}")
def get_detection(id: int, db: Session = Depends(get_db)):
    """Fetch a single detection by its ID."""
    row = db.query(Detection).filter(Detection.id == id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Detection not found")
    return detection_to_dict(row)


@app.get("/uploads/{filename}")
def get_original_image(filename: str):
    file_path = UPLOAD_DIR / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Original image not found.")
    return FileResponse(file_path)