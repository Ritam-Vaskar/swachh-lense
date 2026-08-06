# Approval Agent Specification

## Overview
**Tagline:** Decides which tasks need a human's sign-off.

To ensure autonomy doesn't lead to costly mistakes, this agent acts as a gatekeeper. It auto-approves routine cleanups but flags high-risk, high-cost, or low-confidence tasks for a human administrator to review on the dashboard.

## Inputs
- Dispatch assignment
- Task priority and estimated cost
- Hazard flags
- AI Vision confidence score

## Responsibilities
1. **Threshold Evaluation:** Compare the task's parameters against predefined (or learned) thresholds for auto-approval.
2. **Routing:**
   - If confidence is high, cost is low, and no hazards are present -> Auto-Approve.
   - If confidence is low, or it's a massive cleanup, or hazards are flagged -> Route to human dashboard.

## Outputs
- Status update: `auto_approved` OR `pending_human_approval`.
- If pending, an alert is sent to the municipality dashboard.

## Technical Implementation Details
- **Trigger:** Runs after the Dispatch Agent proposes an assignment.
- **Learning Loop:** As human admins approve or reject flagged tasks, this agent should theoretically adjust its thresholds over time (Agentic behavior).
