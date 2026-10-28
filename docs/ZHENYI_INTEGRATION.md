# Zhenyi 本地排盘集成

本项目使用真实的本地日期转四柱计算，保留所有符合输入时间范围的不同四柱，再由上层在问卷完成后比较证据。排盘模块没有模型调用、API key、命理打分或候选优劣预筛。AI 给出的后续工作盘建议不等于出生时辰已被客观证实。

## 固定来源与许可

上游：`ZHENYI-ORG/Zhenyi-bazi`，固定提交 [`383a726437a81db2b87eed517ef5e6ccd30b7bd4`](https://github.com/ZHENYI-ORG/Zhenyi-bazi/tree/383a726437a81db2b87eed517ef5e6ccd30b7bd4)。以下文件原样保存在 `vendor/zhenyi`：

| 原始文件 | 本地用途 |
|---|---|
| `dist/core/LocalPaipan.js` | 公农历、节气、四柱、藏干、十神、纳音、起运与大运 |
| `dist/core/TrueSolarTimeCalculator.js` | 使用上游经度与均时差校正计算 |
| `dist/data/nayin.json` | 纳音数据 |
| `dist/data/eot.json` | 按月日查询的均时差表 |
| `LICENSE` | MIT 原版权及许可文本 |

`vendor/zhenyi/SOURCE_MANIFEST.json` 记录原路径、固定来源链接、字节长度、SHA256 和上游 Git blob SHA1；集成测试同时核对两种摘要。五个文件均未修改；本地另加 `package.json` 将 vendor 目录声明为 CommonJS，以及该 manifest。应用本身为 Node 24 ESM + TypeScript，不需要额外运行时依赖。没有复制上游 UI、商业后端、地区数据库、图标、AI Prompt、完整盲派判盘引擎或案例文件。MIT 文本随被复制的代码保留；此记录不是对上游所有材料权利链的独立认证。

## 输入与候选覆盖

入口为 `generateCandidateCharts(input: BirthInput): CandidateSet`，定义见 `src/chartEngine.ts`。输入必须显式给出日历类型、性别、IANA 时区、经度、是否采用真太阳时，不能用默认性别、UTC+8、正午或系统时区补齐。公历及农历日期支持输入年 1600—2200；农历闰月和公历日期会先校验。算法支持范围不等于已经对该区间每一天做过独立历法认证。

输入只能包含 BirthInput 定义的字段，未知字段、数组或非普通对象会拒绝。时间字段按模式互斥：exact 只允许 time，range 只允许 startTime/endTime，unknown 不允许任何时间字段；调用方应省略不用的字段，而不是提交空字符串或 undefined。这样不会把额外 metadata 随 input 回显。

- `exact`：严格接收 `HH:mm`，按该民用分钟的第 0 秒解释，不接受秒数或 24:00。
- `range`：同一输入日期的起止分钟，包含两端；跨日范围明确拒绝，需由调用方分别建立日期候选集。
- `unknown`：逐分钟枚举 00:00—23:59，不只取十二个时辰中点。这样可保留分钟精度下的子时、节气和真太阳时跨日结构差异。
- 仅按年/月/日/时四柱完全相同合并，保留 `civilTimes`。每个 ID 由四柱稳定派生，不代表优先级、置信度或概率。返回顺序是首次出现的时间顺序。

时区解释由宿主 Node 的 Intl/ICU 时区数据库提供。模块先在周边 UTC 区间逐分钟收集偏移，再对每个目标民用分钟反向验证所有 UTC 解释。跳时分钟不会被移到另一个钟点：准确时间若不存在则报错；范围中的缺口会跳过并明确警告；整天被跳过会报错。重复分钟保留全部解释；如果四柱相同，在 `features.ambiguousTimeAlternatives` 保留各 UTC 时刻，如果真太阳时使四柱不同则返回不同候选。不会静默采用上游计算器的“重复时刻取较早一次”策略。

## 规则口径与保留信息

保留真一的 0 点换日、23:00—24:00 夜子时本日日柱与独立时干、立春分年、节令分月、盲派虚岁起运与纳音交运。**时间坐标采用本项目明确版本化的分离时钟策略，不原样沿用上游整盘使用有效墙钟的入口。** `ruleProfile` 为 `zhenyi-blind-00h-split-zi-absolute-jieqi-utc8-local-dayhour-v2-minute`。

原因是上游 [GetAdjustedJQ](https://github.com/ZHENYI-ORG/Zhenyi-bazi/blob/383a726437a81db2b87eed517ef5e6ccd30b7bd4/dist/core/LocalPaipan.js#L162-L178) 明确给节气 Julian date 加上 1/3 日，即固定 UTC+8；直接拿纽约或真太阳墙钟比较会移动真实节气边界。因此本项目对每个真实 UTC 候选分别计算：

1. 年/月：将绝对时刻转为固定 UTC+8，与上游节气表处于同一坐标，只取此次 GetGanZhi 的年、月。
2. 日/时：使用用户明确选定的当地民用钟或经度/均时差修正后的真太阳钟，只取该次计算的日、时。
3. 起运和大运：使用同一个固定 UTC+8 代表时点计算，避免从错误的月柱起运。`qiyun.referenceTimeBasis` 和交运 `startTime` 的 +08:00 后缀明确记录该口径。

由此，经度或真太阳开关不会移动全球同时发生的节气；日/时仍可因地方时间而不同。这是软件采用的明确规则选择，不声称所有术数流派都采用同一规则。原始 vendor 文件没有改动，坐标分离仅发生在本地 wrapper。

真太阳时校正使用未修改的上游计算器，以 UTC 零偏移取得经度/均时差结果，再减去每个实际时区解释的偏移。这层包装保留 DST 双解及历史秒级时区偏移；不使用其自动选择较早 DST 时刻的入口。均时差来自上游月日表，不是按出生年份逐秒计算的太阳历表。候选枚举精度为一分钟，不能保证覆盖仅在一分钟内短暂存在的结构，也不能解释为秒级出生时间认证。

每个候选的 `features` 包含：

- `hiddenStems`、`tenGods`、`nayin` 和 `fiveElements`。五行值只是明干加地支主五行的无权计数，不是旺衰得分。藏干保留 `principal` 与底层 `upstreamOrder`；底层藏干顺序与上游展示适配器的中气/余气顺序并不总相同，因此没有将数组次序伪装为强度等级。
- `luckCycles` 的 12 步大运：柱、起止虚岁、起止公历年份、固定 UTC+8 的交运时点、干支各五年的口径；起止年份是该十年阶段的粗粒度标签，不能把它们当作精确 UTC 区间。
- `qiyun` 的方法、来源天数、虚岁与纳音交运说明。
- `representative` 的民用时间、UTC、偏移、日时有效计算时间和年/月使用的 `solarTermTime`；`timeBasis/solarTermTimeBasis/solarDate` 与时区元数据；发生重复时刻时的所有解释。

**合并相同四柱不代表起运时刻相同。** 起运和大运按组内第一个有效分钟及其时区解释计算，`luckCyclesRepresentative.exactForAllGroupedMinutes=false`，多分钟组附带警告。上层如果需要按某个重大事件日精确判断交运，应对相关候选分钟分别重算，不能直接把代表值当整组精确值。

`LocalPaipan.GetInfo` 内部仍计算上游的描述性五行加权值，因为 vendor 文件保持原样；本项目不暴露、不读取它们来筛选候选，也不调用完整 `BlindJudgmentEngine` 的主功、路径分数、最终断语或未来应期推演。

## 验证范围

`node --test tests/chartEngine.test.ts` 使用合成输入和上游公开示例，覆盖固定四柱、早晚子时、全天 1440 分钟、小时及立春节气边界、公农历/闰月、真太阳时跨日、缺失/未知/冲突字段、DST 跳时/重复、Apia 跳日、重复运行稳定、输入不变与 vendor 原始文件完整性。测试不使用真实用户信息、不调用模型、也不联网。

独立节气 fixture 来自 [香港天文台 2026 年二月月历](https://www.hko.gov.hk/tc/gts/astron2026/files/2026cal02.pdf) 与 [日本国立天文台 2026 历要项](https://eco.mtk.nao.ac.jp/koyomi/yoko/2026/rekiyou262.html)：立春为 2 月 4 日 04:02 HKT / 05:02 JST，惊蛰为 3 月 5 日 22:59 JST。测试取公布分钟前后两分钟，检查纽约跨前一民用日的立春、惊蛰月份变化、同一 UTC 时刻跨时区年/月一致，以及真太阳经度校正不移动节气。这是独立天文日期边界检查，不使用上游函数生成测试期望。

这些测试证明列出的软件行为与固定口径一致，不证明八字、出生时辰反推或人生事件预测的真实性和准确率。完整历史时区认证、秒级时间不确定性、全支持年份天文精度认证及各流派交叉验证仍未完成。
