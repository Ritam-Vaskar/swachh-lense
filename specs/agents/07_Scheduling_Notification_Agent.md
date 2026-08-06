# Scheduling & Notification Agent Specification

## Overview
**Tagline:** Closes the communication loop on both sides.

Once a task is approved (automatically or manually), this agent handles all the outbound communications to keep both the assigned worker and the reporting citizen informed.

## Inputs
- Approved task details
- Assigned worker details
- Citizen contact info (if provided/applicable)

## Responsibilities
1. **Worker Notification:** Send a "task card" to the worker's interface (web/app), including location, photos, required tools, and navigation links.
2. **Citizen Notification:** Send an update to the citizen (e.g., "Your report has been verified and a team is on the way").

## Outputs
- Delivered notifications (Push, SMS, or In-App/Web).
- Updated task status: `dispatched`.

## Technical Implementation Details
- **Trigger:** Runs upon task approval.
- **Suggested Tech:** Firebase Cloud Messaging (FCM), Twilio (for SMS), or simple WebSockets/Server-Sent Events for live dashboard updates.
