import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ChartInputError, generateCandidateCharts, ZHENYI_ENGINE, type BirthInput } from "../src/chartEngine.ts";

const fixture: BirthInput = { date: "2010-12-09", calendar: "solar", timeMode: "exact", time: "00:30", timezone: "Asia/Shanghai", longitude: 120, trueSolarTime: false, sex: "male" };
const calculate = (changes: Partial<BirthInput> = {}) => {
  const input = { ...fixture, ...changes };
  if (changes.timeMode && changes.timeMode !== "exact" && !Object.hasOwn(changes, "time")) delete input.time;
  return generateCandidateCharts(input);
};
const invalid = (changes: Partial<BirthInput>, code: string) => assert.throws(() => calculate(changes), (error: unknown) => error instanceof ChartInputError && error.code === code);

test("published upstream midnight example produces an actual local chart and twelve luck cycles", () => {
  const result = calculate();
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0]!.pillars, { year: "庚寅", month: "戊子", day: "癸巳", hour: "壬子" });
  assert.equal(result.candidates[0]!.dayMaster, "癸");
  const cycles = result.candidates[0]!.features.luckCycles as { startAge: number; endAge: number; startYear: number; endYear: number; pillar: string }[];
  assert.equal(cycles.length, 12);
  assert.equal(cycles[1]!.startAge, cycles[0]!.startAge + 10);
  assert.equal(cycles[1]!.startYear, cycles[0]!.startYear + 10);
  assert.equal(cycles[0]!.endYear, cycles[0]!.startYear + 9);
  assert.equal(result.engine.revision, ZHENYI_ENGINE.revision);
});

test("late zi keeps the day pillar while next midnight advances it", () => {
  assert.deepEqual(calculate({ time: "23:30" }).candidates[0]!.pillars, { year: "庚寅", month: "戊子", day: "癸巳", hour: "甲子" });
  assert.deepEqual(calculate({ date: "2010-12-10" }).candidates[0]!.pillars, { year: "庚寅", month: "戊子", day: "甲午", hour: "甲子" });
});

test("unknown time retains every civil minute and both zi variants without ranking", () => {
  const result = calculate({ timeMode: "unknown" });
  const allMinutes = result.candidates.flatMap(candidate => candidate.civilTimes);
  assert.equal(allMinutes.length, 1440);
  assert.equal(new Set(allMinutes).size, 1440);
  assert.equal(result.candidates.length, 13);
  assert.ok(allMinutes.includes("2010-12-09T00:00"));
  assert.ok(allMinutes.includes("2010-12-09T23:59"));
  assert.ok(result.candidates.every(candidate => !Object.hasOwn(candidate.features, "score")));
  assert.ok(result.candidates.every(candidate => candidate.warnings.some(warning => warning.includes("代表") || warning.includes("第一个有效分钟"))));
});

test("inclusive same-day ranges retain a one-minute candidate at the hour boundary", () => {
  const result = calculate({ timeMode: "range", startTime: "00:59", endTime: "01:01" });
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.candidates.map(candidate => candidate.civilTimes.length), [1, 2]);
});

test("minute enumeration spans both sides of the 2026 lichun year and month boundary", () => {
  const result = calculate({ date: "2026-02-04", timeMode: "unknown" });
  assert.deepEqual(new Set(result.candidates.map(candidate => candidate.pillars.year)), new Set(["乙巳", "丙午"]));
  assert.deepEqual(new Set(result.candidates.map(candidate => candidate.pillars.month)), new Set(["己丑", "庚寅"]));
  assert.equal(result.candidates.flatMap(candidate => candidate.civilTimes).length, 1440);
});

// Independent astronomical reference (JST): Lichun 2026-02-04 05:02,
// Jingzhe 2026-03-05 22:59. Use minutes either side, not a claimed second-level match.
// https://eco.mtk.nao.ac.jp/koyomi/yoko/2026/rekiyou262.html
// HKO also lists Lichun 2026-02-04 04:02 HKT:
// https://www.hko.gov.hk/tc/gts/astron2026/files/2026cal02.pdf
test("an independently dated lichun instant changes New York year/month on the prior civil date", () => {
  const before = calculate({ date: "2026-02-03", time: "15:00", timezone: "America/New_York", longitude: -74 });
  const after = calculate({ date: "2026-02-03", time: "15:04", timezone: "America/New_York", longitude: -74 });
  assert.equal(before.candidates[0]!.pillars.year, "乙巳");
  assert.equal(before.candidates[0]!.pillars.month, "己丑");
  assert.equal(after.candidates[0]!.pillars.year, "丙午");
  assert.equal(after.candidates[0]!.pillars.month, "庚寅");
  assert.equal(before.candidates[0]!.pillars.day, after.candidates[0]!.pillars.day);
  const span = calculate({ date: "2026-02-03", timeMode: "range", startTime: "15:00", endTime: "15:04", timezone: "America/New_York", longitude: -74 });
  assert.equal(span.candidates.length, 2);
  assert.equal(span.candidates.flatMap(candidate => candidate.civilTimes).length, 5);
});

