# 第三方来源与许可

## Zhenyi-bazi

- 上游：[ZHENYI-ORG/Zhenyi-bazi](https://github.com/ZHENYI-ORG/Zhenyi-bazi)。
- 固定提交：[`383a726437a81db2b87eed517ef5e6ccd30b7bd4`](https://github.com/ZHENYI-ORG/Zhenyi-bazi/tree/383a726437a81db2b87eed517ef5e6ccd30b7bd4)。
- 版权：Copyright (c) 2026 ZhenYi。
- 许可：MIT，完整原文保存在 [`vendor/zhenyi/LICENSE`](vendor/zhenyi/LICENSE)。

下列 5 个文件按固定提交原样保留：

| 上游路径 | 本地路径 | 用途 |
| --- | --- | --- |
| `dist/core/LocalPaipan.js` | `vendor/zhenyi/core/LocalPaipan.js` | 历法、四柱与排运 |
| `dist/core/TrueSolarTimeCalculator.js` | `vendor/zhenyi/core/TrueSolarTimeCalculator.js` | 经度与均时差校正 |
| `dist/data/nayin.json` | `vendor/zhenyi/data/nayin.json` | 纳音数据 |
| `dist/data/eot.json` | `vendor/zhenyi/data/eot.json` | 均时差数据 |
| `LICENSE` | `vendor/zhenyi/LICENSE` | 原始版权与许可 |

[`SOURCE_MANIFEST.json`](vendor/zhenyi/SOURCE_MANIFEST.json) 记录每个文件的固定来源 URL、字节数、SHA-256 和上游 Git blob 标识。vendor 内另加的 `package.json` 与 manifest 是本项目的加载及来源记录，不是上游原始文件。`npm run check` 包含完整性检查。

本项目的时间坐标 wrapper 和应用流程独立实现，没有复制上游完整 `BlindJudgmentEngine`、AI prompt、商业后端、界面、图标、字体、地区数据库或私人命例。被复制文件保留 MIT 通知；不对上游未纳入内容的许可作延伸声明。MIT 许可不构成命理判断或预测有效性背书。

## 问卷设计

题库设计来自项目所有者 `130U` 的 `bazi-context-agent/configs/question_bank.v1.json`，已由所有者明确授权复制与调整。源版本为 `1.1`；读取时 checkout revision 为 `b277fec462bada4c09ac651ed02a68d25ccd935d`，实际源文件 SHA-256 为 `a10cac9ad1928d702f81e3b71fcc8bcf51e5c025279192fcaab0aa3c50b135ff`。

新题库保留 B/C/D 组题目 ID、原文、选项与适用条件，独立调整收集顺序和完整性策略。出处、实际内容散列及调整说明保存在 [`configs/question_bank.v1.json`](configs/question_bank.v1.json) 的 `provenance`。这里记录特定内容的所有者授权，不把旧仓库全部材料笼统标为第三方开源授权。应用运行时不依赖或修改旧仓库。

## 开发依赖与外部服务

依赖版本和许可元数据以 [`package-lock.json`](package-lock.json) 为准：

| 开发依赖 | 当前锁定版本 | 许可元数据 |
| --- | --- | --- |
| `typescript` 及其平台编译器包 | `7.0.2` | Apache-2.0 |
| `@types/node` | `24.13.3` | MIT |
| `undici-types`（类型依赖） | `7.18.2` | MIT |

安装包自带的许可文本随 npm 包保留。应用未捆绑 Node.js 运行时，也没有额外应用运行时 npm 依赖。

DeepSeek 通过服务端 HTTP API 使用，未复制模型权重或将外部服务纳入本项目 MIT 许可。服务使用、数据处理及费用按提供方适用条款执行。本项目默认模型名只是客户端配置，不代表服务可用性或预测能力认证。
