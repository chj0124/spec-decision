# AI 接力上下文（给下一个改这个项目的 AI 看）

> 你是一个接手本项目的工程师。读完这份文档，你就能直接改代码，不用重新摸索。

## 这是什么

购物规格决策工具：帮用户在多个商品 SKU 间找出最划算的。纯前端，无登录、无后端数据库，2 个页面（工作台 + 报告页）+ 1 个只读分享视图（URL hash 解析，非独立路由）。

## 技术栈与硬约束

- **React 18 + TypeScript + Vite 6 + Tailwind CSS 3** + Framer Motion + Recharts + lucide-react + html-to-image（PNG 导出）
- 数据持久化用 `localStorage`，**不要引入后端 / 数据库 / 登录**
- 页面数**不超过 2 个**（弹窗可以，新页面不行）；分享视图走 hash 路由复用 Report
- 部署双轨：Vercel（`vercel.json` + `api/` 函数）与 Cloudflare Workers（`wrangler.toml` + `_worker.js`，当前在线版）。AI 代理核心 `shared/aiProxyCore.js` 三端共用（vite dev / Vercel / Cloudflare）
- 主题：**暖纸 × 靛蓝**，亮 / 暗双模式。主色 brand `#4f46e5`，暖纸底 `#f6f5f0`，墨黑 `#16161b`（CSS 变量体系见 `src/index.css`，Tailwind 扩展见 `tailwind.config.js`）
- 测试：`npm test`（Vitest，单测在 `*.test.ts` 与源码同目录）+ `npm run e2e`（Playwright 冒烟，`e2e/smoke.mjs` 是提交在库的正式资产，**不是临时脚本**）

## 构建与验证（改完必做）

```bash
npm run build   # tsc -b 类型检查 + vite build，必须通过才算完成
npm test        # vitest 单测（引擎 / 解析 / 存储 / 分享等 12 个文件）
npm run e2e     # 构建后跑 Playwright 冒烟（桌面 1280×900 + 手机 390×844 双视口）
npm run dev     # 开发预览 http://localhost:5173
```

**铁律：功能改完不能只凭 build 通过就交付，要在真实浏览器里验证交互。**

## 架构地图（改哪看哪）

| 你要改的事 | 去哪 |
|---|---|
| 单位换算 / 格式化 / 新鲜度 | `src/lib/engine/util.ts` |
| 单位归一化 / 混单位警告 | `src/lib/engine/units.ts` |
| 口味拆分 / 规格双向解析 / 分组折叠 | `src/lib/engine/spec.ts` |
| 打分 / 升档边际（基准档可选）/ 避坑提示 / 推荐理由 | `src/lib/engine/scoring.ts` |
| 决策简化分簇 / 偏好排序（性价比/得分/预算） | `src/lib/engine/clusters.ts` |
| 价格历史（记录/清洗/涨跌） | `src/lib/engine/history.ts` |
| 决策主入口 `decide()` | `src/lib/engine/decide.ts` |
| 截图识别（视觉模型优先 → 端点兼容 → 演示兜底） | `src/lib/recognize.ts`（+ 可选 `api/recognize.ts`） |
| AI 客户端（OpenAI 兼容） | `src/lib/ai.ts`；代理核心 `shared/aiProxyCore.js` |
| 生僻单位 AI 归一化 | `src/lib/useUnitNormalize.ts` |
| localStorage / 迁移 / 备份 / 写入健康度 | `src/lib/store.ts` |
| 撤销槽（删除 / 导入覆盖，10 秒 TTL） | `src/lib/undo.ts` |
| 只读分享（URL hash 压缩） | `src/lib/share.ts` |
| 粘贴表格解析 | `src/lib/parseTable.ts`；极速录入 `src/lib/quickEntry.ts` |
| 导出 PNG | `src/lib/exportImage.ts` |
| 多清单 / 页面切换 / 主题 / 分享路由 | `src/App.tsx` + `src/components/ScenarioBar.tsx` |
| 工作台（录入/价格历史/权重/识别入口） | `src/components/Workbench.tsx` |
| 识别确认页（可编辑/低置信度/替换 or 追加） | `src/components/RecognizeReview.tsx` |
| 报告页（排名/主视觉+避坑标注/升档卡/导出分享） | `src/components/Report.tsx` |
| AI 配置面板 | `src/components/AiSettings.tsx` |
| 领域模型 | `src/lib/types.ts` |

