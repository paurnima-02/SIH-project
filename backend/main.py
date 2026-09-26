from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from pathlib import Path
from PIL import Image

import shutil
import uuid
import cv2
import json
import math

from datetime import datetime, timedelta

from sqlalchemy.orm import Session
from pydantic import BaseModel

from apscheduler.schedulers.background import BackgroundScheduler

from detector import detect
from database import engine, get_db
from models import Base, Detection

# NEW: combined geotagging logic (real EXIF -> real NOAA wreck coords ->
# Thunder Bay dummy fallback). See geotag_utils.py.
from geotag_utils import resolve_geotag


# =========================================================
# DATABASE
# =========================================================

Base.metadata.create_all(bind=engine)


# =========================================================
# FASTAPI APP
# =========================================================

app = FastAPI(
    title="Marine Debris Detection API",
    description="Backend API for marine debris detection using YOLO",
    version="1.0.0"
)


# =========================================================
# REQUEST MODELS
# =========================================================

class StatusUpdate(BaseModel):
    status: str


class DriftMatchRequest(BaseModel):
    latitude: float
    longitude: float
    radius_m: float = 15.0


class ResolveRequest(BaseModel):
    reason: str


# =========================================================
# CORS
# =========================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8443",
        "http://127.0.0.1:8443",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# DIRECTORIES
# =========================================================

UPLOAD_DIR = Path("uploads")
RESULT_DIR = Path("results")

UPLOAD_DIR.mkdir(exist_ok=True)
RESULT_DIR.mkdir(exist_ok=True)


# =========================================================
# DRIFT MATCHING UTILITIES
# =========================================================

def calculate_distance_and_bearing(
    lat1: float,
    lon1: float,
    lat2: float,
    lon2: float
):
    """
    Calculate distance in meters and bearing
    between two GPS coordinates.
    """

    R = 6371000

    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)

    delta_lat = math.radians(
        lat2 - lat1
    )

    delta_lon = math.radians(
        lon2 - lon1
    )

    # Haversine distance

    a = (
        math.sin(delta_lat / 2) ** 2
        +
        math.cos(lat1_rad)
        * math.cos(lat2_rad)
        * math.sin(delta_lon / 2) ** 2
    )

    c = 2 * math.atan2(
        math.sqrt(a),
        math.sqrt(1 - a)
    )

    distance = R * c

    # Bearing

    y = (
        math.sin(delta_lon)
        * math.cos(lat2_rad)
    )

    x = (
        math.cos(lat1_rad)
        * math.sin(lat2_rad)
        -
        math.sin(lat1_rad)
        * math.cos(lat2_rad)
        * math.cos(delta_lon)
    )

    bearing = math.degrees(
        math.atan2(y, x)
    )

    bearing = (bearing + 360) % 360

    return distance, bearing


# =========================================================
# MISSING DETECTION SCHEDULER
# =========================================================

MISSING_AFTER_CYCLES = 3

# Prototype:
# One scheduler run represents one monitoring cycle.
#
# For testing, this is 60 seconds.
# Later, this can be changed to match the actual survey cycle.

SURVEY_CYCLE_SECONDS = 60


def check_missing_detections():
    """
    Check active detections for consecutive missed cycles.

    If a detection has not been seen for one cycle:
        missed_cycles = 1

    If it is missed again:
        missed_cycles = 2

    After 3 consecutive missed cycles:
        status = MISSING
    """

    db = next(get_db())

    try:

        now = datetime.utcnow()

        active_detections = db.query(Detection).filter(
            Detection.status.in_([
                "CONFIRMED",
                "STATIONARY",
                "DRIFTING"
            ])
        ).all()

        for detection in active_detections:

            if detection.last_seen is None:
                continue

            time_since_seen = (
                now - detection.last_seen
            )

            # One survey cycle has passed
            if time_since_seen >= timedelta(
                seconds=SURVEY_CYCLE_SECONDS
            ):

                detection.missed_cycles += 1

                print(
                    f"[Scheduler] Detection "
                    f"{detection.id} missed cycle "
                    f"{detection.missed_cycles}"
                )

                # Mark missing after 3 cycles
                if (
                    detection.missed_cycles
                    >= MISSING_AFTER_CYCLES
                ):

                    detection.status = "MISSING"

                    print(
                        f"[Scheduler] Detection "
                        f"{detection.id} marked MISSING."
                    )

                detection.updated_at = now

        db.commit()

    except Exception as e:

        db.rollback()

        print(
            f"[Scheduler] Error checking "
            f"missing detections: {e}"
        )

    finally:
        db.close()


