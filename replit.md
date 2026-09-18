# TrackAccess Optimiser

TrackAccess Optimiser generates and explains railway track possession schedules from the published dual-line CSV instance files.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/trackaccess-optimiser run typecheck` — frontend typecheck
- `pnpm --filter @workspace/api-server run typecheck` — scheduler/API typecheck

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite
- API: Express 5
- Scheduling: in-memory constraint-aware heuristic; no database is required for an upload/run
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/trackaccess-optimiser/src/App.tsx` — dashboard, upload flow, scenario selector, timeline, contract and activity views
- `artifacts/trackaccess-optimiser/src/index.css` — dark control-room visual system and responsive layout
- `artifacts/api-server/src/scheduler/csv.ts` — published CSV and bundled snapshot parsing
- `artifacts/api-server/src/scheduler/engine.ts` — scheduling heuristic, timeline aggregation, and hard-gate checks
- `artifacts/api-server/src/routes/schedule.ts` — `POST /api/schedules`
- `lib/api-spec/openapi.yaml` — source of truth for the schedule API contract

## Architecture decisions

- The browser uploads CSV contents as text; the API accepts either the eight individual files or a bundled snapshot.
- Scheduling is scenario-aware: Scenario A enforces nominal location capacity and forbids ECLO, while B/C allow elastic access and ECLO trade-offs.
- The API returns both judge-format rows (`access_rows` and `occupancy_rows`) and presentation-ready week/day aggregates so the UI does not reimplement scheduling logic.
- Dates are stored as ISO strings at the API boundary, and access night remains a local 1..N index per contract and activity type as required by the validator.

## Product

- Upload an instance and select Scenario A, B, or C.
- Generate a complete schedule with workload, completion, overrun, capacity, and ECLO metrics.
- Inspect weekly schedules broken into individual nights, validator findings, contract completion, and all activity placements.
- Download the three judge files: `SCHEDULE_ACCESS_<scenario>.csv`, `SCHEDULE_OCCUPANCY_<scenario>.csv`, and `RESULTS_<scenario>.csv`.

## Gotchas

- A bundled input must contain the published section markers `01_LINES.csv` through `08_ACTIVITY_DETAILS.csv`.
- The API body limit is intentionally above the sample size because a full bundled snapshot is uploaded as one JSON string.
- The scheduler is designed to keep all activities in the plan; a future solver improvement should preserve the complete-workload invariant before optimizing score.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
