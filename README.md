# TrackAccess Optimiser

Decision support for railway track possession planning on a dual-line network.
Upload the eight published instance CSVs, pick a scenario, and the scheduler
places every activity, validates the hard constraints, and returns judge-ready
output files.

---

## Running it

Requires Node 22+ and pnpm 10+.

```bash
pnpm install
pnpm run typecheck                       # whole workspace
PORT=5000 BASE_PATH=/ pnpm -r --if-present run build
PORT=5000 node artifacts/api-server/dist/index.mjs
```

Then open <http://localhost:5000>. The API server serves the built UI and the
API from the same port, so there is nothing else to start.

For development with hot reload, run the two halves separately:

```bash
PORT=5000 pnpm --filter @workspace/api-server run dev     # API on :5000
PORT=5173 pnpm --filter trackaccess-optimiser run dev     # UI on :5173, proxies /api -> :5000
```

Open <http://localhost:5173> (not :5000) while both are running — that's the
UI dev server, and its Vite proxy forwards `/api/*` requests to the API
server. If your API server runs on a port other than 5000, set `API_PORT` for
the UI process too, e.g. `API_PORT=6000 PORT=5173 pnpm --filter trackaccess-optimiser run dev`.

A sample instance is in `sample-instance/`. Upload all eight CSVs at once, or
press **Load demo instance** for a small built-in example.

### Offline copy

`standalone/trackaccess-optimiser.html` is a single self-contained page with the
results for all three scenarios already baked in. Open it in any browser — no
server, no install. Useful for sharing a result with someone who will not run
the stack.

---

## Scenarios

The three plans schedule the same workload and differ only in which relief valve
they are permitted to pull when a contract cannot fit.

| Scenario | Finish late | ECLO night | Breach supply |
|---|---|---|---|
| **A** strict supply | allowed | never | never |
| **B** strict dates | hard violation | allowed | allowed and soft-scored |
| **C** balanced | allowed | allowed in one two-week window per line | one excess access-night per location-week |

An **ECLO** (extended call-out) extends an otherwise permitted access night. It
delivers 1.5 work units, while a standard night delivers 1.0; it does not create
an additional weekly access-night.

---

## How the metrics are calculated

```
Score A = OverrunPenalty
Score B = 7 × SupplyBreaches + 5 × ECLOnights
Score C = OverrunPenalty + 7 × SupplyBreaches + 5 × ECLOnights

OverrunPenalty = Σ over contracts  W(contract_priority) × (1 + nudge) × overrun_days
                 W     = { P1:100, P2:10, P3:1 }
                 nudge = mean activity-priority bonus { P1:0.3, P2:0.2, P3:0 }

overrun_days   = max(0, last_access_date − planned_completion_date)

utilisation    = occupied sector-nights ÷ (Σ supply_capacity × 7 × weeks)
```

Lower is better; zero means nothing was sacrificed. Because every relief valve
carries a price, the three scenarios are directly comparable.

The running app shows each of these formulas filled in with the live figures
under **How the numbers are worked out**.

---

## Scheduling rules enforced

- Every activity receives its full access count; nothing is dropped.
- Location supply is respected on each sector on each **night**.
- Access types: `PM` exclusive, `PC` cannot share with another `PC`, `C` shares
  up to capacity.
- Buffer sectors from `05_BUFFER_LOCATION.csv` are held either side of the
  worksite, mirrored to the opposite bound when required.
- Predecessor activities finish before their successors start.
- No access is placed before its planned start date.
- The per-contract weekly access cap is applied.

---

## Fixes applied to the scheduling engine

The original engine had nine defects that made the output metrics unreliable.

1. **Capacity was pooled per location-week rather than per location-night**, so
   two crews on the same sector on different nights counted as a clash. This one
   error produced hundreds of phantom overrun days.
2. **The priority score counted overrun only.** Any plan that held its dates
   scored zero no matter how badly it overloaded the track, which made Scenario A
   and Scenario B incomparable.
3. **Scenario C had no code path** and was byte-identical to Scenario B.
4. **The weekly access cap was never enforced** — `usedNights` was written and
   never read.
5. **Buffer sectors were parsed and never used**, despite the UI claiming they
   were held.
6. **Predecessors were silently dropped** when they sorted after their successor.
   Activities are now ordered topologically.
7. **Completion was dated to the Sunday of the final week**, adding up to six
   phantom overrun days per contract. It now uses the actual last access date.
8. **The ECLO rule was degenerate**, firing only within two weeks of the first
   late placement on a line and otherwise never.
9. **`capacity_utilisation` was structurally ≥ 100%** and always clamped, because
   it divided occupancy rows by occupied location-weeks.

Also fixed: an ECLO night counted as 1.5 accesses (an access is one access), and
`chosen.excess` was computed then discarded.

### A note on this instance

With capacity correctly modelled per night, the supplied instance is
**under-constrained**: capacity used is about 0.9%, every contract has slack
against its deadline, and all three scenarios reach the same zero-cost optimum.
That is the correct answer, not a bug — the earlier 329 overrun days were an
artefact of defect 1.

The scenarios diverge as soon as the instance is squeezed:

| Weekly cap / supply | A | B | C |
|---|---|---|---|
| 3 per week, full supply (as supplied) | 0 | 0 | 0 |
| 2 per week, full supply | 14.3 | 160 | 141.2 |
| 1 per week, full supply | 1818.1 | 520 | 448.4 |
| 1 per week, quarter supply | 11906 | 1020 | 965.3 |

---

## Output files

Three CSVs per scenario, downloadable from the toolbar:

| File | Columns |
|---|---|
| `SCHEDULE_ACCESS_<S>.csv` | activity_id, access_seq, week, eclo, access_night |
| `SCHEDULE_OCCUPANCY_<S>.csv` | activity_id, week, location_id, co_share_group |
| `RESULTS_<S>.csv` | scenario, contract_number, simulated_completion_date, overrun_days |

Pre-generated copies for all three scenarios are in `output-csvs/`.

---

## Layout

```
artifacts/api-server              Express 5 API, scheduling engine, static host
  src/scheduler/engine.ts         the scheduler and all metric calculations
  src/scheduler/csv.ts            instance loading
artifacts/trackaccess-optimiser   React + Vite UI
lib/api-spec/openapi.yaml         source of truth for the API contract
lib/api-zod, lib/api-client-react generated from the spec via `pnpm --filter @workspace/api-spec run codegen`
sample-instance/                  the eight instance CSVs
output-csvs/                      pre-generated judge output
standalone/                       self-contained offline build
```

After editing `openapi.yaml`, regenerate the client and schemas:

```bash
pnpm --filter @workspace/api-spec run codegen
```
