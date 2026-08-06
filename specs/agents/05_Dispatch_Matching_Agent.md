# Dispatch / Matching Agent Specification

## Overview
**Tagline:** Finds the right worker, not just the nearest one.

This agent acts like a ride-hailing dispatcher. It looks at the pool of available waste management workers, their current locations, their capacity (vehicle type), and the priority of tasks to make optimal assignments.

## Inputs
- Priority package & Resource requirements for the task
- Live worker locations
- Worker capacity, current workload, and shift schedule

## Responsibilities
1. **Candidate Filtering:** Filter workers who have the right vehicle, tools, and team size.
2. **Optimization:** Calculate the most efficient assignment based on distance, current route, and task priority.
3. **Route Planning:** Optimize the worker's route if they are assigned multiple nearby tasks.

## Outputs
- Assignment proposal:
  ```json
  {
    "assigned_worker_id": "uuid",
    "estimated_time_of_arrival": "timestamp",
    "optimized_route_update": ["task_id_1", "task_id_2"]
  }
  ```

## Technical Implementation Details
- **Trigger:** Triggered when a task enters the "ready for dispatch" queue.
- **Suggested Tech:** Graph algorithms for routing, potentially integrating with map APIs (Google Maps, Mapbox) for real-time traffic and distance matrix calculations.
