# 规格决策台 · Spec Decision

帮你在多个商品规格（SKU）之间，快速挑出**最划算**的那一个。

> 在线体验：<https://spec-decision.1663884773.workers.dev/>

面对「16g×8袋 vs 16g×16袋」不知道买哪个？把价格和含量填进来，自动算每单位多少钱，并结合附加参数给出推荐、边际效益与避坑提示。支持截图识别、表格粘贴、价格历史追踪与只读分享。

## 功能

### 录入与数据

| 模块 | 说明 |
|------|------|
| 规格录入 | 名称、总价、单件含量、单位、件数（袋数）、多维加分参数（如电池 mAh）及权重，规格描述与结构化字段双向同步 |
| 多清单管理 | 多份互相独立的清单切换 / 新建 / 重命名 / 删除，删除可 10 秒内撤销 |
| 工作区备份 | 整份工作区一键导出 / 导入 JSON，换机不丢数据；导入前有覆盖确认 |
| 写入失败可见 | localStorage 写入失败（配额满 / 被禁）时红条提示原因并引导导出备份，不再静默丢数据 |
| AI 截图识别 | 上传 / 拖拽 / 粘贴截图，走你配置的视觉模型真实识别（OpenAI 兼容多模态），低置信度黄色高亮，可改 / 删 / 增后入库 |
| 表格粘贴导入 | 直接 Ctrl+V 粘贴 Excel / 电商页面 / Markdown 表格，自动识别价格、规格、参数列 |
| 极速录入 | 一行一条规格文本批量转 SKU，支持复合件数连乘（`300ml*12瓶*2箱`）与从商品标题自动挑价格 |
| AI 生成示例 | 配了 AI 按随机品类实时生成示例；未配置回退 4 套内置真实商品模板（含价格抖动） |

### 分析与决策

| 模块 | 说明 |
|------|------|
| 单位价格 | 自动换算 `总价 ÷ (单件含量 × 件数)`，含公制 / 市制 / 英制单位归一化，生僻单位可交 AI 归一 |
| 综合推荐 | 价格分 × 价格权重 + 各参数维度分 × 参数权重；决策偏好三档：性价比 / 综合得分 / 预算（超预算排除项显式列出） |
| 偏好动态提示 | 未配置有差异的参数维度时提示「切换偏好不会改变排名」；配置后显示价格 / 参数权重侧重 |
| 升档值不值 | 多花 / 多得 / 净省（白赚）五级结论卡；基准档可选（默认逐档相邻对比，也可固定某档为基准） |
| 避坑提示 | 自动识别「加价又加价率」、智商税规格、过度囤货；图上标注三合一（行高亮 + 差值段 + 右缘括线），编号旁直接写明结论 |
| 决策简化 | 把「3口味×4款式」这类仅干扰维度不同的规格按定价因子聚合，12 选 1 降维成 4 选 1，簇内再挑口味 |
| 价格历史 | 每次改价自动记录（同日合并、上限 30 条），行上显示涨跌徽标，报告页冠军卡提示涨价 / 降价 |
| 数据新鲜度 | 价格超 30 天未更新时在工作台与报告页同时标黄提醒「结论可能过期」 |

### 图表与导出

| 模块 | 说明 |
|------|------|
| 图表对比 | 主视觉四种编码（单价 / 每 100 元买到多少 / 性价比象限 / 省下多少钱）+ 多维能力雷达图，亮暗主题自适应 |
| 导出 / 分享 | 一个下拉收齐四件套：导出 PNG、打印 / 存 PDF、复制文字摘要、复制只读分享链接（数据压缩进 URL，无服务器） |
| PWA 离线 | manifest + Service Worker，网络优先、离线回退缓存，可装到桌面 / 主屏 |

## 特性

- 暖纸 × 靛蓝编辑风，亮 / 暗主题一键切换（图表配色随主题自适应）
- 纯前端，数据存浏览器 `localStorage`，不上传任何信息；AI 密钥也只存在浏览器
- 手机 / 电脑响应式，报告页懒加载（recharts 大包不进首屏）
- 无登录注册，仅 2 个页面（工作台 + 报告页）+ 一个只读分享视图

## 技术栈

React 18 + TypeScript + Vite 6 + Tailwind CSS 3 + Framer Motion + Recharts + lucide-react + html-to-image

测试：Vitest（单元，15 个测试文件，含覆盖率阈值门禁）+ Playwright（e2e 冒烟，双视口）

## 本地开发

