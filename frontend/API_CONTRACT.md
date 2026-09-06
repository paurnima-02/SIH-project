# AquaScan frontend ↔ backend contract

The frontend is ready to call a FastAPI prediction endpoint.

## Request

`POST {VITE_API_URL}{VITE_PREDICT_ENDPOINT}`

Content type: `multipart/form-data`

Field:

- `file`: the uploaded sonar image (`File`)

Do not require the frontend to manually set the multipart boundary; `fetch()` handles it.

## Recommended response

```json
{
  "detections": [
    {
      "id": "D-0001",
      "class": "Bottle",
      "confidence": 0.92,
      "bbox": [120, 80, 250, 300],
      "depth": 48
    }
  ],
  "geotag": {
    "lat": 19.076,
    "lng": 72.8777
  },
  "image_width": 1280,
  "image_height": 720
}
```

### Notes

- `confidence` may be `0–1` or `0–100`; the frontend accepts both.
- `bbox` should preferably be `[x, y, width, height]` in image pixels.
- `image_width` and `image_height` let the frontend convert pixel boxes into dashboard percentages.
- `lat`/`lng` may be supplied per detection. If omitted, the image-level `geotag` is applied to every detection.
- `depth` and `dimensions` are optional; the frontend shows `0`/`—` when absent.
- The frontend maps arbitrary model labels into its current UI categories (`ghost_net`, `shipwreck`, `pipe`, `unknown`). This is a UI compatibility layer, not a claim that the model only detects those classes.

## CORS

For local development, FastAPI should allow the Vite origin (normally `http://localhost:5173`).

## Frontend environment

Copy `.env.example` to `.env` and change the values if needed.