# =========================================================
# START SCHEDULER
# =========================================================

scheduler = BackgroundScheduler()

scheduler.add_job(
    check_missing_detections,
    "interval",
    seconds=SURVEY_CYCLE_SECONDS,
    id="missing_detection_checker",
    replace_existing=True
)

scheduler.start()

print(
    "[Scheduler] Missing detection scheduler started."
)


# =========================================================
# ROOT
# =========================================================

@app.get("/")
def root():

    return {
        "message":
        "Marine Debris Detection API is running"
    }


# =========================================================
# HEALTH
# =========================================================

@app.get("/health")
def health():

    return {
        "status": "healthy"
    }


# =========================================================
# LIFECYCLE STATUS API
# =========================================================

@app.patch("/detections/{detection_id}/status")
def update_detection_status(
    detection_id: int,
    status_update: StatusUpdate,
    db: Session = Depends(get_db)
):

    detection = db.query(Detection).filter(
        Detection.id == detection_id
    ).first()

    if not detection:

        raise HTTPException(
            status_code=404,
            detail="Detection not found."
        )

    new_status = status_update.status.upper()

    current_status = detection.status

    allowed_transitions = {

        "NEW": {
            "CONFIRMED"
        },

        "CONFIRMED": {
            "STATIONARY",
            "DRIFTING",
            "MISSING"
        },

        "STATIONARY": {
            "RESOLVED"
        },

        "DRIFTING": {
            "RESOLVED"
        },

        "MISSING": {
            "RESOLVED"
        },

        "RESOLVED": set()
    }

    allowed_next_statuses = allowed_transitions.get(
        current_status,
        set()
    )

    if new_status not in allowed_next_statuses:

        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid status transition: "
                f"{current_status} -> {new_status}"
            )
        )

    detection.status = new_status

    detection.updated_at = datetime.utcnow()

    db.commit()

    db.refresh(detection)

    return {

        "success": True,

        "detection_id":
            detection.id,

        "previous_status":
            current_status,

        "status":
            detection.status
    }


# =========================================================
# DRIFT MATCHING API
# =========================================================

@app.post("/detections/{detection_id}/drift-match")
def drift_match(
    detection_id: int,
    request: DriftMatchRequest,
    db: Session = Depends(get_db)
):

    detection = db.query(Detection).filter(
        Detection.id == detection_id
    ).first()

    if not detection:

        raise HTTPException(
            status_code=404,
            detail="Detection not found."
        )

    if detection.status != "CONFIRMED":

        raise HTTPException(
            status_code=400,
            detail=(
                "Drift matching can only be performed "
                "for a CONFIRMED detection."
            )
        )

    detection.latitude = request.latitude
    detection.longitude = request.longitude

    detection.last_seen = datetime.utcnow()

    detection.missed_cycles = 0

    previous_detections = db.query(Detection).filter(

        Detection.id != detection.id,

        Detection.class_name ==
        detection.class_name,

        Detection.latitude.isnot(None),

        Detection.longitude.isnot(None)

    ).order_by(
        Detection.created_at.desc()
    ).all()

    if not previous_detections:

        db.commit()

        return {

            "success": True,

            "match_found": False,

            "detection_id":
                detection.id,

            "status":
                detection.status,

            "message":
                "No previous GPS detection available "
                "for drift matching."
        }

    nearest_detection = None

    nearest_distance = float("inf")

    nearest_bearing = None

    for previous in previous_detections:

        distance, bearing = (
            calculate_distance_and_bearing(

                previous.latitude,
                previous.longitude,

                request.latitude,
                request.longitude
            )
        )

        if distance < nearest_distance:

            nearest_distance = distance

            nearest_detection = previous

            nearest_bearing = bearing

    if nearest_distance <= request.radius_m:

        new_status = "STATIONARY"

    else:

        new_status = "DRIFTING"

    detection.status = new_status

    detection.updated_at = datetime.utcnow()

    db.commit()

    db.refresh(detection)

    return {

        "success": True,

        "match_found": True,

        "detection_id":
            detection.id,

        "matched_detection_id":
            nearest_detection.id,

        "class":
            detection.class_name,

        "distance_m":
            round(nearest_distance, 2),

        "bearing_degrees":
            round(nearest_bearing, 2),

        "drift_radius_m":
            request.radius_m,

        "status":
            detection.status,

        "message": (

            "Object is within drift radius. "
            "Marked as STATIONARY."

            if new_status == "STATIONARY"

            else

            "Object moved beyond drift radius. "
            "Marked as DRIFTING."
        )
    }


