# Duplicate / Correlation Agent Specification

## Overview
**Tagline:** Prevents duplicate tickets from flooding the system.

Multiple citizens might report the same overflowing bin or dump site. This agent analyzes new reports against existing open reports to group duplicates, preventing redundant dispatches and instead using the duplicates to boost the priority of the original issue.

## Inputs
- New complaint record (including GPS and time)
- Vision analysis output (for image similarity)
- Active/Open complaints database

## Responsibilities
1. **Spatial Filtering:** Find all open complaints within a certain radius (e.g., 50 meters) of the new complaint.
2. **Temporal Filtering:** Consider the time window of the existing complaints.
3. **Visual Correlation:** (Optional/Advanced) Compare the image embeddings of the new complaint against nearby open complaints to confirm they depict the same pile of waste.
4. **Merge or Create:** Decide whether to append the new report to an existing ticket or create a distinct new ticket.

## Outputs
- **If Duplicate:** Merged complaint record with an incremented "report count" (boosting priority).
- **If Unique:** A finalized, unique new ticket.

## Technical Implementation Details
- **Trigger:** Runs immediately after the Vision Analysis Agent.
- **Suggested Tech:** 
  - PostGIS for rapid spatial queries (`ST_DWithin`).
  - Perceptual hashing (e.g., pHash) or CLIP embeddings for image similarity comparison.
