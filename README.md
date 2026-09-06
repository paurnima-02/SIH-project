   *AquaScan — Marine Debris Detection via Side-Scan Sonar*
Smart India Hackathon 2026 | PS Number: SIH26057

An end-to-end AI pipeline that automatically detects man-made debris (ghost fishing nets, shipwrecks, pipes, entangled gear) in Side-Scan Sonar (SSS) imagery — turning thousands of kilometers of manually-reviewed sonar logs into an automated, geotagged, confidence-scored detection report

*Problem Statement*

Ghost nets and other abandoned marine debris continuously trap marine life, destroy coral reefs, and damage vessels. Conservationists use towed Side-Scan Sonar (SSS) to map the seafloor, but manually reviewing sonar logs is slow, tedious, and error-prone — debris easily blends into natural features like rocks, sand ripples, and ridges.

Goal: Build a computer-vision pipeline that ingests raw sonar imagery, separates natural seafloor topology from artificial anomalies, and outputs actionable, geotagged reports — efficient enough to run on edge devices / marine drones without heavy cloud dependency.


*Key Features*


🔍 Detection / Segmentation Model — YOLO / Faster R-CNN / U-Net based model that draws bounding boxes or pixel-level masks around man-made objects.
🎯 Confidence Scoring & Noise Filtering — Pre-processing pipeline (speckle reduction, TVG correction) that suppresses false positives from natural acoustic shadows and rock clusters, and assigns a 0–100% confidence score to every detection.
📍 Geotagging & Reporting Engine — Parses sonar metadata / ping headers to output structured JSON/CSV reports with lat/long, bounding dimensions, and classification for every hazard.
🖥️ Dashboard UI — Upload raw sonar logs, view live AI detections overlaid on the sonar image and on a map, and download anomaly reports.
⚡ Edge-ready — Lightweight/quantized inference designed to run onboard an AUV/marine drone, not just in the cloud.
