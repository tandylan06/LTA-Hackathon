export type Scenario = "A" | "B" | "C";

export type CsvRow = Record<string, string>;

export interface InstanceData {
  source: string;
  horizonStart: string;
  horizonWeeks: number;
  lines: CsvRow[];
  stations: CsvRow[];
  sectors: CsvRow[];
  locations: CsvRow[];
  buffers: CsvRow[];
  projectDetails: CsvRow[];
  activities: CsvRow[];
}

export interface AccessRow {
  activity_id: string;
  access_seq: number;
  week: number;
  week_start: string;
  eclo: number;
  access_night: number;
  access_date: string;
  line: string;
}

export interface OccupancyRow {
  activity_id: string;
  contract_number: string;
  week: number;
  location_id: string;
  co_share_group: string;
  access_date: string;
  nature_of_works: string;
  access_type: string;
}

export interface Violation {
  rule: string;
  severity: "hard" | "warning";
  detail: string;
}