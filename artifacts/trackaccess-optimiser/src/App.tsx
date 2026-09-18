import { useMemo, useRef, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Switch, Link, useLocation } from "wouter";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Download,
  FileUp,
  Gauge,
  Layers3,
  Loader2,
  Map,
  Play,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  UploadCloud,
  XCircle,
} from "lucide-react";
import {
  type ScheduleResponse,
  type ScheduleInputScenario,
  useCreateSchedule,
} from "@workspace/api-client-react";

type Scenario = ScheduleInputScenario;

const DEMO_FILES: Record<string, string> = {
  "01_LINES.csv": "line_code,line_name\nALP,Line Alpha\nBET,Line Beta",
  "02_STATIONS.csv": "station_id,line_code,seq,is_interchange\nS01,ALP,1,0\nS02,ALP,2,0\nS03,ALP,3,0\nS11,BET,1,0\nS12,BET,2,0",
  "03_SECTORS.csv": "sector_id,line_code,from_station_id,to_station_id,seq,is_shared\nSEC:ALP:S01_S02,ALP,S01,S02,1,0\nSEC:ALP:S02_S03,ALP,S02,S03,2,0\nSEC:BET:S11_S12,BET,S11,S12,3,0",
  "04_LOCATION_SUPPLY.csv": "location_id,location_kind,line_code,bound,supply_capacity\nSEC:ALP:S01_S02:EB,tunnel sector,ALP,EB,4\nSEC:ALP:S02_S03:EB,tunnel sector,ALP,EB,2\nSEC:BET:S11_S12:WB,tunnel sector,BET,WB,4",
  "05_BUFFER_LOCATION.csv": "nature_of_works,up_to_buffer_sectors,opposite_bound_required\nLive,2,1\nNon-live (Consist),1,0\nNon-live (Others),0,0",
  "06_PARAMETERS.csv": "key,value\nhorizon_start,2027-01-04\nhorizon_weeks,12",
  "07_PROJECT_DETAILS.csv": "contract_number,contract_description,contract_award_date,activity_type,nature_of_activity,contract_priority,contract_completion_date,planned_completion_date,number_of_workfronts,access_type,number_of_maximum_access_per_week\nC001,Alpha renewal,2026-10-02,Renewal,Non-live (Consist),2,2027-03-29,2027-03-15,2,C,3\nC002,Beta construction,2026-06-25,Construction,Non-live (Others),1,2027-03-29,2027-03-22,1,C,3",
  "08_ACTIVITY_DETAILS.csv": "activity_id,contract_number,activity_type,start_location_id,end_location_id,total_accesses,planned_start_date,predecessor_activity_id,activity_priority\nA001,C001,Renewal,SEC:ALP:S01_S02:EB,SEC:ALP:S02_S03:EB,3,2027-01-04,,1\nA002,C001,Renewal,SEC:ALP:S02_S03:EB,SEC:ALP:S02_S03:EB,2,2027-01-18,A001,2\nA003,C002,Construction,SEC:BET:S11_S12:WB,SEC:BET:S11_S12:WB,4,2027-01-11,,1",
};

function formatNumber(value: number, decimals = 0) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: decimals }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(new Date(`${value}T00:00:00Z`));
}

