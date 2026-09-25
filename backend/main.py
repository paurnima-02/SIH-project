from fastapi import (
    FastAPI,
    UploadFile,
    File,
    HTTPException,
    Form,
    Depends,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from sqlalchemy.orm import Session

from typing import Optional
from pathlib import Path
from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS

import shutil
import uuid
import cv2
import json

# IMPORTANT:
# Since we run using "uvicorn backend.main:app",
# imports from backend files must use ".".
from .detector import detect
from .database import engine, get_db
from .models import Base, Detection
from .report import (
    router as report_router,
    resolve_location,
    log_detection_record,
)


# ============================================================
# DATABASE
# ============================================================

Base.metadata.create_all(bind=engine)


# ============================================================
# FASTAPI APP
# ============================================================

app = FastAPI(
    title="Marine Debris Detection API",
    description="Backend API for marine debris detection using YOLO",
    version="1.0.0",
)


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# REPORT ROUTER
# ============================================================

app.include_router(report_router)


# ============================================================
# DIRECTORIES
# ============================================================

UPLOAD_DIR = Path("backend/uploads")
RESULT_DIR = Path("backend/results")

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
RESULT_DIR.mkdir(parents=True, exist_ok=True)


# ============================================================
# GPS / EXIF FUNCTIONS
# ============================================================

def convert_to_degrees(value):
    """
    Convert GPS coordinates from EXIF
    degrees/minutes/seconds format into decimal degrees.
    """

    d, m, s = value

    return (
        float(d)
        + (float(m) / 60.0)
        + (float(s) / 3600.0)
    )


def extract_geotag(image_path: str):
    """
    Extract GPS latitude and longitude from image EXIF data.

    Returns:
        {
            "latitude": float,
            "longitude": float
        }

    or None if GPS data is unavailable.
    """

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

                    gps_tag = GPSTAGS.get(
                        gps_tag_id,
                        gps_tag_id
                    )

                    gps_info[gps_tag] = gps_value

        if not gps_info:
            return None

        # Make sure latitude and longitude exist
        if "GPSLatitude" not in gps_info:
            return None

        if "GPSLongitude" not in gps_info:
            return None

        lat = convert_to_degrees(
            gps_info["GPSLatitude"]
        )

        lon = convert_to_degrees(
            gps_info["GPSLongitude"]
        )

        # Latitude direction
        if gps_info.get("GPSLatitudeRef") != "N":
            lat = -lat

        # Longitude direction
        if gps_info.get("GPSLongitudeRef") != "E":
            lon = -lon

        return {
            "latitude": round(lat, 6),
            "longitude": round(lon, 6),
        }

    except Exception:
        return None


# ============================================================
# ROOT
# ============================================================

@app.get("/")
def root():

    return {
        "message": "Marine Debris Detection API is running"
    }


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/health")
def health():

    return {
        "status": "healthy"
    }


# ============================================================
# PREDICTION
# ============================================================

@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    survey_id: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):

    # --------------------------------------------------------
    # 1. Validate file type
    # --------------------------------------------------------

    allowed_types = {
        "image/jpeg",
        "image/png",
        "image/jpg",
    }

    if file.content_type not in allowed_types:

        raise HTTPException(
            status_code=400,
            detail="Only JPG and PNG images are allowed.",
        )

    # --------------------------------------------------------
    # 2. Generate unique ID
    # --------------------------------------------------------

    file_id = str(uuid.uuid4())

    original_filename = (
        f"{file_id}_{file.filename}"
    )

    file_path = UPLOAD_DIR / original_filename

    # --------------------------------------------------------
    # 3. Save uploaded image
    # --------------------------------------------------------

    try:

        with open(file_path, "wb") as buffer:

            shutil.copyfileobj(
                file.file,
                buffer
            )

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=f"Failed to save uploaded file: {str(e)}",
        )

    # --------------------------------------------------------
    # 4. Extract GPS information
    # --------------------------------------------------------

    geotag = extract_geotag(
        str(file_path)
    )

    # Resolve location.
    # This can use EXIF or fallback location depending
    # on your report.py implementation.

    try:

        location = resolve_location(
            geotag
        )

    except Exception:

        # If resolve_location fails,
        # don't crash the entire prediction.

        location = {
            "latitude": (
                geotag["latitude"]
                if geotag
                else None
            ),
            "longitude": (
                geotag["longitude"]
                if geotag
                else None
            ),
            "source": (
                "exif"
                if geotag
                else "unknown"
            ),
        }

    # --------------------------------------------------------
    # 5. Get image dimensions
    # --------------------------------------------------------

    try:

        with Image.open(file_path) as img:

            img_width, img_height = img.size

    except Exception:

        img_width = None
        img_height = None

    # --------------------------------------------------------
    # 6. Run YOLO detection
    # --------------------------------------------------------

    try:

        results = detect(
            str(file_path)
        )

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=f"Detection failed: {str(e)}",
        )

    # --------------------------------------------------------
    # 7. Prepare result file
    # --------------------------------------------------------

    detections = []

    result_filename = (
        f"{file_id}_annotated.jpg"
    )

    result_path = (
        RESULT_DIR / result_filename
    )

    # --------------------------------------------------------
    # 8. Process YOLO results
    # --------------------------------------------------------

    for result in results:

        # Create annotated image

        annotated_image = result.plot()

        cv2.imwrite(
            str(result_path),
            annotated_image
        )

        # Extract bounding boxes

        for box in result.boxes:

            class_id = int(
                box.cls[0]
            )

            confidence = float(
                box.conf[0]
            )

            x1, y1, x2, y2 = (
                box.xyxy[0].tolist()
            )

            detections.append(
                {
                    "class": result.names[class_id],

                    "confidence": round(
                        confidence,
                        4
                    ),

                    "bbox": [
                        round(x1, 2),
                        round(y1, 2),
                        round(x2, 2),
                        round(y2, 2),
                    ],
                }
            )

    # --------------------------------------------------------
    # 9. Save detections to database
    # --------------------------------------------------------

    db_rows = []

    # Use actual EXIF coordinates for DB
    # if available.

    lat = (
        geotag["latitude"]
        if geotag
        else None
    )

    lon = (
        geotag["longitude"]
        if geotag
        else None
    )

    for detection in detections:

        row = Detection(
            class_name=detection["class"],
            confidence=detection["confidence"],
            latitude=lat,
            longitude=lon,
            survey_id=survey_id,
            status="NEW",
        )

        db.add(row)

        db_rows.append(row)

    try:

        db.commit()

    except Exception as e:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=f"Database error: {str(e)}",
        )

    # --------------------------------------------------------
    # 10. Add database IDs to detections
    # --------------------------------------------------------

    for detection, row in zip(
        detections,
        db_rows
    ):

        db.refresh(row)

        detection["id"] = row.id

        detection["status"] = row.status

    # --------------------------------------------------------
    # 11. Determine detection status
    # --------------------------------------------------------

    detection_status = (
        "debris_detected"
        if len(detections) > 0
        else "no_debris_detected"
    )

    # --------------------------------------------------------
    # 12. Build interpretation JSON
    # --------------------------------------------------------

    interpretation = {

        "image_id": file_id,

        "original_filename": file.filename,

        "geotag": geotag,

        "location": location,

        "detection_count": len(
            detections
        ),

        "detections": detections,

        "status": detection_status,
    }

    # --------------------------------------------------------
    # 13. Save interpretation JSON
    # --------------------------------------------------------

    interpretation_filename = (
        f"{file_id}_interpretation.json"
    )

    interpretation_path = (
        RESULT_DIR / interpretation_filename
    )

    try:

        with open(
            interpretation_path,
            "w",
            encoding="utf-8"
        ) as f:

            json.dump(
                interpretation,
                f,
                indent=2,
            )

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=f"Failed to save interpretation: {str(e)}",
        )

    # --------------------------------------------------------
    # 14. Save report log
    # --------------------------------------------------------

    try:

        log_detection_record(
            image_id=file_id,
            original_filename=file.filename,
            status=detection_status,
            detections=detections,
            location=location,
        )

    except Exception as e:

        print(
            f"Warning: report logging failed: {e}"
        )

    # --------------------------------------------------------
    # 15. Return response to frontend
    # --------------------------------------------------------

    return {

        "success": True,

        "image_id": file_id,

        "original_image": (
            f"/uploads/{original_filename}"
        ),

        "annotated_image": (
            f"/results/{result_filename}"
        ),

        "interpretation": interpretation,

        "interpretation_file": (
            f"/results/{interpretation_filename}"
        ),

        "detections": detections,

        "geotag": {

            "lat": (
                location.get("latitude")
            ),

            "lng": (
                location.get("longitude")
            ),

            "source": (
                location.get(
                    "source",
                    "unknown"
                )
            ),
        },

        "image_width": img_width,

        "image_height": img_height,
    }


