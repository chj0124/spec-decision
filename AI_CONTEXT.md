# AI 接力上下文（给下一个改这个项目的 AI 看）

> 你是一个接手本项目的工程师。读完这份文档，你就能直接改代码，不用重新摸索。

## 这是什么

购物规格决策工具：帮用户在多个商品 SKU 间找出最划算的。纯前端，无登录、无后端数据库，仅 2 个页面（工作台 + 报告页）。

## 技术栈与硬约束

- **React 18 + TypeScript + Vite 5 + Tailwind CSS 3** + Framer Motion + Recharts + lucide-react
- 数据持久化用 `localStorage`，**不要引入后端 / 数据库 / 登录**
- 页面数**不超过 2 个**（弹窗可以，新页面不行）
- 部署到 Vercel（`vercel.json` 已配好，SPA 重写到 index.html）
- 主题：浅色薄荷绿为主（参考 Laper），另有深色模式。主色 brand `#16a34a`

## 构建与验证（改完必做）

```bash
npm run build   # tsc -b 类型检查 + vite build，必须通过才算完成
npm run dev     # 开发预览 http://localhost:5173
```

**铁律：功能改完不能只凭 build 通过就交付，要在真实浏览器里验证交互。** 项目已装 Playwright，可写 e2e 脚本实测（参考下方"测试"）。

## 架构地图（改哪看哪）

| 你要改的事 | 去哪 |
|---|---|
| 比价 / 打分 / 边际效益 / 分簇 / 单位换算 | `src/lib/engine.ts` |
| 截图识别（视觉模型 + 演示兜底） | `src/lib/recognize.ts` + `api/recognize.ts` |
| AI 客户端（OpenAI 兼容，单位换算/文案） | `src/lib/ai.ts` |
| 生僻单位 AI 归一化 | `src/lib/useUnitNormalize.ts` |
| localStorage 读写 / 示例数据 | `src/lib/store.ts` |
| 领域模型（Sku / ComputedSku / SkuCluster） | `src/lib/types.ts` |
| 工作台（表格录入/拖拽/分组折叠/双向同步） | `src/components/Workbench.tsx` |
| 识别确认页（可编辑/双向同步/低置信度） | `src/components/RecognizeReview.tsx` |
| 报告页（排名/推荐/边际/避坑/图表/簇化简） | `src/components/Report.tsx` |
| AI 配置面板 | `src/components/AiSettings.tsx` |

## 关键设计决策（不要破坏）

1. **混合 AI 架构**：计算（单价/排名/分簇）一律用规则引擎（确定性，绝不让 AI 算），AI 只做生僻单位换算、截图识别、文案润色。AI 不可用必须回退本地规则，**绝不卡死**。
2. **单位归一化**：所有含量先换算到基准单位（g/ml/cm/个）再算单价，否则 g/kg 混算差千倍。`normalizeUnit()` + `UNIT_TO_BASE`。
3. **双向同步**：规格描述（如"38g×20袋"）与 含量/单位/数量 双向联动，改一边另一边自动更新。`parseSpec()`/`buildSpec()`，Workbench 和 RecognizeReview 都接了。
4. **决策简化**：同定价因子（quantity×packs×unit）多口味自动聚合成簇，12选1 降维成 4选1。`clusterItems()`。
5. **口味拆分**：`parseFlavor()` 把"香辣味 16g×8袋"拆成 口味+规格，用于分组折叠。

## 数据流

```
用户录入/识别 → Sku[] (localStorage)
  → useUnitNormalize (AI 归一化生僻单位)
  → decide() (engine: 归一化→computeSku→scoreItems→clusterItems→margins/warnings/reasons)
  → Report 渲染
```

## 测试

- 逻辑验证：把 engine 的纯函数抽出来用 node 跑（如 `node -e` 或临时 .mjs，**用完删掉**）
- 交互验证：项目已装 Playwright + Chromium，写 e2e 脚本在真实浏览器点（清 localStorage → 注入数据 → 断言）。临时脚本放项目根目录，验证完删除。
- 浏览器下载（国内）：`PLAYWRIGHT_DOWNLOAD_HOST=https://registry.npmmirror.com/-/binary/playwright npx playwright install chromium`

## 环境

- Node 22。依赖安装用淘宝镜像 `--registry=https://registry.npmmirror.com`
- AI 密钥：用户在网页"AI 设置"里自己配（OpenAI 兼容协议），存浏览器 localStorage，**不要把密钥写进代码或提交**
- 视觉识别（可选）：Vercel Serverless 走 `DASHSCOPE_API_KEY` 环境变量

## 已知边界

- 截图识别默认演示数据（除非配了视觉端点）
- 跨维度单位（g vs L）会比价失真 → 报告页有混杂警告兜底