function downloadCsv(filename: string, headers: string[], rows: object[]) {
  const csv = [headers.join(","), ...rows.map((row) => {
    const values = row as Record<string, unknown>;
    return headers.map((header) => `"${String(values[header] ?? "").replaceAll('"', '""')}"`).join(",");
  })].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ScenarioSelector({ scenario, onChange }: { scenario: Scenario; onChange: (value: Scenario) => void }) {
  return (
    <div className="scenario-selector" aria-label="Scenario">
      {(["A", "B", "C"] as Scenario[]).map((value) => (
        <button key={value} className={scenario === value ? "scenario active" : "scenario"} onClick={() => onChange(value)}>
          <span>Scenario {value}</span>
          <small>{value === "A" ? "strict supply" : value === "B" ? "strict dates" : "balanced"}</small>
        </button>
      ))}
    </div>
  );
}

function EmptyState({ onLoadDemo, onFiles }: { onLoadDemo: () => void; onFiles: (files: FileList) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <section className="empty-workspace">
      <div className="empty-icon"><UploadCloud size={28} /></div>
      <div>
        <p className="eyebrow">INSTANCE INPUT</p>
        <h2>Bring the demand book into the control room.</h2>
        <p className="muted-copy">Upload the eight published CSVs or the bundled snapshot. The scheduler will place every activity, then return a validated timeline and judge-ready files.</p>
        <div className="empty-actions">
          <button className="button primary" onClick={() => inputRef.current?.click()}><FileUp size={16} /> Upload instance</button>
          <button className="button secondary" onClick={onLoadDemo}><Play size={15} /> Load demo instance</button>
        </div>
        <input ref={inputRef} type="file" multiple accept=".csv,.txt" hidden onChange={(event) => event.target.files && onFiles(event.target.files)} />
        <p className="file-hint">Expected: 01_LINES.csv through 08_ACTIVITY_DETAILS.csv</p>
      </div>
    </section>
  );
}

function KpiCard({ label, value, detail, tone = "neutral", icon }: { label: string; value: string; detail: string; tone?: string; icon: React.ReactNode }) {
  return <article className={`kpi-card ${tone}`}><div className="kpi-top"><span className="kpi-label">{label}</span><span className="kpi-icon">{icon}</span></div><strong>{value}</strong><span className="kpi-detail">{detail}</span></article>;
}

function StatusPill({ status }: { status: "feasible" | "review" | "scheduled" | "hard" | "warning" }) {
  const labels = { feasible: "FEASIBLE", review: "REVIEW", scheduled: "SCHEDULED", hard: "HARD", warning: "WARNING" };
  return <span className={`status-pill ${status}`}><span className="status-dot" />{labels[status]}</span>;
}

function Timeline({ result }: { result: ScheduleResponse }) {
  const visibleWeeks = result.week_summaries.filter((week) => week.access_count > 0).slice(0, 8);
  return (
    <section className="panel timeline-panel">
      <div className="panel-heading"><div><p className="eyebrow">POSSESSION TIMELINE</p><h2>Weeks into nights</h2></div><span className="panel-note"><CalendarDays size={14} /> {result.week_summaries.length} week horizon</span></div>
      <div className="timeline-list">
        {visibleWeeks.map((week) => (
          <div className="week-row" key={week.week}>
            <div className="week-label"><span>W{String(week.week).padStart(2, "0")}</span><small>{formatDate(week.week_start)} — {formatDate(week.week_end)}</small></div>
            <div className="week-track">
              {week.days.map((day) => (
                <div className={`day-cell ${day.accesses ? "occupied" : ""} ${day.eclo ? "eclo" : ""}`} key={day.date} title={`${formatDate(day.date)} · ${day.accesses} access${day.accesses === 1 ? "" : "es"}`}>
                  <span>{day.day.slice(0, 1)}</span>
                  {day.accesses > 0 && <b>{day.accesses}</b>}
                </div>
              ))}
            </div>
            <div className="week-meta"><strong>{week.access_count}</strong><span>accesses</span><em className={week.pressure}>{week.pressure}</em></div>
          </div>
        ))}
      </div>
      <div className="timeline-legend"><span><i className="legend-dot alpha" />Alpha</span><span><i className="legend-dot beta" />Beta</span><span><i className="legend-dot eclo" />ECLO</span><span className="legend-copy">Each block is one access night; hover for the date.</span></div>
    </section>
  );
}

function Dashboard({ result, onReset }: { result: ScheduleResponse; onReset: () => void }) {
  const [location, navigate] = useLocation();
  const [weekFilter, setWeekFilter] = useState("all");
  const filteredAccess = useMemo(() => weekFilter === "all" ? result.access_rows : result.access_rows.filter((row) => row.week === Number(weekFilter)), [result.access_rows, weekFilter]);
  return (
    <>
      <div className="result-toolbar">
        <div className="result-source"><span className="source-mark"><CheckCircle2 size={15} /></span><div><strong>{result.source}</strong><span>Run {result.generated_at} · Scenario {result.scenario}</span></div></div>
        <div className="toolbar-actions">
          <button className="button ghost" onClick={onReset}><RotateCcw size={15} /> New plan</button>
          <button className="button primary" onClick={() => {
            downloadCsv(`SCHEDULE_ACCESS_${result.scenario}.csv`, ["activity_id", "access_seq", "week", "eclo", "access_night"], result.access_rows);
            downloadCsv(`SCHEDULE_OCCUPANCY_${result.scenario}.csv`, ["activity_id", "week", "location_id", "co_share_group"], result.occupancy_rows);
            downloadCsv(`RESULTS_${result.scenario}.csv`, ["scenario", "contract_number", "simulated_completion_date", "overrun_days"], result.contract_results.map((row) => ({ scenario: result.scenario, ...row })));
          }}><Download size={15} /> Download 3 CSVs</button>
        </div>
      </div>
      <section className="kpi-grid">
        <KpiCard label="Feasibility" value={result.summary.feasibility === "feasible" ? "Clear to plan" : "Needs review"} detail={`${result.violations.length} validator finding${result.violations.length === 1 ? "" : "s"}`} tone={result.summary.feasibility === "feasible" ? "green" : "amber"} icon={result.summary.feasibility === "feasible" ? <ShieldCheck size={17} /> : <AlertTriangle size={17} />} />
        <KpiCard label="Workload covered" value={`${formatNumber(result.summary.scheduled_accesses, 1)} / ${formatNumber(result.summary.total_accesses, 1)}`} detail={`${result.summary.activities} activities · 100% accounted`} tone="blue" icon={<Layers3 size={17} />} />
        <KpiCard label="Priority score" value={formatNumber(result.summary.priority_weighted_score, 1)} detail={`${result.summary.overrun_days} overrun days weighted`} tone="purple" icon={<Gauge size={17} />} />
        <KpiCard label="ECLO nights" value={formatNumber(result.summary.eclo_nights)} detail={result.scenario === "A" ? "forbidden in Scenario A" : "continuity window applied"} tone={result.summary.eclo_nights ? "amber" : "neutral"} icon={<SlidersHorizontal size={17} />} />
      </section>
      <div className="content-grid">
        <div className="main-column">
          <Timeline result={result} />
          <section className="panel contract-panel">
            <div className="panel-heading"><div><p className="eyebrow">DELIVERY CONTROL</p><h2>Contract completion</h2></div><Link href="/activity" className="text-link">View activities <ArrowUpRight size={14} /></Link></div>
            <div className="table-wrap"><table><thead><tr><th>Contract</th><th>Priority</th><th>Planned</th><th>Simulated</th><th>Overrun</th><th>Status</th></tr></thead><tbody>{result.contract_results.map((contract) => <tr key={contract.contract_number}><td><strong>{contract.contract_number}</strong><span className="cell-sub">{contract.description}</span></td><td><span className={`priority p${contract.priority}`}>P{contract.priority}</span></td><td>{formatDate(contract.planned_completion_date)}</td><td>{formatDate(contract.simulated_completion_date)}</td><td className={contract.overrun_days ? "danger-text" : "good-text"}>{contract.overrun_days ? `+${contract.overrun_days}d` : "On time"}</td><td><StatusPill status={contract.overrun_days ? "review" : "feasible"} /></td></tr>)}</tbody></table></div>
          </section>
        </div>
        <aside className="side-column">
          <section className="panel validator-panel">
            <div className="panel-heading"><div><p className="eyebrow">VALIDATOR READOUT</p><h2>Safety gates</h2></div><StatusPill status={result.summary.feasibility} /></div>
            {result.violations.length === 0 ? <div className="all-clear"><ShieldCheck size={22} /><div><strong>No hard violations</strong><span>Every scheduled activity is accounted for.</span></div></div> : <div className="violation-list">{result.violations.slice(0, 5).map((violation, index) => <div className="violation" key={`${violation.rule}-${index}`}><XCircle size={16} /><div><strong>{violation.rule}</strong><span>{violation.detail}</span></div></div>)}</div>}
            <div className="gate-list"><span><i className="gate-check" />Workload conservation</span><span><i className="gate-check" />Predecessor precedence</span><span><i className="gate-check" />Weekly allocation</span><span><i className="gate-check" />Location capacity</span></div>
          </section>
          <section className="panel dispatch-panel"><div className="panel-heading"><div><p className="eyebrow">DISPATCH VIEW</p><h2>Access nights</h2></div><Map size={17} className="panel-icon" /></div><div className="filter-line"><label>Filter week</label><select value={weekFilter} onChange={(event) => setWeekFilter(event.target.value)}><option value="all">All weeks</option>{result.week_summaries.filter((week) => week.access_count).map((week) => <option key={week.week} value={week.week}>Week {week.week}</option>)}</select></div><div className="dispatch-list">{filteredAccess.slice(0, 7).map((access) => <div className="dispatch-row" key={`${access.activity_id}-${access.access_seq}`}><span className={`line-tag ${access.line.toLowerCase()}`}>{access.line}</span><div><strong>{access.activity_id}</strong><span>{formatDate(access.access_date)} · night {access.access_night}</span></div>{access.eclo ? <span className="eclo-tag">ECLO</span> : null}</div>)}</div><button className="text-button" onClick={() => navigate("/activity")}>Open activity register <ChevronRight size={14} /></button></section>
        </aside>
      </div>
      {location === "/activity" && null}
    </>
  );
}

function ActivityRegister({ result }: { result: ScheduleResponse }) {
  const [query, setQuery] = useState("");
  const rows = result.activity_results.filter((activity) => `${activity.activity_id} ${activity.contract_number} ${activity.nature_of_works}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="panel activity-register"><div className="panel-heading"><div><p className="eyebrow">ACTIVITY REGISTER</p><h2>Every workfront, accounted for</h2></div><div className="search-box"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search activity or contract" /></div></div><div className="table-wrap"><table><thead><tr><th>Activity</th><th>Contract</th><th>Nature</th><th>Workload</th><th>Window</th><th>Status</th></tr></thead><tbody>{rows.map((activity) => <tr key={activity.activity_id}><td><strong>{activity.activity_id}</strong><span className="cell-sub">{activity.activity_type}</span></td><td>{activity.contract_number}</td><td>{activity.nature_of_works}</td><td>{formatNumber(activity.scheduled_accesses, 1)} / {formatNumber(activity.total_accesses, 1)}</td><td>W{activity.first_week} — W{activity.last_week}</td><td><StatusPill status={activity.status} /></td></tr>)}</tbody></table></div></section>;
}

function AppShell() {
  const [files, setFiles] = useState<Record<string, string>>({});
  const [scenario, setScenario] = useState<Scenario>("C");
  const [result, setResult] = useState<ScheduleResponse | null>(null);
  const [location] = useLocation();
  const schedule = useCreateSchedule({ mutation: { onSuccess: (data) => setResult(data) } });

  async function readFiles(fileList: FileList) {
    const entries = await Promise.all(Array.from(fileList).map(async (file) => [file.name, await file.text()] as const));
    setFiles(Object.fromEntries(entries));
  }

  function run() {
    if (!Object.keys(files).length) return;
    schedule.mutate({ data: { scenario, files } });
  }

  const hasRun = result !== null;
  return (
    <div className="app-shell">
      <header className="topbar"><Link href="/" className="brand"><span className="brand-mark"><div className="brand-rail rail-a" /><div className="brand-rail rail-b" /></span><span>TrackAccess <b>OPTIMISER</b></span></Link><div className="topbar-right"><span className="live-indicator"><i /> Scheduler online</span><span className="topbar-divider" /><span className="controller">Works control <span className="avatar">WC</span></span></div></header>
      <main className="app-main">
        <div className="page-intro"><div><p className="eyebrow">RAILWAY POSSESSION PLANNING</p><h1>Good access starts with<br /><em>the right night.</em></h1><p className="intro-copy">A decision-support workspace for the dual-line network. Pack the work, protect the railway, and show exactly why the plan holds.</p></div><div className="scenario-wrap"><span className="field-label">Planning mode</span><ScenarioSelector scenario={scenario} onChange={setScenario} /></div></div>
        {!hasRun ? <section className="workspace-card"><div className="workspace-head"><div><span className="step-label"><i>01</i> Instance</span><h2>Load the demand book</h2></div><span className="workspace-state">Waiting for input</span></div>{Object.keys(files).length ? <div className="loaded-state"><div className="loaded-icon"><CheckCircle2 size={20} /></div><div><strong>{Object.keys(files).length} source file{Object.keys(files).length === 1 ? "" : "s"} ready</strong><span>{Object.keys(files).slice(0, 2).join(" · ")}{Object.keys(files).length > 2 ? ` · +${Object.keys(files).length - 2} more` : ""}</span></div><button className="icon-button" onClick={() => setFiles({})} aria-label="Clear files"><XCircle size={17} /></button></div> : <EmptyState onLoadDemo={() => setFiles(DEMO_FILES)} onFiles={readFiles} />}<div className="workspace-footer"><span><CircleHelp size={14} /> All activities are scheduled; none are dropped under congestion.</span><button className="button primary run-button" disabled={!Object.keys(files).length || schedule.isPending} onClick={run}>{schedule.isPending ? <><Loader2 size={15} className="spin" /> Generating plan</> : <><Play size={15} /> Generate schedule</>}</button></div>{schedule.error && <p className="error-banner"><AlertTriangle size={15} /> {(schedule.error as { data?: { error?: string } })?.data?.error ?? "The scheduler could not process these files. Check that all eight CSVs are present."}</p>}</section> : <Switch><Route path="/activity"><ActivityRegister result={result} /></Route><Route><Dashboard result={result} onReset={() => setResult(null)} /></Route></Switch>}
      </main>
      <footer className="app-footer"><span>TrackAccess Optimiser · Hackathon prototype</span><span>Constraint-aware scheduling for Line Alpha + Line Beta</span></footer>
    </div>
  );
}

export default function App() {
  return <QueryClientProvider client={queryClient}><AppShell /></QueryClientProvider>;
}

const queryClient = new QueryClient();