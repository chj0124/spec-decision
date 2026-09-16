# SpecPick · 验收与质量门禁清单（checklist.md）

> 配套：[spec.md](file:///workspace/.trae/documents/spec.md)（为什么要做）、[tasks.md](file:///workspace/.trae/documents/tasks.md)（做什么）
> 本文用途：**评审时的检查表**与**合并前的门禁**。每条都必须能勾选；勾不上就不许合并。

---

## 0. 通用门禁（每次 PR 都必须通过）

- [ ] `npm run lint` 零错误（M0/A7 之后，`api/*.js`、`_worker.js`、`shared/*.js` 也必须在 lint 范围内）
- [ ] `npm test` 全绿，且**覆盖率不低于门禁阈值**（M0/A13 之后）
- [ ] `npm run build` 成功；**故意引入类型错误时构建必须失败**（证明 `tsc -b` 真在把关）
- [ ] `npm run e2e` 在**干净环境**（无 Playwright 缓存）可直接跑通
- [ ] 新增/修改的行为**有对应测试**；纯重构则须证明**既有测试零改动仍全绿**
- [ ] 未引入新的 `eslint-disable`；确需使用时，必须写明"为何此处安全"
- [ ] 无 `console.log` 残留（`console.warn`/`error` 用于降级提示者除外）
- [ ] 提交信息引用任务 ID（如 `fix(security): A1 代理白名单`）

---

## 1. M0 · 止血验收（路线 A）

### 1.1 安全（S1–S3，**最高优先级**）
- [ ] **A1** `shared/aiProxyCore.js` 的 SSRF 用例全部拒绝：`169.254.169.254`、`127.0.0.1`、`10.0.0.0/8`、`172.16/12`、`192.168/16`、`file://`、`gopher://` 均返回 400
- [ ] **A1** 客户端**无法**再任意指定 `baseUrl`；未知主机返回 403
- [ ] **A2** 未鉴权请求 `/api/recognize` 返回 **401**；超大 body 返回 **413**；上游异常不再 500 裸抛
- [ ] **A2** 已就"是否直接下线 `/api/recognize`"给出**明确结论**并记录理由（不允许"先放着"）
- [ ] **A3** 跨域预检响应**不再**含 `Access-Control-Allow-Origin: *`
- [ ] **A4** 代理端全链路**无 body 日志**（`grep` 佐证）；`.env.example` 齐全；密钥中转文案与真实链路一致
- [ ] **A5** 三入口均有 body 上限 + 超时（超时返回 504）
- [ ] **A4/隐私** 文案"数据不上传"与实现无矛盾（key 经代理转发这一点已如实说明）

### 1.2 工程质量（D4/D5/D13/D14/D20）
- [ ] **A6** CI（`.github/workflows/ci.yml`）已建，lint/test/build/e2e 为独立 job 且首次全绿
- [ ] **A6** `e2e` 脚本自带浏览器安装，干净环境可跑
- [ ] **A7** `npx eslint --print-config _worker.js` 规则数 > 0
- [ ] **A7** 新增 `tsconfig.node.json`，`api/` 与 `_worker.js` 纳入类型检查
- [ ] **A15** `chunkSizeWarningLimit` 阈值生效；CI 记录首屏体积基线
- [ ] **A15** `.gitignore` 已收紧；补 `engines` 与 `.nvmrc`

### 1.3 代码质量与性能（A8–A12）
- [ ] **A8** 5 处 `setTimeout` 全部清理；`Workbench` 窗口监听器不再随输入重挂（依赖去掉 `[skus]`）
- [ ] **A9** 10 万行输入不抛 `RangeError`（`parseTable` 求最大列数改循环；`scoring`/`clusters` 去展开运算）
- [ ] **A10** `ACTIVE_KEY` 僵尸键已删除；`saveWorkspace` 只写 `spec-decision:workspace`
- [ ] **A11** 损坏 JSON 时**原键不被覆盖**，且备份写入 `spec-decision:corrupt-backup`
- [ ] **A12** 父组件 state 变化时图表不再重渲染（Profiler 佐证）

### 1.4 测试与文档（A13/A14）
- [ ] **A13** 新增 `share.test.ts` / `parseTable.test.ts` / `clusters.test.ts`；覆盖率报告落盘且门禁生效
- [ ] **A14** README 测试数 = 实际文件数（11）；[TechnicalArchitecture.md](file:///workspace/.trae/documents/TechnicalArchitecture.md) 按实际重写
- [ ] **A14** `grep -rn "zustand\|react-router" .trae/ README.md` 为空
- [ ] **A14** [PRD.md](file:///workspace/.trae/documents/PRD.md) 配色改为实际靛蓝主题（`#4f46e5` / `--c-brand-*`）

**M0 总出口**：`lint + test + build + e2e` 全绿 **且** `npm audit` 无 critical/high **且** 安全三项 S1/S2/S3 关闭。

---

## 2. M1 · 地基验收

- [ ] **B1①** 另一标签页修改后，本页出现"已修改，载入？"提示条
- [ ] **B1②** 双标签页各改一次、来回切换后，**两边改动都保留**
- [ ] **B1②** 并发写入不会静默覆盖（有并发单测佐证）
- [ ] **B4** `grep -rn "from '../ai'" src/lib/engine/` 为空；engine 层单测**无需 mock 网络**
- [ ] **B4** barrel 导出面收敛，且注释写明"engine 不得引入 IO"约束
- [ ] **B5** 全局错误 `error`/`unhandledrejection` 已捕获并在平台可见
- [ ] **B5** 上报载荷**不含** `params`/`price`/`apiKey`/SKU 名称等业务数据（单测断言）

---

## 3. M2 · 回归网验收

- [ ] **B3** 组件测试覆盖 5 条关键交互：分享菜单开合/复制反馈、分组折叠、预算输入、识别确认流、撤销 toast
- [ ] **B3** `npm test -- --coverage` 中 `src/components` 有非零覆盖
- [ ] **B2①** `lib/view-model/` 纯函数已抽出并有单测
- [ ] **B2②** `FLAVOR_COLORS` 全仓**仅剩 1 处**定义
- [ ] **B2③** `Report.tsx` 与 `Workbench.tsx` 均 **< 400 行**
- [ ] **B2** 拆分全程 B3 测试**零改动**通过（证明是纯重构，未改行为）

---

## 4. 功能验收（M3）

| 功能 | 验收检查点 |
|---|---|
| **F3 价格助理** | [ ] `priceStats` 返回 min/max/avg/分位/是否最低，且有单测<br>[ ] `PricePositionBadge` 在高于均价/接近最低时有正确文案<br>[ ] `price <= targetPrice` 触发提示<br>[ ] 老数据播种时间改用 `s.updatedAt ?? now`（不再误判"刚更新"） |
| **F7 首启引导** | [ ] 清空 localStorage 后首屏可见两条路径 + 3 步说明<br>[ ] `generateExample()` 的 `source`（ai/fallback）与 `summary` 对用户可见 |
| **F6 数据可靠性** | [ ] 自动草稿在崩溃/关闭后可恢复<br>[ ] 与 B1 并发用例共用一套断言 |
| **F4 撤销/重做** | [ ] 连续编辑 3 次可逐步撤回、再逐步重做<br>[ ] `Ctrl/Cmd+Z`、`Ctrl/Cmd+Shift+Z` 生效<br>[ ] 删除清单仍可撤销（与既有 [undo.ts](file:///workspace/src/lib/undo.ts) 语义兼容） |
| **F2 快照/Diff** | [ ] `Workspace.snapshots[]` 迁移在老数据上正确补默认值（有单测）<br>[ ] 快照有上限，localStorage 不被撑爆<br>[ ] `diffSnapshots` 正确识别"最优项变更/单价变化" |
| **F1 对比视图** | [ ] 两份清单并排，单价差/得分差/最优项易位高亮<br>[ ] 不影响"≤2 页"约束（只读视图，非新增路由页）<br>[ ] 首屏包体积**无增长** |
| **F5 导出增强** | [ ] 分页长图可导出；PDF 打印无工具条<br>[ ] `html-to-image` 仍为动态 import，**不进首屏**（`npm run build` 佐证） |

---

## 5. 性能与体积门禁

- [ ] 首屏 JS（gzip）体积**不回归**（M0 基线：约 171 KB；对比 CI 快照）
- [ ] `charts` 与 `html-to-image` 保持懒加载 / 动态 import，不进入首屏 chunk
- [ ] 新增依赖前先评估：能复用现有库（Recharts/lucide/html-to-image）就不新引
- [ ] 长列表/大表格操作无明显卡顿（10 万行解析不崩、不假死）

---

## 6. 发布前（Deploy）检查

- [ ] Vercel（[vercel.json](file:///workspace/vercel.json) + `api/`）与 Cloudflare（[wrangler.toml](file:///workspace/wrangler.toml) + [_worker.js](file:///workspace/_worker.js)）**两条部署路径都验证过**
- [ ] 环境变量（`.env.example` 所列）在两个平台均已配置，且**未提交任何真实密钥**
- [ ] 版本注入正常（用户不会卡在旧版本缓存）
- [ ] 分享链接（URL hash）在新版本下仍能正确解码，且**不携带价格历史**（保持分享体积与隐私）
- [ ] 回滚方案可用（上一版本可快速恢复）

---

## 7. 明确"不做"（防止反复讨论）

- [ ] React 19 / Tailwind 4 / Vite 8 / TS 7 的 major 升级 —— 等 B2/B3 完成后另议
- [ ] 引入后端 / 数据库 / 账号体系 —— 与产品硬约束冲突（[AI_CONTEXT.md:12](file:///workspace/AI_CONTEXT.md#L12)）
- [ ] 为"补齐文档所述技术栈"而引入 react-router / Zustand —— 应改文档，不改代码
- [ ] 对 `charts` 再做分块细化 —— 已是懒加载、首屏外资源

---

## 8. 评审签署

| 角色 | 关注清单 | 结论 |
|---|---|---|
| 技术负责人 | 第 0–3 节（门禁/安全/架构顺序纪律） | ☐ 通过 / ☐ 打回 |
| 安全 | 第 1.1 节 + R1 风险卡 | ☐ 通过 / ☐ 打回 |
| 产品 | 第 4 节（功能验收）+ spec.md 第二部分优先级 | ☐ 通过 / ☐ 打回 |
| 工程效能 | 第 1.2 节 + 第 5 节 + 第 6 节 | ☐ 通过 / ☐ 打回 |
