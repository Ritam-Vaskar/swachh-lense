# Vision Analysis Agent Specification

## Overview
**Tagline:** The core AI brain — reads the image and understands the problem.

This agent is the primary AI workhorse. It processes the validated images/videos from the Intake Agent to extract structured operational data. It identifies what the waste is, how much there is, and if there are any immediate dangers.

## Inputs
- Uploaded image/video URL(s)
- Complaint ID

## Responsibilities
1. **Waste Categorization:** Classify the type of waste (e.g., organic, plastic, construction debris, hazardous, electronic).
2. **Volume Estimation:** Estimate the scale/volume of the waste to determine resource requirements (e.g., small bin, pickup truck, heavy machinery).
3. **Hazard Detection:** Flag dangerous materials (e.g., medical waste, chemicals, sharp objects) or proximity to sensitive areas.
4. **Confidence Scoring:** Provide a confidence score for its predictions to determine if human review is needed.

## Outputs
- Structured AI analysis results:
  ```json
  {
    "category": "string (e.g., 'mixed_municipal', 'construction_debris')",
    "severity_score": "int (1-10)",
    "volume_bucket": "string (e.g., 'small', 'medium', 'large')",
    "hazard_flag": "boolean",
    "confidence": "float (0.0-1.0)"
  }
  ```

## Technical Implementation Details
- **Trigger:** Receives a message/event when the Intake Agent completes validation and storage.
- **Suggested Tech:** YOLOv8-cls / MobileNetV3 for classification. YOLOv8-seg or SAM (Segment Anything Model) for volume/area estimation. Can also leverage foundational VLM models like Gemini 1.5 Pro.
