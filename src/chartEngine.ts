import { sha256Hex } from './sha256.ts';
import { LocalPaipan, TrueSolarTimeCalculator, type LocalPaipanInstance } from './zhenyi.ts';

export interface BirthInput {
  date: string;
  calendar: "solar" | "lunar";
  leapMonth?: boolean;
  timeMode: "exact" | "range" | "unknown";
  time?: string;
  startTime?: string;
  endTime?: string;
  timezone: string;
  longitude: number;
  trueSolarTime: boolean;
  sex: "male" | "female";
}

export interface CandidateChart {
  id: string;
  pillars: { year: string; month: string; day: string; hour: string };
  dayMaster: string;
  civilTimes: string[];
  features: Record<string, unknown>;
  warnings: string[];
}

export interface CandidateSet {
  input: BirthInput;
  candidates: CandidateChart[];
  warnings: string[];
  engine: { name: string; revision: string; ruleProfile: string };
}

export class ChartInputError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ChartInputError";
  }
}

export const ZHENYI_ENGINE = Object.freeze({
  name: "ZHENYI-ORG/Zhenyi-bazi",
  revision: "383a726437a81db2b87eed517ef5e6ccd30b7bd4",
  ruleProfile: "zhenyi-blind-00h-split-zi-absolute-jieqi-utc8-local-dayhour-v2-minute"
});

const POSITIONS = ["year", "month", "day", "hour"] as const;
const ELEMENT_NAMES = ["wood", "fire", "earth", "metal", "water"] as const;
const STEM_ELEMENTS = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4];
const FULL_GODS: Record<string, string> = { 比: "比肩", 劫: "劫财", 食: "食神", 伤: "伤官", 财: "偏财", 才: "正财", 杀: "七杀", 官: "正官", 枭: "偏印", 印: "正印" };
const MINUTE_MS = 60_000;
type CivilDate = [number, number, number];
type ClockParts = [number, number, number, number, number, number];
type FourIndices = [number, number, number, number];

function fail(code: string, message: string): never { throw new ChartInputError(code, message); }
function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) fail("ENGINE_FAILURE", "本地排盘数据缺少必要字段。");
  return value;
}
function fourIndices(values: number[], upper: number): FourIndices {
  if (values.length !== 4 || values.some(value => !Number.isInteger(value) || value < 0 || value >= upper)) fail("ENGINE_FAILURE", "本地排盘返回无效干支索引。");
  return [at(values, 0), at(values, 1), at(values, 2), at(values, 3)];
}
function pad(value: number): string { return String(value).padStart(2, "0"); }
function dateText(parts: number[]): string { return String(at(parts, 0)).padStart(4, "0") + "-" + pad(at(parts, 1)) + "-" + pad(at(parts, 2)); }
function clockText(parts: number[]): string { return dateText(parts) + "T" + pad(at(parts, 3)) + ":" + pad(at(parts, 4)) + ":" + pad(parts[5] ?? 0); }
function utcParts(epoch: number): ClockParts {
  const d = new Date(epoch);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()];
}
function partsEpoch(parts: number[]): number { return Date.UTC(at(parts, 0), at(parts, 1) - 1, at(parts, 2), parts[3] ?? 0, parts[4] ?? 0, parts[5] ?? 0); }

function parseDate(value: unknown): CivilDate {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("INVALID_DATE", "出生日期必须为 YYYY-MM-DD。");
  const parts: CivilDate = [Number(value.slice(0, 4)), Number(value.slice(5, 7)), Number(value.slice(8, 10))];
  if (parts[0] < 1600 || parts[0] > 2200 || parts[1] < 1 || parts[1] > 12 || parts[2] < 1 || parts[2] > 31) fail("INVALID_DATE", "支持的出生年份为 1600—2200，请核对日期。");
  return parts;
}

function minuteOfDay(value: unknown): number {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail("INVALID_TIME", "时间必须为 24 小时制 HH:mm，精确到分钟。");
  const hour = Number(value.slice(0, 2)), minute = Number(value.slice(3, 5));
  return hour * 60 + minute;
}

