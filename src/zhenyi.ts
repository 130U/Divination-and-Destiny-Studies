// The upstream files stay byte-for-byte pinned; this boundary supplies their used types.
// @ts-expect-error Upstream CommonJS has no TypeScript declarations.
import { LocalPaipan as UpstreamLocalPaipan } from '../vendor/zhenyi/core/LocalPaipan.js';
// @ts-expect-error Upstream CommonJS has no TypeScript declarations.
import { TrueSolarTimeCalculator as UpstreamTrueSolarTimeCalculator } from '../vendor/zhenyi/core/TrueSolarTimeCalculator.js';

interface UpstreamInfo {
  big_tg?: number[];
  big_dz?: number[];
  big_start_time?: number[][];
  qiyun_virtual_age?: number;
  qiyun_source_days?: number;
  qiyun_method?: string;
  jiaoyun_desc?: string;
  start_time?: number[];
}

export interface LocalPaipanInstance {
  ctg: string[];
  cdz: string[];
  cwx: string[];
  dzwx: number[];
  dzcg: number[][];
  GetGanZhi(year: number, month: number, day: number, hour: number, minute: number, second: number): [number[], number[], number, number[], number] | [];
  GetInfo(sex: number, year: number, month: number, day: number, hour: number, minute: number, second: number): UpstreamInfo;
  GetTenGod(dayStem: number, otherStem: number): { char: string };
  Lunar2Solar(year: number, month: number, day: number, leap: number): number[] | false;
  GetLeap(year: number): number;
  GetLunarDays(year: number, month: number, leap: number): number;
  naYin(stem: number, branch: number): unknown[];
}

export const LocalPaipan = UpstreamLocalPaipan as new () => LocalPaipanInstance;
export const TrueSolarTimeCalculator = UpstreamTrueSolarTimeCalculator as {
  calculate(date: string, time: string, longitude: number, timezone: number): { parts: number[] };
};
