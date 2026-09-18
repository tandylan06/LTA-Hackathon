import { loadInstance, numberValue } from "./csv";
import type { AccessRow, InstanceData, OccupancyRow, Scenario, Violation } from "./types";

interface ActivityPlacement {
  row: Record<string, string>;
  contract: Record<string, string>;
  access: AccessRow[];
  occupancy: OccupancyRow[];
}

interface ScheduleResult {
  scenario: Scenario;
  source: string;
  generated_at: string;
  summary: Record<string, number | string>;
  contract_results: Array<Record<string, number | string>>;
  activity_results: Array<Record<string, number | string>>;
  access_rows: AccessRow[];
  occupancy_rows: OccupancyRow[];
  week_summaries: Array<Record<string, unknown>>;
  violations: Violation[];
}

const priorityNudge: Record<string, number> = { "1": 0.3, "2": 0.2, "3": 0 };
const tierWeight: Record<string, number> = { "1": 100, "2": 10, "3": 1 };

function parseISO(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function addDays(value: Date, days: number): Date {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function differenceInCalendarDays(later: Date, earlier: Date): number {
  return Math.round((Date.UTC(later.getUTCFullYear(), later.getUTCMonth(), later.getUTCDate()) - Date.UTC(earlier.getUTCFullYear(), earlier.getUTCMonth(), earlier.getUTCDate())) / 86400000);
}

function format(value: Date, pattern: "yyyy-MM-dd" | "EEE"): string {
  if (pattern === "EEE") return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][value.getUTCDay()];
  return value.toISOString().slice(0, 10);
}

function weekStart(instance: InstanceData, week: number): Date {
  return addDays(parseISO(instance.horizonStart), (week - 1) * 7);
}

function weekForDate(instance: InstanceData, value: string): number {
  return Math.max(1, Math.floor(differenceInCalendarDays(parseISO(value), parseISO(instance.horizonStart)) / 7) + 1);
}

function dateForAccess(instance: InstanceData, week: number, night: number): string {
  return format(addDays(weekStart(instance, week), Math.max(0, night - 1)), "yyyy-MM-dd");
}

function activityLocations(instance: InstanceData, activity: Record<string, string>): string[] {
  const start = activity.start_location_id ?? "";
  const end = activity.end_location_id ?? start;
  const startMatch = start.match(/^SEC:([^:]+):([^:]+):([^:]+)$/);
  const endMatch = end.match(/^SEC:([^:]+):([^:]+):([^:]+)$/);
  if (!startMatch || !endMatch) return [start].filter(Boolean);

  const line = startMatch[1];
  const bound = startMatch[3];
  const sectorRows = instance.sectors
    .filter((sector) => sector.line_code === line)
    .sort((a, b) => numberValue(a, "seq") - numberValue(b, "seq"));
  const startSector = sectorRows.find((sector) => `SEC:${line}:${sector.from_station_id}_${sector.to_station_id}:${bound}` === start);
  const endSector = sectorRows.find((sector) => `SEC:${line}:${sector.from_station_id}_${sector.to_station_id}:${endMatch[3]}` === end);
  const startSeq = numberValue(startSector ?? {}, "seq");
  const endSeq = numberValue(endSector ?? {}, "seq");
  const low = Math.min(startSeq || 1, endSeq || startSeq || 1);
  const high = Math.max(startSeq || 1, endSeq || startSeq || 1);
  const locations = sectorRows
    .filter((sector) => numberValue(sector, "seq") >= low && numberValue(sector, "seq") <= high)
    .map((sector) => `SEC:${line}:${sector.from_station_id}_${sector.to_station_id}:${bound}`);
  return locations.length ? locations : [start];
}

function locationCapacity(instance: InstanceData, location: string): number {
  const row = instance.locations.find((candidate) => candidate.location_id === location);
  return Math.max(1, numberValue(row ?? {}, "supply_capacity", 1));
}

function compatibleCount(
  occupancy: OccupancyRow[],
  capacity: number,
  accessType: string,
): boolean {
  if (accessType === "PM") return occupancy.length === 0;
  if (occupancy.some((entry) => entry.access_type === "PM")) return false;
  if (occupancy.some((entry) => entry.access_type === "PC") && accessType === "PC") return false;
  return occupancy.length < capacity;
}

function pathLine(activity: Record<string, string>): string {
  return activity.start_location_id?.split(":")[1] ?? "ALP";
}

function sortActivities(instance: InstanceData): Record<string, string>[] {
  const contracts = new Map(instance.projectDetails.map((row) => [row.contract_number, row]));
  const activities = [...instance.activities];
  return activities.sort((a, b) => {
    const contractA = contracts.get(a.contract_number) ?? {};
    const contractB = contracts.get(b.contract_number) ?? {};
    const scoreA = `${contractA.contract_priority ?? "3"}-${a.activity_priority ?? "3"}`;
    const scoreB = `${contractB.contract_priority ?? "3"}-${b.activity_priority ?? "3"}`;
    return scoreA.localeCompare(scoreB) || a.planned_start_date.localeCompare(b.planned_start_date);
  });
}

export function generateSchedule(scenario: Scenario, files: Record<string, string>): ScheduleResult {
  const instance = loadInstance(files);
  const contracts = new Map(instance.projectDetails.map((row) => [row.contract_number, row]));
  const accessRows: AccessRow[] = [];
  const occupancyRows: OccupancyRow[] = [];
  const placements = new Map<string, ActivityPlacement>();
  const locationWeek = new Map<string, OccupancyRow[]>();
  const contractWeekNights = new Map<string, Set<number>>();
  const contractWeekSlots = new Map<string, Set<string>>();
  const ecloWindows = new Map<string, number>();
  const completionWeeks = new Map<string, number>();
  const violations: Violation[] = [];

  for (const activity of sortActivities(instance)) {
    const contract = contracts.get(activity.contract_number) ?? {};
    const nature = contract.nature_of_activity ?? "Non-live (Others)";
    const accessType = contract.access_type ?? "C";
    const maxNights = Math.max(1, numberValue(contract, "number_of_maximum_access_per_week", 3));
    const workfronts = Math.max(1, numberValue(contract, "number_of_workfronts", 1));
    const locations = activityLocations(instance, activity);
    const predecessorWeek = activity.predecessor_activity_id ? (completionWeeks.get(activity.predecessor_activity_id) ?? 0) + 1 : 1;
    let nextWeek = Math.max(weekForDate(instance, activity.planned_start_date), predecessorWeek);
    const total = Math.max(0, numberValue(activity, "total_accesses"));
    const access: AccessRow[] = [];
    const occupancy: OccupancyRow[] = [];

    for (let seq = 1; seq <= total; seq += 1) {
      let chosen: { week: number; night: number; excess: boolean; eclo: number } | undefined;
      for (let week = nextWeek; week <= instance.horizonWeeks + 52 && !chosen; week += 1) {
        const weekKey = `${activity.contract_number}:${activity.activity_type}:${week}`;
        const usedNights = contractWeekNights.get(weekKey) ?? new Set<number>();
        const activitySlots = contractWeekSlots.get(weekKey) ?? new Set<string>();
        for (let night = 1; night <= maxNights && !chosen; night += 1) {
          const slotActivities = [...activitySlots].filter((slot) => slot.endsWith(`:${night}`));
          if (slotActivities.length >= workfronts && !slotActivities.includes(activity.activity_id)) continue;
          const date = dateForAccess(instance, week, night);
          const canFit = locations.every((location) => {
            const existing = locationWeek.get(`${location}:${week}`) ?? [];
            return compatibleCount(existing, locationCapacity(instance, location), accessType);
          });
          const excess = !canFit;
          if (scenario === "A" && excess) continue;
          const line = pathLine(activity);
          let eclo = 0;
          if (scenario !== "A" && week > weekForDate(instance, contract.planned_completion_date ?? instance.horizonStart)) {
            const start = ecloWindows.get(line);
            if (start === undefined) ecloWindows.set(line, week);
            const windowStart = ecloWindows.get(line) ?? week;
            if (week <= windowStart + 1) eclo = 1;
          }
          chosen = { week, night, excess, eclo };
          usedNights.add(night);
          contractWeekNights.set(weekKey, usedNights);
          activitySlots.add(`${activity.activity_id}:${night}`);
          contractWeekSlots.set(weekKey, activitySlots);
        }
      }

      if (!chosen) {
        violations.push({ rule: "capacity", severity: "hard", detail: `${activity.activity_id} could not be placed without exceeding the planning horizon` });
        chosen = { week: nextWeek, night: 1, excess: true, eclo: scenario === "A" ? 0 : 1 };
      }

      const placement = chosen;
      const weekStartDate = format(weekStart(instance, placement.week), "yyyy-MM-dd");
      const accessDate = dateForAccess(instance, placement.week, placement.night);
      const accessRow: AccessRow = {
        activity_id: activity.activity_id,
        access_seq: seq,
        week: placement.week,
        week_start: weekStartDate,
        eclo: placement.eclo,
        access_night: placement.night,
        access_date: accessDate,
        line: pathLine(activity),
      };
      access.push(accessRow);
      accessRows.push(accessRow);
      const group = `w${placement.week}-n${placement.night}`;
      for (const location of locations) {
        const entry: OccupancyRow = {
          activity_id: activity.activity_id,
          contract_number: activity.contract_number,
          week: placement.week,
          location_id: location,
          co_share_group: group,
          access_date: accessDate,
          nature_of_works: nature,
          access_type: accessType,
        };
        occupancy.push(entry);
        occupancyRows.push(entry);
        const key = `${location}:${placement.week}`;
        locationWeek.set(key, [...(locationWeek.get(key) ?? []), entry]);
      }
      nextWeek = placement.week;
    }

    const lastWeek = access.at(-1)?.week ?? nextWeek;
    completionWeeks.set(activity.activity_id, lastWeek);
    placements.set(activity.activity_id, { row: activity, contract, access, occupancy });
  }

  const activityResults = [...placements.values()].map(({ row, contract, access }) => ({
    activity_id: row.activity_id,
    contract_number: row.contract_number,
    activity_type: row.activity_type,
    nature_of_works: contract.nature_of_activity ?? "Non-live (Others)",
    total_accesses: numberValue(row, "total_accesses"),
    scheduled_accesses: access.reduce((sum, item) => sum + (item.eclo ? 1.5 : 1), 0),
    first_week: access[0]?.week ?? 0,
    last_week: access.at(-1)?.week ?? 0,
    status: "scheduled",
    activity_priority: numberValue(row, "activity_priority", 3),
  }));

  const contractResults = [...contracts.entries()].map(([contractNumber, contract]) => {
    const own = activityResults.filter((activity) => activity.contract_number === contractNumber);
    const lastWeek = Math.max(...own.map((activity) => activity.last_week), 1);
    const completion = format(addDays(weekStart(instance, lastWeek), 6), "yyyy-MM-dd");
    const planned = contract.planned_completion_date ?? instance.horizonStart;
    const overrun = Math.max(0, differenceInCalendarDays(parseISO(completion), parseISO(planned)));
    return {
      contract_number: contractNumber,
      description: contract.contract_description ?? "",
      priority: numberValue(contract, "contract_priority", 3),
      planned_completion_date: planned,
      simulated_completion_date: completion,
      overrun_days: overrun,
      activity_count: own.length,
      access_count: own.reduce((sum, activity) => sum + activity.scheduled_accesses, 0),
    };
  });

  const dayMap = new Map<string, { date: string; day: string; accesses: number; activities: Set<string>; lines: Set<string>; eclo: boolean }>();
  for (const row of accessRows) {
    const current = dayMap.get(row.access_date) ?? { date: row.access_date, day: format(parseISO(row.access_date), "EEE"), accesses: 0, activities: new Set<string>(), lines: new Set<string>(), eclo: false };
    current.accesses += 1;
    current.activities.add(row.activity_id);
    current.lines.add(row.line);
    current.eclo ||= row.eclo === 1;
    dayMap.set(row.access_date, current);
  }
  const weekSummaries = Array.from({ length: Math.max(instance.horizonWeeks, ...accessRows.map((row) => row.week), 1) }, (_, index) => {
    const week = index + 1;
    const rows = accessRows.filter((row) => row.week === week);
    const days = Array.from({ length: 7 }, (_, dayIndex) => {
      const date = format(addDays(weekStart(instance, week), dayIndex), "yyyy-MM-dd");
      const value = dayMap.get(date);
      return { date, day: value?.day ?? format(parseISO(date), "EEE"), accesses: value?.accesses ?? 0, activities: value?.activities.size ?? 0, lines: value ? [...value.lines] : [], eclo: value?.eclo ?? false };
    });
    const utilization = rows.length / Math.max(1, instance.locations.length);
    return { week, week_start: format(weekStart(instance, week), "yyyy-MM-dd"), week_end: format(addDays(weekStart(instance, week), 6), "yyyy-MM-dd"), access_count: rows.length, eclo_count: rows.filter((row) => row.eclo === 1).length, activities: new Set(rows.map((row) => row.activity_id)).size, alpha_count: rows.filter((row) => row.line === "ALP").length, beta_count: rows.filter((row) => row.line === "BET").length, pressure: utilization > 0.18 ? "tight" : utilization > 0.08 ? "balanced" : "clear", days };
  });

  const totalAccesses = instance.activities.reduce((sum, row) => sum + numberValue(row, "total_accesses"), 0);
  const scheduledAccesses = accessRows.reduce((sum, row) => sum + (row.eclo ? 1.5 : 1), 0);
  const ecloNights = accessRows.filter((row) => row.eclo === 1).length;
  const overrunDays = contractResults.reduce((sum, row) => sum + Number(row.overrun_days), 0);
  const weightedScore = activityResults.reduce((sum, activity) => {
    const contract = contracts.get(activity.contract_number) ?? {};
    const completion = contractResults.find((result) => result.contract_number === activity.contract_number);
    const days = Math.max(0, Number(completion?.overrun_days ?? 0));
    return sum + (tierWeight[contract.contract_priority ?? "3"] ?? 1) * (1 + (priorityNudge[activity.activity_priority ?? "3"] ?? 0)) * days;
  }, 0);
  const excessAccessNights = [...locationWeek.entries()].reduce((sum, [key, rows]) => {
    const location = key.slice(0, key.lastIndexOf(":"));
    return sum + Math.max(0, rows.length - locationCapacity(instance, location));
  }, 0);
  const capacityUtilisation = locationWeek.size ? Math.min(100, (occupancyRows.length / Math.max(1, locationWeek.size)) * 100) : 0;
  const hardCapacity = scenario === "A" && excessAccessNights > 0;
  if (hardCapacity) violations.push({ rule: "capacity", severity: "hard", detail: `${excessAccessNights} location-week capacity excesses found` });
  if (scenario === "A" && ecloNights > 0) violations.push({ rule: "eclo", severity: "hard", detail: "ECLO is forbidden in Scenario A" });

  for (const activity of activityResults) {
    const input = instance.activities.find((row) => row.activity_id === activity.activity_id);
    if (input && activity.first_week < weekForDate(instance, input.planned_start_date)) {
      violations.push({ rule: "planned_date", severity: "hard", detail: `${activity.activity_id} starts before its planned start date` });
    }
  }

  return {
    scenario,
    source: instance.source,
    generated_at: format(new Date(), "yyyy-MM-dd"),
    summary: {
      activities: instance.activities.length,
      contracts: instance.projectDetails.length,
      total_accesses: totalAccesses,
      scheduled_accesses: scheduledAccesses,
      nights_scheduled: accessRows.length,
      eclo_nights: ecloNights,
      overrun_days: overrunDays,
      contracts_overrunning: contractResults.filter((row) => Number(row.overrun_days) > 0).length,
      priority_weighted_score: Number(weightedScore.toFixed(1)),
      excess_access_nights: excessAccessNights,
      feasibility: violations.some((violation) => violation.severity === "hard") ? "review" : "feasible",
      capacity_utilisation: Number(capacityUtilisation.toFixed(1)),
    },
    contract_results: contractResults,
    activity_results: activityResults,
    access_rows: accessRows,
    occupancy_rows: occupancyRows,
    week_summaries: weekSummaries,
    violations,
  };
}