function validateInput(input: BirthInput): CivilDate {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("INVALID_INPUT", "缺少出生信息对象。");
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) fail("INVALID_INPUT", "出生信息必须为普通数据对象。");
  const allowedKeys = new Set(["date", "calendar", "leapMonth", "timeMode", "time", "startTime", "endTime", "timezone", "longitude", "trueSolarTime", "sex"]);
  if (Reflect.ownKeys(input).some(key => typeof key !== "string" || !allowedKeys.has(key))) fail("UNKNOWN_FIELD", "出生信息包含未定义字段，请只提交排盘所需字段。");
  const date = parseDate(input.date);
  if (input.calendar !== "solar" && input.calendar !== "lunar") fail("INVALID_CALENDAR", "必须明确选择公历或农历。");
  if (input.leapMonth !== undefined && typeof input.leapMonth !== "boolean") fail("INVALID_LEAP_MONTH", "闰月标记必须为布尔值。");
  if (input.calendar === "solar" && input.leapMonth) fail("INVALID_LEAP_MONTH", "公历日期不能标记农历闰月。");
  if (!["exact", "range", "unknown"].includes(input.timeMode)) fail("INVALID_TIME_MODE", "必须明确选择准确时间、同日范围或全天未知。");
  const allowedTimeKeys = input.timeMode === "exact" ? ["time"] : input.timeMode === "range" ? ["startTime", "endTime"] : [];
  if (["time", "startTime", "endTime"].some(key => Object.hasOwn(input, key) && !allowedTimeKeys.includes(key))) fail("CONFLICTING_TIME_FIELDS", "当前时间模式包含其他模式的时间字段，请移除不用的字段。");
  if (input.sex !== "male" && input.sex !== "female") fail("MISSING_SEX", "传统排运所需的性别必须明确提供。");
  if (typeof input.timezone !== "string" || input.timezone.trim() !== input.timezone || input.timezone.length === 0) fail("INVALID_TIMEZONE", "必须提供有效 IANA 时区，不能使用系统默认时区。");
  if (typeof input.longitude !== "number" || !Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) fail("INVALID_LONGITUDE", "必须提供 -180 到 180 之间的有效经度。");
  if (typeof input.trueSolarTime !== "boolean") fail("MISSING_TIME_BASIS", "必须明确是否使用真太阳时。");
  return date;
}

function makeZoneResolver(timezone: string, date: CivilDate) {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    formatter.format(new Date(partsEpoch(date)));
  } catch { return fail("INVALID_TIMEZONE", "IANA 时区无效或当前运行时不支持该时区。"); }
  const zonedParts = (epoch: number): ClockParts => {
    const p: Record<string, number> = {};
    for (const part of formatter.formatToParts(new Date(epoch))) if (part.type !== "literal") p[part.type] = Number(part.value);
    return [Number(p.year), Number(p.month), Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)];
  };
  const offsets = new Set<number>();
  const base = partsEpoch(date);
  // Scan offsets at the declared minute resolution, including short historical
  // transitions; then validate every possible UTC interpretation of each civil minute.
  for (let minute = -2880; minute <= 4320; minute++) {
    const epoch = base + minute * MINUTE_MS;
    offsets.add(partsEpoch(zonedParts(epoch)) - epoch);
  }
  return (minute: number): { epoch: number; offsetMs: number }[] => {
    const desired: ClockParts = [...date, Math.floor(minute / 60), minute % 60, 0];
    const wall = partsEpoch(desired);
    return [...offsets].map(offsetMs => ({ epoch: wall - offsetMs, offsetMs }))
      .filter(item => zonedParts(item.epoch).every((part, index) => part === desired[index]))
      .sort((a, b) => a.epoch - b.epoch);
  };
}

interface TimeAlternative {
  civilTime: string;
  utcTime: string;
  utcOffsetMinutes: number;
  effectiveTime: string;
  solarTermTime: string;
}
interface Representative extends TimeAlternative {
  effectiveParts: ClockParts;
  solarTermParts: ClockParts;
  stems: FourIndices;
  branches: FourIndices;
}
interface CandidateGroup { chart: CandidateChart; representative: Representative; alternatives: TimeAlternative[]; instantCount: number }