# =========================================================
# MARK DETECTION AS SEEN
# =========================================================

@app.post("/detections/{detection_id}/seen")
def mark_detection_seen(
    detection_id: int,
    db: Session = Depends(get_db)
):

    detection = db.query(Detection).filter(
        Detection.id == detection_id
    ).first()

    if not detection:

        raise HTTPException(
            status_code=404,
            detail="Detection not found."
        )

    detection.missed_cycles = 0

    detection.last_seen = datetime.utcnow()

    # Do not automatically change MISSING
    # back to CONFIRMED.
    #
    # The lifecycle status remains unchanged.

    detection.updated_at = datetime.utcnow()

    db.commit()

    db.refresh(detection)

    return {

        "success": True,

        "detection_id":
            detection.id,

        "status":
            detection.status,

        "missed_cycles":
            detection.missed_cycles,

        "last_seen":
            detection.last_seen
    }


# =========================================================
# RESOLVE DETECTION API
# =========================================================

@app.post("/detections/{detection_id}/resolve")
def resolve_detection(
    detection_id: int,
    request: ResolveRequest,
    db: Session = Depends(get_db)
):

    detection = db.query(Detection).filter(
        Detection.id == detection_id
    ).first()

    if not detection:

        raise HTTPException(
            status_code=404,
            detail="Detection not found."
        )

    allowed_statuses = {
        "STATIONARY",
        "DRIFTING",
        "MISSING"
    }

    if detection.status not in allowed_statuses:

        raise HTTPException(
            status_code=400,
            detail=(
                f"Detection with status "
                f"{detection.status} cannot be resolved."
            )
        )

    reason = request.reason.upper().strip()

    allowed_reasons = {
        "PICKED_UP",
        "DRIFTED_OUT_OF_RANGE",
        "UNKNOWN"
    }

    if reason not in allowed_reasons:

        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid resolution reason. "
                "Allowed reasons are: "
                "PICKED_UP, "
                "DRIFTED_OUT_OF_RANGE, "
                "UNKNOWN."
            )
        )

    previous_status = detection.status

    detection.status = "RESOLVED"

    detection.updated_at = datetime.utcnow()

    db.commit()

    db.refresh(detection)

    return {

        "success": True,

        "detection_id":
            detection.id,

        "previous_status":
            previous_status,

        "status":
            detection.status,

        "resolution_reason":
            reason,

        "resolved_at":
            detection.updated_at,

        "message":
            "Detection successfully resolved."
    }


# =========================================================
# DETECTION REPORT API
# =========================================================

@app.get("/detections/report")
def get_detection_report(
    db: Session = Depends(get_db)
):

    detections = db.query(
        Detection
    ).order_by(
        Detection.created_at.desc()
    ).all()

    report = []

    for detection in detections:

        report.append({

            "detection_id":
                detection.id,

            "class":
                detection.class_name,

            "confidence":
                detection.confidence,

            "latitude":
                detection.latitude,

            "longitude":
                detection.longitude,

            "dimensions":
                detection.dimensions,

            "survey_id":
                detection.survey_id,

            "status":
                detection.status,

            "missed_cycles":
                detection.missed_cycles,

            "last_seen":
                detection.last_seen,

            "created_at":
                detection.created_at,

            "updated_at":
                detection.updated_at
        })

    return {

        "success": True,

        "total_detections":
            len(report),

        "detections":
            report
    }


# =========================================================
# PREDICTION API
# =========================================================

