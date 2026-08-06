# SwachhLens: Agentic AI Waste Response System
## Architecture & Data Flow Specification

### 1. Introduction
SwachhLens is designed as a multi-agent system where discrete, narrowly-scoped AI agents handle specific stages of the waste complaint lifecycle. This document outlines the end-to-end flow and how these agents interact within a web-based ecosystem.

### 2. End-to-End Flow
1. **Intake:** Citizen uploads photo/video + GPS via the Web UI (Intake Agent).
2. **Analysis:** The image is passed to the Vision Analysis Agent to extract waste category, volume, and hazards.
3. **Correlation:** The Duplicate/Correlation Agent checks if this is a new issue or part of an existing cluster.
4. **Planning:** Priority & Resource Planning Agent assigns a severity score and determines necessary resources (team, vehicle).
5. **Dispatching:** Dispatch/Matching Agent finds the most suitable worker based on location and capacity.
6. **Approval:** The Approval Agent auto-approves low-risk dispatches and routes high-risk ones to the dashboard for human review.
7. **Notification:** The Scheduling & Notification Agent informs the worker and the citizen.
8. **Execution & Verification:** Worker completes the job, uploads a photo. The Verification Agent compares before/after photos.
9. **Learning:** Feedback & Learning Agent aggregates data for model retraining and updates worker/citizen scores.
10. **Oversight:** The Escalation Agent continuously monitors for SLA breaches.

### 3. Technology Stack (Web Focus)
- **Frontend (Citizen & Dashboard):** React/Vite, TailwindCSS.
- **Backend Orchestration:** Node.js / Express or FastAPI, coordinating agent handoffs.
- **Database:** PostgreSQL with PostGIS for spatial queries.
- **AI Models:** Vision models (YOLO, Gemini Vision, GPT-4V) for analysis.
- **Storage:** S3 or equivalent object storage.