# ============================================================
# RESULT IMAGE
# ============================================================

@app.get("/results/{filename}")
def get_result_file(filename: str):

    file_path = (
        RESULT_DIR / filename
    )

    if not file_path.exists():

        raise HTTPException(
            status_code=404,
            detail="Result file not found.",
        )

    return FileResponse(
        file_path
    )


# ============================================================
# ORIGINAL IMAGE
# ============================================================

@app.get("/uploads/{filename}")
def get_original_image(filename: str):

    file_path = (
        UPLOAD_DIR / filename
    )

    if not file_path.exists():

        raise HTTPException(
            status_code=404,
            detail="Original image not found.",
        )

    return FileResponse(
        file_path
    )


# ============================================================
# DATABASE SERIALIZATION
# ============================================================

def detection_to_dict(row: Detection):

    return {

        "id": row.id,

        "class_name": row.class_name,

        "confidence": row.confidence,

        "latitude": row.latitude,

        "longitude": row.longitude,

        "dimensions": row.dimensions,

        "survey_id": row.survey_id,

        "status": row.status,

        "last_seen": (
            row.last_seen.isoformat()
            if row.last_seen
            else None
        ),

        "created_at": (
            row.created_at.isoformat()
            if row.created_at
            else None
        ),

        "updated_at": (
            row.updated_at.isoformat()
            if row.updated_at
            else None
        ),
    }


# ============================================================
# GET ALL DETECTIONS
# ============================================================

@app.get("/detections")
def get_detections(

    survey_id: Optional[str] = None,

    status: Optional[str] = None,

    db: Session = Depends(get_db),
):

    query = db.query(
        Detection
    )

    if survey_id:

        query = query.filter(
            Detection.survey_id
            == survey_id
        )

    if status:

        query = query.filter(
            Detection.status
            == status
        )

    rows = (
        query
        .order_by(
            Detection.id.desc()
        )
        .all()
    )

    return [
        detection_to_dict(row)
        for row in rows
    ]


# ============================================================
# GET SINGLE DETECTION
# ============================================================

@app.get("/detections/{id}")
def get_detection(

    id: int,

    db: Session = Depends(get_db),
):

    row = (
        db.query(Detection)
        .filter(
            Detection.id == id
        )
        .first()
    )

    if not row:

        raise HTTPException(
            status_code=404,
            detail="Detection not found",
        )

    return detection_to_dict(
        row
    )