test("true solar longitude correction never moves the absolute lichun year/month boundary", () => {
  const before = calculate({ date: "2026-02-04", time: "04:00", trueSolarTime: true, longitude: 150 });
  const after = calculate({ date: "2026-02-04", time: "04:04", trueSolarTime: true, longitude: 75 });
  assert.equal(before.candidates[0]!.pillars.year, "乙巳");
  assert.equal(after.candidates[0]!.pillars.year, "丙午");
  assert.equal(after.candidates[0]!.pillars.month, "庚寅");
  const ny = calculate({ date: "2026-02-03", time: "15:04", timezone: "America/New_York", longitude: -74, trueSolarTime: true });
  assert.equal(ny.candidates[0]!.pillars.year, after.candidates[0]!.pillars.year);
  assert.equal(ny.candidates[0]!.pillars.month, after.candidates[0]!.pillars.month);
  assert.deepEqual(ny.candidates[0]!.features.luckCycles, after.candidates[0]!.features.luckCycles);
});

test("an independent jingzhe boundary changes only the seasonal month in New York", () => {
  const before = calculate({ date: "2026-03-05", time: "08:57", timezone: "America/New_York", longitude: -74 });
  const after = calculate({ date: "2026-03-05", time: "09:01", timezone: "America/New_York", longitude: -74 });
  assert.equal(before.candidates[0]!.pillars.month, "庚寅");
  assert.equal(after.candidates[0]!.pillars.month, "辛卯");
  assert.equal(before.candidates[0]!.pillars.year, "丙午");
  assert.equal(after.candidates[0]!.pillars.year, "丙午");
});

test("true solar correction may move the effective calendar date", () => {
  const civil = calculate();
  const solar = calculate({ trueSolarTime: true, longitude: 75 });
  assert.equal(solar.candidates[0]!.pillars.day, "壬辰");
  assert.notEqual(solar.candidates[0]!.pillars.day, civil.candidates[0]!.pillars.day);
  assert.match((solar.candidates[0]!.features.representative as { effectiveTime: string }).effectiveTime, /^2010-12-08T/);
});

test("lunar new year converts to its known solar date", () => {
  const lunar = calculate({ date: "2024-01-01", calendar: "lunar" });
  const solar = calculate({ date: "2024-02-10" });
  assert.deepEqual(lunar.candidates[0]!.pillars, solar.candidates[0]!.pillars);
  assert.equal(lunar.candidates[0]!.features.solarDate, "2024-02-10");
});

test("the 2023 leap second month is distinguished from its ordinary month", () => {
  const leap = calculate({ date: "2023-02-01", calendar: "lunar", leapMonth: true });
  assert.equal(leap.candidates[0]!.features.solarDate, "2023-03-22");
  assert.deepEqual(leap.candidates[0]!.pillars, calculate({ date: "2023-03-22" }).candidates[0]!.pillars);
});

test("dates, leap flags, clocks and cross-day ranges fail explicitly", () => {
  invalid({ date: "2024-02-30" }, "INVALID_DATE");
  invalid({ date: "1500-01-01" }, "INVALID_DATE");
  invalid({ date: "2024-02-01", calendar: "lunar", leapMonth: true }, "INVALID_LUNAR_DATE");
  invalid({ leapMonth: true }, "INVALID_LEAP_MONTH");
  invalid({ time: "24:00" }, "INVALID_TIME");
  invalid({ time: "01:00:30" }, "INVALID_TIME");
  invalid({ time: undefined }, "INVALID_TIME");
  invalid({ timeMode: "range", startTime: "23:00", endTime: "01:00" }, "CROSS_DAY_RANGE");
});

