# Feedback & Learning Agent Specification

## Overview
**Tagline:** Turns every completed job into training data.

This agent gathers post-completion data to create a self-improving system. It collects citizen feedback and worker performance metrics, which are then used to build a proprietary dataset and adjust future routing.

## Inputs
- Completed task data (before/after photos)
- Citizen confirmation/rating (if they engage)
- Worker performance stats (time taken vs. estimated)

## Responsibilities
1. **Data Aggregation:** Pair the before/after images with the vision AI's initial predictions to create ground-truth training pairs.
2. **Performance Tracking:** Update worker ratings (speed, reliability).
3. **Civic Gamification:** Update citizen profiles with points or badges for successful, verified reports.

## Outputs
- Updates to worker profiles and citizen profiles.
- Formatted data entries appended to a machine learning pipeline bucket (S3) for future model retraining.

## Technical Implementation Details
- **Trigger:** Runs after a task is verified and closed.
- **Value:** This creates the "proprietary data moat" mentioned in the architecture plan.