@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):

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

    file_id = str(uuid.uuid4())

    original_filename = (
        f"{file_id}_{file.filename}"
    )

    file_path = (
        UPLOAD_DIR / original_filename
    )

    try:

        with open(file_path, "wb") as buffer:

            shutil.copyfileobj(
                file.file,
                buffer
            )

    except Exception:

        raise HTTPException(
            status_code=500,
            detail="Failed to save uploaded file."
        )

    # -----------------------------------------------------
    # Resolve geotag (real EXIF -> real NOAA wreck coords ->
    # Thunder Bay dummy fallback). Always returns a value --
    # no more "geotag is None" case to guard against below.
    # -----------------------------------------------------

    geotag_result = resolve_geotag(
        file_path=str(file_path),
        filename=file.filename
    )

    geotag = {
        "latitude": geotag_result["latitude"],
        "longitude": geotag_result["longitude"]
    }

    geotag_source = geotag_result["source"]  # "real_exif" | "real_noaa" | "simulated"

    # -----------------------------------------------------
    # Get image dimensions
    # -----------------------------------------------------

    try:

        with Image.open(file_path) as img:

            img_width, img_height = img.size

    except Exception:

        img_width = None
        img_height = None

    # -----------------------------------------------------
    # YOLO detection
    # -----------------------------------------------------

    try:

        results = detect(
            str(file_path)
        )

    except Exception as e:

        raise HTTPException(
            status_code=500,
            detail=f"Detection failed: {str(e)}"
        )

    detections = []

    saved_detection_ids = []

    result_filename = (
        f"{file_id}_annotated.jpg"
    )

    result_path = (
        RESULT_DIR / result_filename
    )

    for result in results:

        annotated_image = result.plot()

        cv2.imwrite(
            str(result_path),
            annotated_image
        )

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

            class_name = (
                result.names[class_id]
            )

            confidence_value = round(
                confidence,
                4
            )

            bbox_width = round(
                x2 - x1,
                2
            )

            bbox_height = round(
                y2 - y1,
                2
            )

            # -------------------------------------------------
            # Save detection in database
            # -------------------------------------------------

            db_detection = Detection(

                class_name=class_name,

                confidence=confidence_value,

                latitude=geotag["latitude"],

                longitude=geotag["longitude"],

                dimensions=(
                    f"{bbox_width} x "
                    f"{bbox_height} px"
                ),

                survey_id=file_id,

                status="NEW",

                missed_cycles=0,

                last_seen=datetime.utcnow()
            )

            db.add(
                db_detection
            )

            db.flush()

            saved_detection_ids.append(
                db_detection.id
            )

            detections.append({

                "class":
                    class_name,

                "confidence":
                    confidence_value,

                "bbox": [

                    round(x1, 2),
                    round(y1, 2),
                    round(x2, 2),
                    round(y2, 2)

                ],

                "detection_id":
                    db_detection.id,

                "status":
                    db_detection.status
            })

    # -----------------------------------------------------
    # Commit database
    # -----------------------------------------------------

    try:

        db.commit()

    except Exception as e:

        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=(
                "Failed to save detections "
                f"to database: {str(e)}"
            )
        )

    # -----------------------------------------------------
    # Interpretation
    # -----------------------------------------------------

    interpretation = {

        "image_id":
            file_id,

        "geotag":
            geotag,

        "geotag_source":
            geotag_source,

        "detection_count":
            len(detections),

        "detections":
            detections,

        "status": (

            "debris_detected"

            if len(detections) > 0

            else

            "no_debris_detected"
        )
    }

    interpretation_filename = (
        f"{file_id}_interpretation.json"
    )

    interpretation_path = (
        RESULT_DIR /
        interpretation_filename
    )

    with open(
        interpretation_path,
        "w"
    ) as f:

        json.dump(
            interpretation,
            f,
            indent=2
        )

    # -----------------------------------------------------
    # API response
    # -----------------------------------------------------

    return {

        "success":
            True,

        "original_image":
            f"/uploads/{original_filename}",

        "annotated_image":
            f"/results/{result_filename}",

        "interpretation":
            interpretation,

        "interpretation_file":
            f"/results/{interpretation_filename}",

        "detections":
            detections,

        "saved_detection_ids":
            saved_detection_ids,

        "geotag": {

            "lat":
                geotag["latitude"],

            "lng":
                geotag["longitude"]
        },

        "geotag_source":
            geotag_source,

        "image_width":
            img_width,

        "image_height":
            img_height
    }


# =========================================================
# RESULT FILE
# =========================================================

@app.get("/results/{filename}")
def get_result_file(
    filename: str
):

    file_path = (
        RESULT_DIR / filename
    )

    if not file_path.exists():

        raise HTTPException(
            status_code=404,
            detail="File not found."
        )

    return FileResponse(
        file_path
    )


# =========================================================
# ORIGINAL IMAGE
# =========================================================

@app.get("/uploads/{filename}")
def get_original_image(
    filename: str
):

    file_path = (
        UPLOAD_DIR / filename
    )

    if not file_path.exists():

        raise HTTPException(
            status_code=404,
            detail="Original image not found."
        )

    return FileResponse(
        file_path
    )