```bash
npm install        # 国内可用 --registry=https://registry.npmmirror.com
npm run dev        # 开发预览
npm test           # 单元测试（vitest + 覆盖率门禁，报告落盘 coverage/）
npm run build      # 生产构建（tsc + vite）→ dist/
npm run preview    # 预览构建产物
npm run e2e        # 构建后跑 Playwright 冒烟（桌面 + 手机两视口）
npm run lint       # ESLint
```

## 部署

双轨部署，任选其一；AI 代理核心（`shared/aiProxyCore.js`）为三端（vite dev / Vercel / Cloudflare）共用。

### Cloudflare Workers（当前在线版）

1. `npm run build` 产出 `dist/`
2. `wrangler deploy`（`wrangler.toml` 已配置：`_worker.js` 接管 `/api/*` 代理 + 静态资源 SPA 回退）

### Vercel

1. 把本仓库推到 Git，在 Vercel 中 **Import Project**，框架选 **Vite**
2. 构建命令 `npm run build`，输出目录 `dist`（`vercel.json` 已预置）
3. 可选环境变量：`RECOGNIZE_PROVIDER`（qwen / glm / openai / gemini）及对应密钥（如 `DASHSCOPE_API_KEY`），启用服务端视觉识别端点

## 目录结构

```
src/
├── App.tsx                    # 应用入口：页面切换 / 多清单 / 主题 / 分享路由 / 撤销与告警条
├── components/
│   ├── Workbench.tsx          # 工作台页（录入 / 价格历史 / 维度权重 / 识别与粘贴入口 / 极速录入）
│   ├── RecognizeReview.tsx    # 识别确认页（可编辑 / 低置信度高亮 / 替换 or 追加导入）
│   ├── Report.tsx             # 报告页（排名 / 主视觉+避坑标注 / 升档卡 / 导出分享下拉）
│   ├── AiSettings.tsx         # AI 配置面板（多服务商预设 / 测试连接 / 模型列表）
│   ├── ScenarioBar.tsx        # 多清单条（切换 / 新建 / 重命名 / 删除 / 工作区备份）
│   └── WeightPie.tsx          # 权重分布环形图（内联 SVG，刻意不引 recharts）
└── lib/
    ├── types.ts               # 领域模型（Sku / ComputedSku / SkuCluster / MarginInsight / DecisionConfig）
    ├── engine/                # 计算引擎（由单文件 engine.ts 按职责拆分）
    │   ├── util.ts            # round / fmt / 单位展示换算 / 新鲜度（STALE_DAYS）
    │   ├── units.ts           # 单位归一化（公制/市制/英制大表）+ AI 归一化 + 混单位警告
    │   ├── spec.ts            # 口味/规格拆分、分组折叠、规格描述双向解析
    │   ├── scoring.ts         # 打分 / 升档边际（基准档可选） / 避坑提示 / 推荐理由
    │   ├── clusters.ts        # 决策简化分簇 + 偏好排序（性价比 / 得分 / 预算过滤）
    │   ├── history.ts         # 价格历史（记录 / 清洗 / 涨跌走势）
    │   ├── decide.ts          # 主入口 decide(skus, config) → DecisionResult
    │   └── *.test.ts          # 引擎单测
    ├── ai.ts                  # AI 客户端（OpenAI 兼容，密钥存浏览器，经同源代理转发）
    ├── recognize.ts           # 截图识别（视觉模型优先 → 端点兼容 → 演示兜底）
    ├── parseTable.ts          # 粘贴表格解析（TSV / HTML / Markdown → SKU）
    ├── quickEntry.ts          # 极速录入（一行一条 → SKU，复合件数连乘）
    ├── share.ts               # 只读分享（URL hash 压缩，无服务器）
    ├── store.ts               # localStorage 持久化 + v1→v2 迁移 + 备份 + 写入健康度
    ├── undo.ts                # 撤销槽（删除 / 导入覆盖，10 秒 TTL）
    ├── exportImage.ts         # 报告导出 PNG（html-to-image 按需加载）
    ├── aiSample.ts            # AI 生成示例（含内置模板兜底）
    ├── useUnitNormalize.ts    # 生僻单位 AI 归一化 hook
    └── useChartTheme.ts       # 图表主题 hook（亮 / 暗自适应配色）
api/
├── recognize.ts               # Vercel Edge 视觉识别端点（可选，四服务商）
├── ai-chat.js                 # Vercel Serverless AI 对话代理
└── ai-models.js               # Vercel Serverless 模型列表代理
shared/
└── aiProxyCore.js             # AI 代理核心（vite dev / Vercel / Cloudflare 三端共用）
e2e/                           # Playwright 冒烟测试（双视口，含版本号与 PNG 导出校验）
_worker.js                     # Cloudflare Worker（API 代理 + 静态资源回退）
```
