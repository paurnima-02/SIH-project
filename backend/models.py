from sqlalchemy import Column, Integer, String, Float, DateTime
from datetime import datetime

from database import Base


class Detection(Base):
    __tablename__ = "detections"

    id = Column(Integer, primary_key=True, index=True)

    class_name = Column(String, nullable=False)
    confidence = Column(Float, nullable=False)

    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)

    dimensions = Column(String, nullable=True)

    survey_id = Column(String, nullable=True)

    status = Column(
        String,
        default="NEW",
        nullable=False
    )

    missed_cycles = Column(
        Integer,
        default=0,
        nullable=False
    )

    last_seen = Column(
        DateTime,
        default=datetime.utcnow
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow
    )

    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )