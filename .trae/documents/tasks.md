# SpecPick · 可执行任务拆解与实施路线（tasks.md）

> 配套文档：[spec.md](file:///workspace/.trae/documents/spec.md)（诊断与规划）、[checklist.md](file:///workspace/.trae/documents/checklist.md)（验收门禁）
> 本文只做一件事：把 spec.md 的结论翻译成**可被逐条勾选、可被命令验证**的任务。

## 图例与执行约定

| 标记 | 含义 |
|---|---|
| `P0` | 阻断级：不做则后续全部工作建在流沙上（安全 / 数据 / 门禁） |
| `P1` | 重要：影响可维护性或用户体验 |
| `P2` | 可选：锦上添花 |
| `S/M/L/XL` | ≤0.5 / 1–2 / 3–5 / >5 人日 |
| ✅ 验证 | 必须跑通的命令，**不允许**"人工确认无误"替代 |

**铁律**
1. 每个任务必须**独立可验证**；无法用命令验证的任务，先补测试再动手。
2. 触碰 [store.ts](file:///workspace/src/lib/store.ts) 持久化层或 [types.ts](file:///workspace/src/lib/types.ts) 领域模型的任务，**必须先写失败测试**。
3. `B2`（组件拆分）**禁止**排在 `B3`（组件测试）之前。
4. 提交粒度：一个任务一次提交；提交信息引用任务 ID（如 `fix(security): A1 代理白名单`）。

---

## 里程碑总览

| 里程碑 | 内容 | 出口条件（全部满足才可进入下一里程碑） |
|---|---|---|
| **M0 · 止血** | 路线 A 全量（A1–A15） | CI 绿灯；`npm audit` 无 critical/high；e2e 在干净环境可跑；安全项 S1/S2/S3 关闭 |
| **M1 · 地基** | B1 + B4 + B5 | 双标签页并发不丢数据；engine 无 IO 依赖；线上错误可见 |
| **M2 · 回归网** | B3 → B2 | 组件测试覆盖关键交互；巨型组件拆分为可测单元 |
| **M3 · 价值交付** | F3 + F7 → F6/F4 → F2 → F1 → F5 | 第 1–3 批功能上线且各自有测试 |
| **M4 · 探索** | B6/B7 + F10 → F11 → F8 → F9 | 需先经产品决策，逐项立项 |

---

## M0 · 止血（路线 A 全量）

> 全部为局部改动，受现有 163 个单测保护。**建议一个批次内完成**，避免安全修复与功能开发交叉。

| ID | 任务 | 涉及文件 | 验收标准 | ✅ 验证命令 | 依赖 | 量 |
|---|---|---|---|---|---|---|
| **A1** | 代理层加固：主机白名单 + 私网段拒绝 + 移除客户端可控 `baseUrl`（改为 `provider` 枚举映射） | [shared/aiProxyCore.js](file:///workspace/shared/aiProxyCore.js#L14-L31)、[vite.config.ts](file:///workspace/vite.config.ts)、[api/ai-chat.js](file:///workspace/api/ai-chat.js)、[_worker.js](file:///workspace/_worker.js) | `169.254.169.254`/`127.0.0.1`/`10.*`/`file://`/`gopher://` 全部拒绝返回 400；白名单外主机返回 403 | **扩展**已存在的 [shared/aiProxyCore.test.js](file:///workspace/shared/aiProxyCore.test.js)：`npm test` 断言上述用例 | — | M |
| **A2** | `/api/recognize` 加固：加鉴权 + 限流 + body 体积/长度校验 + `try/catch`；同时**评估直接下线**（见风险卡 R1） | [api/recognize.ts](file:///workspace/api/recognize.ts#L26-L44) | 未鉴权 → 401；超大 body → 413；上游异常不再 500 裸抛 | 手工 `curl` 三条用例 + 新增 handler 单测 | — | M |
| **A3** | CORS 收紧：同源请求不再下发 `Access-Control-Allow-Origin: *` | [_worker.js:14-18](file:///workspace/_worker.js#L14-L18) | 跨域预检响应头不再含 `*` | `curl -H "Origin: https://evil.com" -X OPTIONS` 检查响应头 | — | S |
| **A4** | 补齐 `.env.example`；修正密钥中转文案与注释；代理端**禁止记录 body** | [.env.example](file:///workspace/.env.example)、[AiSettings.tsx:276-279](file:///workspace/src/components/AiSettings.tsx#L276-L279) | 文案与真实链路一致；`grep -rn "body" api shared` 无 body 日志 | grep 检查 + 人工核对文案 | — | S |
| **A5** | 三入口统一加 body 上限 + `AbortSignal.timeout` | [vite.config.ts:40-44](file:///workspace/vite.config.ts#L40-L44)、[api/ai-chat.js](file:///workspace/api/ai-chat.js)、[_worker.js](file:///workspace/_worker.js) | 超时返回 504；超大 body 返回 413 | 新增超时单测（fake timer） | A1 | M |
| **A6** | 建 CI（GitHub Actions）+ 修 e2e 安装步骤（补 Playwright 浏览器安装） | 新增 `.github/workflows/ci.yml`、[package.json](file:///workspace/package.json) `e2e` 脚本、[e2e/smoke.mjs](file:///workspace/e2e/smoke.mjs) | PR 上 lint/test/build/e2e 四个 job 全绿 | 推 PR 观察 CI；本地 `npm run e2e` 在无缓存环境通过 | — | M |
| **A7** | eslint 覆盖 JS 文件 + 新增 `tsconfig.node.json` | [eslint.config.js:11](file:///workspace/eslint.config.js#L11)、新增 `tsconfig.node.json`、[tsconfig.json](file:///workspace/tsconfig.json) | `npx eslint --print-config _worker.js` 规则数 > 0；在 [api/recognize.ts](file:///workspace/api/recognize.ts) 故意造类型错 → `npm run build` **必须失败** | 上述两条命令 | — | M |
| **A8** | 修 5 处未清理 `setTimeout` + `Workbench` 监听器依赖改 ref（去掉 `[skus]` 重挂） | [Report.tsx:778/799/810/1038/1048]、[Workbench.tsx:548-615](file:///workspace/src/components/Workbench.tsx#L548-L615) | 卸载后无 `setState on unmounted` 告警；输入时不重挂监听器 | DevTools 断点 / 新增 hook 单测 | — | M |
| **A9** | 消除展开运算符栈溢出：`parseTable` 求最大列数改循环 + 列抽样；`scoring`/`clusters` 的 `Math.min/max(...)` 改循环 | [parseTable.ts:108](file:///workspace/src/lib/parseTable.ts#L108)、[scoring.ts:89-90/112/322](file:///workspace/src/lib/engine/scoring.ts#L89-L90) | 10 万行输入不抛 `RangeError` | 新增大数据量单测 | — | M |
| **A10** | 删除 `ACTIVE_KEY` 僵尸键（只写不读） | [store.ts:9](file:///workspace/src/lib/store.ts#L9)、[store.ts:296](file:///workspace/src/lib/store.ts#L296) | `saveWorkspace` 只写 `spec-decision:workspace` | 断言 localStorage 键集合 | — | S |
| **A11** | `loadWorkspace` 拆"纯读取 + 显式迁移"；解析失败**先备份**到 `spec-decision:corrupt-backup` 再降级，禁止静默覆盖 | [store.ts:276-291](file:///workspace/src/lib/store.ts#L276-L291) | 损坏 JSON 时原键不被覆盖；备份键存在 | 新增单测：写坏 JSON → 调 `loadWorkspace` → 断言原值仍在 | — | M |
| **A12** | `useChartTheme` 加 `useMemo`，消除父组件 state 变化引发的重渲染 | [useChartTheme.ts](file:///workspace/src/lib/useChartTheme.ts) | Profiler 中父组件翻转 state 时图表不再重渲染 | React DevTools Profiler | — | S |
| **A13** | 补 `share.test.ts` / `parseTable.test.ts` / `clusters.test.ts` + 覆盖率工程（阈值门禁） | 新增 3 个测试文件、[vite.config.ts](file:///workspace/vite.config.ts) `test.coverage`、[package.json](file:///workspace/package.json) | 覆盖率报告落盘；阈值不达标则 `npm test` 失败 | `npm test -- --coverage` | A6 | M |
| **A14** | 文档修订：README 测试数（12→11）、`WeightPie` 注释、**按实际重写** [TechnicalArchitecture.md](file:///workspace/.trae/documents/TechnicalArchitecture.md) | [README.md:56](file:///workspace/README.md#L56)、[TechnicalArchitecture.md](file:///workspace/.trae/documents/TechnicalArchitecture.md)、[PRD.md](file:///workspace/.trae/documents/PRD.md) 配色 | 文档数字/技术栈与实测一致，无残留 Zustand/react-router | `grep -rn "zustand\|react-router" .trae/ README.md` 为空 | — | S |
| **A15** | `chunkSizeWarningLimit` 回调 + CI 体积快照；`.gitignore` 收紧；补 `engines` / `.nvmrc` | [vite.config.ts:80](file:///workspace/vite.config.ts#L80)、[.gitignore]、[package.json](file:///workspace/package.json) | 构建告警阈值生效；CI 记录首屏体积基线 | `npm run build` 观察告警；CI 体积对比 | A6 | S |

**M0 出口判定**：`npm run lint && npm test && npm run build && npm run e2e` 全绿 + CI 首次成功 + `npm audit` 无 critical/high（dev 链 vuln 于 B6 处理）。

---

## M1 · 地基（数据可靠 · 纯净内核 · 可见性）

| ID | 任务 | 涉及文件 | 验收标准 | ✅ 验证命令 | 依赖 | 量 |
|---|---|---|---|---|---|---|
| **B1** | **多标签页一致性协议**（分两步）<br>① 最小可用：监听 `storage`，检出外部变更 → 顶部提示条"另一标签页已修改，载入？"<br>② 加固：`Workspace.rev` 版本号 + `BroadcastChannel`，写入加 `navigator.locks` 串行化，检测到 rev 落后则拒绝覆盖并提示 | [store.ts](file:///workspace/src/lib/store.ts)、[App.tsx:69](file:///workspace/src/App.tsx#L69)、[types.ts](file:///workspace/src/lib/types.ts) | 双标签页各改一次、来回切换后**两边的改动都还在**；并发写不会静默丢失 | 新增 `store.test.ts` 并发用例（模拟第二个写入者）；e2e 加"双标签页"场景 | M0 | L |
| **B4** | **engine 去 IO**：把 `aiNormalizeUnit` 的**网络调用**从 [units.ts:77-97](file:///workspace/src/lib/engine/units.ts#L77-L97) 迁出到 `useUnitNormalize`/调用方；引擎层只保留纯计算；barrel 收敛导出面并加"engine 不得引入 IO"的约束注释 | [units.ts](file:///workspace/src/lib/engine/units.ts)、[useUnitNormalize.ts](file:///workspace/src/lib/useUnitNormalize.ts)、[engine/index.ts](file:///workspace/src/lib/engine/index.ts) | `grep -rn "from '../ai'\|from './ai'" src/lib/engine/` **为空**；engine 单测无需 mock 网络 | 上述 grep + `npm test src/lib/engine` | M0 | M |
| **B5** | **可观测性接入**：新增 `telemetry.ts`（事件 schema + 脱敏白名单），全局 `error` / `unhandledrejection` 捕获；**明确禁止**上报 SKU/价格/API key 等业务数据 | 新增 `src/lib/telemetry.ts`、[main.tsx](file:///workspace/src/main.tsx)、[ai.ts](file:///workspace/src/lib/ai.ts) | 人为抛错能在平台看到事件；事件载荷**不含**任何 `params`/`price`/`apiKey` 字段 | 新增 telemetry 单测断言脱敏；本地触发错误观察上报 | M0 | M |

**M1 出口判定**：B1 并发用例通过；B4 的 grep 为空；B5 脱敏单测通过且平台可见错误。

---

## M2 · 回归网（**先测试，后拆分**）

> ⚠️ **顺序不可颠倒**：B2 动的是 3600+ 行 UI，没有 B3 的回归网就是拿重构赌运气。

| ID | 任务 | 涉及文件 | 验收标准 | ✅ 验证命令 | 依赖 | 量 |
|---|---|---|---|---|---|---|
| **B3** | **组件测试体系**：引入 jsdom + Testing Library，按"用户可见行为"优先覆盖：分享菜单开合与复制反馈、分组折叠、预算输入、识别确认流（[RecognizeReview](file:///workspace/src/components/RecognizeReview.tsx)）、撤销 toast | 新增 `src/components/__tests__/*.test.tsx`、[vitest.config.ts](file:///workspace/vitest.config.ts)、[package.json](file:///workspace/package.json) | 上述 5 条交互各有测试；`npm test` 覆盖 `src/components` 且通过 | `npm test` + `--coverage` 查看 components 覆盖率 | M0 | L |
| **B2** | **组件拆分 + view-model 层**（分三步，**每步独立提交**）<br>① 抽 `lib/view-model/`：把 [Report.tsx](file:///workspace/src/components/Report.tsx)、[Workbench.tsx](file:///workspace/src/components/Workbench.tsx) 内的计算逻辑外移为纯函数并单测<br>② 抽 `lib/palette.ts`：收敛 3 处重复的 `FLAVOR_COLORS` 与配色映射<br>③ 按区块拆子组件，`Report`/`Workbench` 顶层只做编排 | [Report.tsx](file:///workspace/src/components/Report.tsx)、[Workbench.tsx](file:///workspace/src/components/Workbench.tsx)、新增 `src/lib/view-model/`、新增 `src/lib/palette.ts` | 两个顶层文件均 < 400 行；view-model 纯函数单测通过；`FLAVOR_COLORS` 全仓仅 1 处定义；B3 的组件测试**保持全绿**（重构不改行为） | `wc -l src/components/Report.tsx src/components/Workbench.tsx`；`grep -rn "FLAVOR_COLORS" src/` 计数=1；`npm test` | B3 | XL |

**M2 出口判定**：B3 测试全绿且覆盖关键交互；B2 三步完成后组件测试**零改动**通过（证明是纯重构）。

---

## M3 · 价值交付（按此顺序，每项独立可发布）

| 序 | ID | 功能 | 关键交付物 | 验收标准 | ✅ 验证 | 依赖 | 量 |
|---|---|---|---|---|---|---|---|
| 1 | **F3** | 价格智能助理 | [history.ts](file:///workspace/src/lib/engine/history.ts) 新增纯函数 `priceStats`；新增 `PricePositionBadge`；`Sku.targetPrice?`；顺带修老数据播种时间 | 给出历史最低/均价/分位；`price <= targetPrice` 时有提示；**`priceStats` 有单测** | `npm test src/lib/engine/history` | M0 | S |
| 2 | **F7** | 首启引导与空状态 | 空状态卡片（两条路径 + 3 步说明）；把 `generateExample()` 的 `summary` 显性展示 | 全新用户（清 localStorage）首屏即知第一步 | e2e：清空存储后断言引导文案可见 | M0 | S |
| 3 | **F6** | 数据可靠性（多标签页 + 自动草稿） | 见 B1 的②步 + `spec-decision:draft` 节流草案 | 崩溃/关闭后重开能恢复草案；双标签页不丢数据 | B1 并发用例 + e2e | M1 | M |
| 4 | **F4** | 撤销/重做 v2 | 撤销栈（`past`/`future`，上限 50）；绑定 `Ctrl/Cmd+Z`、`Ctrl/Cmd+Shift+Z`；与既有 [undo.ts](file:///workspace/src/lib/undo.ts) 危险操作检查点合并 | 连续编辑 3 次字段可逐步撤回再重做；删除清单仍能撤销 | 新增撤销栈单测 + 组件测试 | M2（需组件测试兜底） | M |
| 5 | **F2** | 决策快照与结论 Diff | `Workspace.snapshots[]` + v2→v3 迁移；`diffSnapshots` 纯函数；快照上限（如 20/清单） | 重开应用后可看到"上次结论 vs 本次结论"差异 | 迁移单测（含老数据）+ `diffSnapshots` 单测 | F6（存储需先可靠）、A11 | M |
| 6 | **F1** | 多清单对比视图 | 只读 `CompareView` + hash 入口 + `diffDecisions` 纯函数 | 两份清单并排；单价差/得分差/最优项易位高亮；不影响"≤2 页"约束 | 组件测试 + `diffDecisions` 单测 | B2①（view-model）、F2 | M |
| 7 | **F5** | 报告导出增强 | 分页长图 / `window.print()` PDF / 可选 `watermark` | 报告可导出多页长图；PDF 打印无工具条；首屏包**不增长**（仍动态 import） | `npm run build` 对比首屏体积；e2e 触发导出 | F2 | M |

---

## M4 · 探索（需逐项立项评审，**不并入常规排期**）

| ID | 功能 | 前置硬条件 | 说明 |
|---|---|---|---|
| **B6** | vitest 升 5 + 依赖整改 | M0 完成 | 消除 critical 与 vitest 2.x 内嵌 `vite@5` 重复实例；major 升级需全量回归 |
| **B7** | 分享能力闭环 | F2 完成 | `share.ts` 编解码版本化 + 导入流程 + 撤销槽打通 |
| **F10** | 多 Provider + 成本面板 | A2/S2 鉴权完成 | 补齐或下线 `recognize` 中"未实现的 provider"分支，避免承诺 > 实现 |
| **F11** | PWA 离线与安装 | B4（engine 去 IO）完成 | 缓存策略需与 [vite.config.ts](file:///workspace/vite.config.ts) 的 chunk 划分、版本注入一致 |
| **F8** | 协同评审（只读批注） | F1 完成 | 先做**零后端**版（批注编码回 URL）；实时版会突破"无后端"硬约束，须产品决策 |
| **F9** | 浏览器扩展抓取电商页 | 路线 A 安全项**全关** + 单独立项 | 风险最高：若走代理路线，会把 S1/S2 放大为对外可利用漏洞 |

---

## 风险卡（开工前必须先读）

| ID | 风险 | 触发场景 | 处置 |
|---|---|---|---|
| **R1** | `/api/recognize` 是"无鉴权 + 烧我方付费 key"的公开端点 | A2 若只做限流而不下线/鉴权 | **优先选择下线或强制鉴权**；若业务确需保留，必须加：鉴权 + 配额 + 体积上限 + 域名白名单，四项缺一不可 |
| **R2** | A11（读失败勿覆盖）若未先做就上 F2 | `loadWorkspace` 遇脏数据仍走迁移覆盖，新增 `snapshots` 字段会放大丢数据面 | **A11 必须先于 F2 合并** |
| **R3** | B2 若在 B3 之前动 [Report.tsx](file:///workspace/src/components/Report.tsx)/[Workbench.tsx](file:///workspace/src/components/Workbench.tsx) | 无回归网的大规模拆分 | 用 M2 出口条件硬性卡住；B2 每步提交后必须跑 B3 测试 |
| **R4** | 功能开发与安全修复交叉提交 | 同一批次内既改代理又加功能 | M0 与 M3 **不在同一批次**；M0 未合并前不得开 M3 |

---

## 统一验证脚本（每个任务收尾必跑）

```bash
npm run lint        # eslint（M0/A7 后覆盖 JS 与 api/_worker.js）
npm test            # vitest run（M0/A13 后含覆盖率阈值门禁）
npm run build       # tsc -b && vite build（类型错误必须使构建失败）
npm run e2e         # M0/A6 后应可在干净环境直接跑通
```

> 无法用上述命令覆盖的任务（如 A1 的 SSRF 用例、A2 的鉴权用例），**必须**留下对应的 `curl` 或单测证据，写进 PR 描述。

## 未纳入本文件的项

路线 C（C1–C9，低收益低成本）建议**顺手合并进相邻任务**，不单独排期：
`C1` 命名统一、`C2` 删 `shortName` 死分支、`C3` `TH_BASE` 更名、`C4` eslint-disable 注释、`C5` `unitMixWarning` 文案、`C6` a11y 补全、`C7` 同日覆盖补截断、`C8` 播种时间（已并入 F3）、`C9` `baseline` 单遍 reduce。


