# Priority & Resource Planning Agent Specification

## Overview
**Tagline:** Decides how urgent this is and what response it needs.

Based on what the Vision Agent saw and the geographic context, this agent determines how fast the cleanup needs to happen and what resources (people, tools, vehicles) are required.

## Inputs
- Vision output (category, volume, hazards)
- Location sensitivity data (e.g., proximity to schools, hospitals, water bodies)
- Complaint age / duplicate count (from Correlation Agent)

## Responsibilities
1. **Priority Scoring:** Calculate a priority score using a transparent formula. For example, a large volume of hazardous waste near a school gets a top score.
2. **Resource Allocation Planning:** Determine:
   - Team size required (e.g., 1 person vs. 4 people).
   - Tools and PPE required (e.g., gloves, shovels, hazmat suits).
   - Vehicle type required (e.g., pushcart, small truck, compactor).

## Outputs
- Priority package appended to the ticket:
  ```json
  {
    "priority_score": "int (1-100)",
    "recommended_team_size": "int",
    "tools_required": ["string"],
    "vehicle_type": "string"
  }
  ```

## Technical Implementation Details
- **Trigger:** Runs after the ticket is finalized by the Correlation Agent.
- **Logic:** Rule-based engine or a simple decision tree model. The formula should be explainable so municipalities can audit the decisions.