function buildFeatures(engine: LocalPaipanInstance, representative: Representative, sex: BirthInput["sex"]) {
  const { stems, branches, solarTermParts } = representative;
  const hiddenStems: Record<string, unknown> = {};
  const tenGods: Record<string, unknown> = {};
  const nayin: Record<string, unknown> = {};
  const fiveElements: Record<string, number> = { wood: 0, fire: 0, earth: 0, metal: 0, water: 0 };
  const god = (stem: number) => { const short = engine.GetTenGod(stems[2], stem).char; return FULL_GODS[short] ?? short; };
  POSITIONS.forEach((position, index) => {
    const stemIndex = at(stems, index), branchIndex = at(branches, index);
    const hidden = at(engine.dzcg, branchIndex);
    hiddenStems[position] = hidden.map((stem, i) => ({ stem: at(engine.ctg, stem), element: at(engine.cwx, at(STEM_ELEMENTS, stem)), tenGod: god(stem), principal: i === 0, upstreamOrder: i + 1 }));
    tenGods[position] = { stem: position === "day" ? "日元" : god(stemIndex), branch: god(at(hidden, 0)) };
    nayin[position] = engine.naYin(stemIndex, branchIndex)[0];
    const stemElement = at(ELEMENT_NAMES, at(STEM_ELEMENTS, stemIndex));
    const branchElement = at(ELEMENT_NAMES, at(engine.dzwx, branchIndex));
    fiveElements[stemElement] = (fiveElements[stemElement] ?? 0) + 1;
    fiveElements[branchElement] = (fiveElements[branchElement] ?? 0) + 1;
  });
  // GetInfo computes upstream descriptive scores too; none are exposed or used to select candidates.
  const info = engine.GetInfo(sex === "male" ? 0 : 1, solarTermParts[0], solarTermParts[1], solarTermParts[2], solarTermParts[3], solarTermParts[4], solarTermParts[5]);
  const luckCycles = (info.big_tg ?? []).map((stem, index) => {
    const startYear = info.big_start_time?.[index]?.[0] ?? 0;
    const startAge = Number(info.qiyun_virtual_age ?? 0) + index * 10;
    return { pillar: at(engine.ctg, stem) + at(engine.cdz, at(info.big_dz ?? [], index)), startAge, endAge: startAge + 9, startYear, endYear: startYear + 9, startTime: info.big_start_time?.[index] ? clockText(info.big_start_time[index]) + "+08:00" : null, timeBasis: "fixed_utc_plus_8", stemPhaseYears: 5, branchPhaseYears: 5 };
  });
  return {
    hiddenStems, tenGods, nayin, fiveElements,
    fiveElementsDefinition: "unweighted visible stems plus branch principal elements; not a strength score",
    luckCycles,
    qiyun: { method: info.qiyun_method, virtualAge: info.qiyun_virtual_age, sourceDays: info.qiyun_source_days, jiaoyunRule: info.jiaoyun_desc, referenceTime: representative.solarTermTime, referenceTimeBasis: "fixed_utc_plus_8" },
    luckCyclesRepresentative: { civilTime: representative.civilTime, effectiveTime: representative.effectiveTime, solarTermTime: representative.solarTermTime, exactForAllGroupedMinutes: false },
    ruleProfile: ZHENYI_ENGINE.ruleProfile
  };
}