> 注：引擎曾是单文件 `engine.ts`，已按职责拆成 `src/lib/engine/` 目录，调用方仍以 `from './engine'`（barrel `index.ts`）引用。

## 关键设计决策（不要破坏）

1. **混合 AI 架构**：计算（单价/排名/分簇/边际）一律用规则引擎（确定性，绝不让 AI 算），AI 只做生僻单位换算、截图识别、示例生成、文案。AI 不可用必须回退本地规则，**绝不卡死**。
2. **单位归一化**：所有含量先换算到基准单位（g/ml/cm/个）再算单价，否则 g/kg 混算差千倍。`normalizeUnit()` + `UNIT_TO_BASE`。
3. **双向同步**：规格描述（如"38g×20袋"）与 含量/单位/数量 双向联动。`parseSpec()`/`buildSpec()`，Workbench 和 RecognizeReview 都接了。
4. **决策简化**：同定价因子（quantity×packs×unit×**参数签名**）多口味自动聚合成簇。注意聚类指纹含 paramSignature——参数不同的同规格不会被并簇。
5. **图表同源约束**：报告页避坑连线 / 升档基准档用 `mergeVariantSkus()` 得到的合并集合，必须与主视觉图表同一份数据，否则 pairs 里的 id 在图上找不到横条（见 `decide.ts` 内注释）。
6. **口味拆分**：`parseFlavor()` 把"香辣味 16g×8袋"拆成 口味+规格，用于分组折叠。
7. **报告页懒加载**：Report 用 `lazy + Suspense`，recharts 大包不能进首屏（e2e 有「首屏 modulepreload 不含 charts chunk」的护栏，别破坏 manualChunks 分组）。
8. **版本号注入**：页脚 `v{__APP_VERSION__}` 由 vite define 从 package.json 注入，e2e 动态读取版本号断言；改版本号不需改代码。

## 数据流

```
用户录入/识别/粘贴 → Sku[] (localStorage, 按清单分场景)
  → useUnitNormalize (AI 归一化生僻单位)
  → decide() (engine: 归一化→computeSku→scoreItems→rankByPreference→clusterItems→margins/warnings/reasons)
  → Report 渲染（懒加载）
分享：encodeShare(场景+配置) → URL hash → 打开后 decodeShare → 只读 Report
```

## 环境

- Node 22。依赖安装用淘宝镜像 `--registry=https://registry.npmmirror.com`
- Playwright 浏览器下载（国内）：`PLAYWRIGHT_DOWNLOAD_HOST=https://registry.npmmirror.com/-/binary/playwright npx playwright install chromium`
- AI 密钥：用户在网页"AI 设置"里自己配（OpenAI 兼容协议），存浏览器 localStorage，**不要把密钥写进代码或提交**
- 视觉识别：优先走用户在浏览器配置的视觉模型（直连，经同源代理）；`api/recognize.ts` 端点（`RECOGNIZE_PROVIDER` + 服务端密钥）是兼容路径
- 服务端识别密钥（Vercel 可选）：`DASHSCOPE_API_KEY` 等环境变量，参考 `.env.example`

## 已知边界

- 跨维度单位（g vs L）会比价失真 → 报告页有混杂警告兜底
- 分享链接数据压进 URL，超长（软上限 2000 字符）时提示改走工作区备份文件
- localStorage 写入可能失败（配额/隐私模式）→ PersistIssue 红条提示 + 引导导出备份
