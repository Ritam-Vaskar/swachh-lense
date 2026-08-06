# Verification Agent Specification

## Overview
**Tagline:** Confirms the job was actually done properly.

When a worker marks a job as "done" and uploads an "after" photo, this agent compares it to the original "before" photo to verify that the waste was actually cleared.

## Inputs
- Original "before" photo
- Worker's submitted "after" photo
- Task details

## Responsibilities
1. **Image Comparison:** Analyze the before and after images to detect the absence of the previously identified waste.
2. **Completion Scoring:** Generate a score indicating how thoroughly the area was cleaned.
3. **Action:**
   - High score: Mark task as `completed`.
   - Low score: Flag for human review or auto-reopen the task, alerting the worker that the job is insufficient.

## Outputs
- Verification result:
  ```json
  {
    "completion_score": "float (0.0-1.0)",
    "status": "verified_complete" // or 'rejected'
  }
  ```

## Technical Implementation Details
- **Trigger:** Worker submits proof of completion.
- **Suggested Tech:** Image segmentation models to diff the area, or a vision-language model (like GPT-4V/Gemini) asked to compare the two scenes.
