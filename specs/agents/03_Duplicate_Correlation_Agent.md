# Duplicate / Correlation Agent Specification

## Overview
**Tagline:** Prevents duplicate tickets from flooding the system.

Multiple citizens might report the same overflowing bin or dump site. This agent analyzes new
reports against existing open reports to group duplicates, preventing redundant dispatches and
instead using the duplicates to boost the priority of the original issue.

## Inputs
- New complaint record (GPS coordinates, zone, category, `ai_analysis` JSONB, `image_url`)
- `media_uploads` table (full image data-URLs for visual comparison)
- Active / open complaints database

## Multi-Signal Scoring Pipeline

Every candidate within **150 metres** of the new report is scored on three independent signals,
then combined into a **weighted composite score** (threshold ≥ 0.60 → duplicate).

| Signal | Weight | How it works |
|---|---|---|
| **GPS Proximity** | 35 % | Haversine distance — score = `1 – dist / 150m` (linear decay) |
| **AI Semantic Similarity** | 30 % | Compares stored `ai_analysis` JSONB: same category (+0.40), same volume (+0.20), same hazard flag (+0.15), severity difference ≤10 (+0.15), same priority (+0.10) |
| **Gemini Visual Comparison** | 35 % | Sends both report images to Gemini 2.0 Flash; Gemini judges whether they show the **same physical waste site** and returns a `similarity_score` [0–1] |

If Gemini visual comparison is unavailable (no API key / no images), its weight is redistributed
proportionally to GPS + Semantic so the system degrades gracefully.

## Responsibilities
1. **Spatial Filtering:** Find all open complaints within 150 m of the new complaint (same category).
2. **Semantic Similarity:** Compare Vision Agent AI analysis results (category, volume, hazard, severity, priority) without extra API calls.
3. **Visual Correlation:** When both reports have images and `GEMINI_API_KEY` is set, send both images to Gemini 2.0 Flash to confirm they depict the same physical waste site.
4. **Zone Fallback:** If no GPS is available (or GPS produces no matches), fall back to same category + zone + 12-hour window with semantic + visual confirmation (threshold ≥ 0.55).
5. **Merge or Create:** Composite score ≥ threshold → merge into parent; otherwise create a unique new ticket.

## Outputs
- **If Duplicate:** Merged complaint record with an incremented `duplicate_count` (boosting priority).
- **If Unique:** A finalized, unique new ticket forwarded to the Priority Agent.

## Technical Implementation Details
- **Trigger:** Runs immediately after the Vision Analysis Agent.
- **GPS Radius:** 150 m (configurable via `GPS_RADIUS_M`).
- **Duplicate Threshold:** 0.60 composite score (configurable via `DUPLICATE_THRESHOLD`).
- **Zone Fallback Threshold:** 0.55 combined semantic + visual score.
- **Visual Resize:** Images are down-sampled to max 512×512 JPEG at q=65 before sending to Gemini to minimise token cost.
- **Graceful Degradation:** Visual signal is optional — if unavailable, its weight shifts to GPS + Semantic automatically.
- **Models used:**
  - `gemini-2.0-flash` for two-image visual comparison
  - `sharp` for server-side image resize
