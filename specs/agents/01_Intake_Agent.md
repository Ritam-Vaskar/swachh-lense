# Intake Agent Specification

## Overview
**Tagline:** Captures the complaint at the source, cleanly and automatically.

The Intake Agent acts as the entry point for citizen reports. It receives raw submissions (via a web interface, as we are shifting from app to web), validates the data, and prepares it for the downstream pipeline.

## Inputs
- Citizen photo/video of the waste
- GPS location (auto-fetched)
- Timestamp (auto-fetched)
- Optional text/voice comment

## Responsibilities
1. **Data Collection:** Receive multipart form data containing image/video, geolocation coordinates, and comments.
2. **Pre-processing/Validation:** 
    - Check if the image/video is valid (e.g., not blurred, not too dark, relevant). 
    - Ensure GPS data is present and within the operational boundary.
3. **Record Creation:** Format the raw input into a standardized complaint record.

## Outputs
- A validated complaint record (JSON format).
- Rejection notification (if the submission fails validation).

## Technical Implementation Details
- **Trigger:** Citizen submits a form on the web UI.
- **Components:** Web form (React/Vite), Geolocation API, lightweight client-side image validation.
- **Data Schema (Draft):**
  ```json
  {
    "complaintId": "uuid",
    "timestamp": "ISO-8601 string",
    "location": {
      "lat": "float",
      "lng": "float"
    },
    "mediaUrls": ["string"],
    "comments": "string",
    "status": "intake_validated"
  }
  ```