export function generateCandidateCharts(input: BirthInput): CandidateSet {
  const originalDate = validateInput(input);
  const engine = new LocalPaipan();
  let date = originalDate;
  if (input.calendar === "solar") {
    const actual = utcParts(partsEpoch(date));
    if (date.some((part, index) => part !== actual[index])) fail("INVALID_DATE", "公历日期不存在。");
  } else {
    const leap = input.leapMonth ? 1 : 0;
    const days = engine.GetLunarDays(date[0], date[1], leap);
    if (date[2] > days || days <= 0 || (leap && engine.GetLeap(date[0]) !== date[1])) fail("INVALID_LUNAR_DATE", "农历日期或闰月不存在。");
    const converted = engine.Lunar2Solar(date[0], date[1], date[2], leap);
    if (!converted) fail("INVALID_LUNAR_DATE", "农历日期无法转换为公历。");
    date = [at(converted, 0), at(converted, 1), at(converted, 2)];
  }
  let first = 0, last = 1439;
  if (input.timeMode === "exact") first = last = minuteOfDay(input.time);
  else if (input.timeMode === "range") {
    first = minuteOfDay(input.startTime); last = minuteOfDay(input.endTime);
    if (last < first) fail("CROSS_DAY_RANGE", "时间范围必须在同一天内且结束时间不早于开始时间；跨日需分别建立候选集。");
  }
  const resolve = makeZoneResolver(input.timezone, date);
  const solarDate = dateText(date);
  const groups = new Map<string, CandidateGroup>();
  let missingMinutes = 0, repeatedMinutes = 0;
  for (let minute = first; minute <= last; minute++) {
    const civilParts: ClockParts = [...date, Math.floor(minute / 60), minute % 60, 0];
    const time = pad(civilParts[3]) + ":" + pad(civilParts[4]);
    const civilTime = solarDate + "T" + time;
    const instants = resolve(minute);
    if (instants.length === 0) { missingMinutes++; continue; }
    if (instants.length > 1) repeatedMinutes++;
    for (const instant of instants) {
      let effectiveParts = civilParts;
      if (input.trueSolarTime) {
        // UTC-zero gives the upstream longitude/EOT correction; applying the actual
        // offset separately preserves repeated DST instants and historical second offsets.
        const solar = TrueSolarTimeCalculator.calculate(solarDate, time, input.longitude, 0);
        effectiveParts = utcParts(partsEpoch(solar.parts) - instant.offsetMs);
      }
      const gz = engine.GetGanZhi(effectiveParts[0], effectiveParts[1], effectiveParts[2], effectiveParts[3], effectiveParts[4], effectiveParts[5]);
      if (gz.length === 0) fail("ENGINE_FAILURE", "本地排盘引擎未返回有效四柱。");
      const stems = fourIndices(gz[0], 10), branches = fourIndices(gz[1], 12);
      // Upstream solar-term Julian dates include a fixed +8-hour offset. The
      // absolute birth instant must use that same axis for year/month boundaries.
      const solarTermParts = utcParts(instant.epoch + 8 * 60 * MINUTE_MS);
      const termGz = engine.GetGanZhi(solarTermParts[0], solarTermParts[1], solarTermParts[2], solarTermParts[3], solarTermParts[4], solarTermParts[5]);
      if (termGz.length === 0) fail("ENGINE_FAILURE", "本地节气计算未返回有效年柱和月柱。");
      const termStems = fourIndices(termGz[0], 10), termBranches = fourIndices(termGz[1], 12);
      stems[0] = termStems[0]; stems[1] = termStems[1];
      branches[0] = termBranches[0]; branches[1] = termBranches[1];
      const pillarValues = POSITIONS.map((_, index) => at(engine.ctg, at(stems, index)) + at(engine.cdz, at(branches, index)));
      const pillars = { year: at(pillarValues, 0), month: at(pillarValues, 1), day: at(pillarValues, 2), hour: at(pillarValues, 3) };
      const key = pillarValues.join("|");
      const representative: Representative = { civilTime, utcTime: new Date(instant.epoch).toISOString(), utcOffsetMinutes: instant.offsetMs / MINUTE_MS, effectiveTime: clockText(effectiveParts), solarTermTime: clockText(solarTermParts) + "+08:00", effectiveParts, solarTermParts, stems, branches };
      let group = groups.get(key);
      if (!group) {
        group = { chart: { id: "chart-" + sha256Hex(key).slice(0, 16), pillars, dayMaster: at(engine.ctg, stems[2]), civilTimes: [], features: {}, warnings: [] }, representative, alternatives: [], instantCount: 0 };
        groups.set(key, group);
      }
      if (group.chart.civilTimes[group.chart.civilTimes.length - 1] !== civilTime) group.chart.civilTimes.push(civilTime);
      group.instantCount++;
      if (instants.length > 1) group.alternatives.push({ civilTime, utcTime: representative.utcTime, utcOffsetMinutes: representative.utcOffsetMinutes, effectiveTime: representative.effectiveTime, solarTermTime: representative.solarTermTime });
    }
  }
  if (groups.size === 0) fail("NONEXISTENT_CIVIL_TIME", "所选民用时间在该时区不存在，可能处于夏令时跳时或被跳过的日期；请核对原始记录。");
  const warnings = ["按每个民用分钟的第 0 秒枚举；不覆盖秒级出生不确定性。保留全部不同四柱，不按命理优劣预筛。", "采用显式分钟基准：年/月及起运以绝对时刻转固定 UTC+8 判节气；日/时以所选当地民用或真太阳钟判定。这是本项目的分离时钟口径，与上游整盘使用有效墙钟的入口不同。"];
  if (missingMinutes) warnings.push("所选范围内有 " + missingMinutes + " 个不存在的民用分钟，已跳过并明确保留此缺口。");
  if (repeatedMinutes) warnings.push("所选范围内有 " + repeatedMinutes + " 个重复民用分钟；已计算所有时区解释，同四柱合并时保留各自 UTC 时刻。");
  const candidates = [...groups.values()].map(group => {
    const rep = group.representative;
    group.chart.features = { ...buildFeatures(engine, rep, input.sex), solarDate, originalCalendar: input.calendar, timeBasis: input.trueSolarTime ? "true_solar" : "civil", solarTermTimeBasis: "absolute_instant_fixed_utc_plus_8", timezone: input.timezone, longitude: input.longitude, minuteResolution: 1, evaluatedInstants: group.instantCount, representative: { civilTime: rep.civilTime, utcTime: rep.utcTime, utcOffsetMinutes: rep.utcOffsetMinutes, effectiveTime: rep.effectiveTime, solarTermTime: rep.solarTermTime }, ambiguousTimeAlternatives: group.alternatives };
    if (group.chart.civilTimes.length > 1 || group.instantCount > 1) group.chart.warnings.push("起运和大运使用本组第一个有效分钟及其时区解释；不声明组内精确交运时刻相同。");
    if (group.alternatives.length) group.chart.warnings.push("本组包含夏令时或历史时区的重复民用时间，请保留 UTC 候选，不能静默选较早一次。");
    return group.chart;
  });
  return { input: { ...input }, candidates, warnings, engine: { ...ZHENYI_ENGINE } };
}