test("missing sex, timezone and coordinates never become silent defaults", () => {
  invalid({ sex: undefined as unknown as BirthInput["sex"] }, "MISSING_SEX");
  invalid({ timezone: "" }, "INVALID_TIMEZONE");
  invalid({ timezone: "Not/A_Zone" }, "INVALID_TIMEZONE");
  invalid({ longitude: Number.NaN }, "INVALID_LONGITUDE");
  invalid({ trueSolarTime: undefined as unknown as boolean }, "MISSING_TIME_BASIS");
});

test("unknown fields, object subclasses and time-mode field mixing are rejected", () => {
  assert.throws(() => generateCandidateCharts({ ...fixture, privateMetadata: "synthetic" } as BirthInput), (error: unknown) => error instanceof ChartInputError && error.code === "UNKNOWN_FIELD");
  assert.throws(() => generateCandidateCharts({ ...fixture, timeMode: "unknown" }), (error: unknown) => error instanceof ChartInputError && error.code === "CONFLICTING_TIME_FIELDS");
  invalid({ startTime: "00:00" }, "CONFLICTING_TIME_FIELDS");
  invalid({ timeMode: "range", time: "00:30", startTime: "00:00", endTime: "01:00" }, "CONFLICTING_TIME_FIELDS");
  assert.throws(() => generateCandidateCharts(Object.assign(Object.create({}), fixture)), (error: unknown) => error instanceof ChartInputError && error.code === "INVALID_INPUT");
});

test("a nonexistent New York DST minute is rejected even with civil chart time", () => {
  invalid({ date: "2024-03-10", time: "02:30", timezone: "America/New_York", longitude: -74 }, "NONEXISTENT_CIVIL_TIME");
});

test("a range straddling a DST gap retains valid minutes and reports the gap", () => {
  const result = calculate({ date: "2024-03-10", timeMode: "range", startTime: "01:59", endTime: "03:01", timezone: "America/New_York", longitude: -74 });
  assert.equal(result.candidates.flatMap(candidate => candidate.civilTimes).length, 3);
  assert.ok(result.warnings.some(warning => warning.includes("60 个不存在")));
});

test("repeated DST instants are retained when both yield the same civil chart", () => {
  const result = calculate({ date: "2024-11-03", time: "01:30", timezone: "America/New_York", longitude: -74 });
  assert.equal(result.candidates.length, 1);
  const alternatives = result.candidates[0]!.features.ambiguousTimeAlternatives as { utcTime: string }[];
  assert.deepEqual(alternatives.map(item => item.utcTime), ["2024-11-03T05:30:00.000Z", "2024-11-03T06:30:00.000Z"]);
  assert.ok(result.candidates[0]!.warnings.some(warning => warning.includes("重复民用时间")));
});

test("repeated DST instants may produce different true-solar hour pillars", () => {
  const result = calculate({ date: "2024-11-03", time: "01:30", timezone: "America/New_York", longitude: -74, trueSolarTime: true });
  assert.equal(result.candidates.length, 2);
  assert.equal(new Set(result.candidates.map(candidate => candidate.pillars.hour)).size, 2);
  assert.ok(result.warnings.some(warning => warning.includes("重复民用分钟")));
});

test("a civil date skipped by a timezone change is not invented", () => {
  invalid({ date: "2011-12-30", timeMode: "unknown", timezone: "Pacific/Apia", longitude: -171.75 }, "NONEXISTENT_CIVIL_TIME");
});

test("generation is repeatable, accepts frozen inputs, and has no generated current timestamp", () => {
  const { time: _time, ...withoutTime } = fixture;
  const input = Object.freeze({ ...withoutTime, timeMode: "range" as const, startTime: "00:59", endTime: "01:01" });
  const before = JSON.stringify(input);
  assert.deepEqual(generateCandidateCharts(input), generateCandidateCharts(input));
  assert.equal(JSON.stringify(input), before);
  assert.ok(!JSON.stringify(generateCandidateCharts(input)).includes("generated_at"));
});

test("vendored code and data retain the pinned upstream blob identity and recorded SHA256", () => {
  const manifestUrl = new URL("../vendor/zhenyi/SOURCE_MANIFEST.json", import.meta.url);
  const manifest = JSON.parse(readFileSync(manifestUrl, "utf8")) as { revision: string; files: { local: string; upstreamGitBlob: string; sha256: string }[] };
  assert.equal(manifest.revision, ZHENYI_ENGINE.revision);
  for (const file of manifest.files) {
    const bytes = readFileSync(new URL("../" + file.local, import.meta.url));
    const gitBlob = createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
    assert.equal(gitBlob, file.upstreamGitBlob, file.local + ": upstream blob changed");
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256, file.local + ": SHA256 changed");
  }
});
