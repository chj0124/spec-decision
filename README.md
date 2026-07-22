# 规格决策台 · Spec Decision

帮你在多个商品规格（SKU）之间，快速挑出**最划算**的那一个。

> 在线体验：<https://spec-decision.1663884773.workers.dev/>

面对「16g×8袋 vs 16g×16袋」不知道买哪个？把价格和含量填进来，自动算每单位多少钱，并结合附加参数给出推荐、边际效益与避坑提示。

## 功能

| 模块 | 说明 |
|------|------|
| 规格录入 | 名称、总价、单件含量、单位、件数（袋数）、可选加分参数（如电池 mAh）及权重 |
| 单位价格 | 自动换算 `总价 ÷ (单件含量 × 件数)`，如 4.94 ÷ (16×8) = ¥0.0386/g |
| 综合推荐 | 性价比 + 加分参数加权打分，标出第 1 名并给出推荐理由 |
| 边际效益 | 以单价最低者为基准，分析多花 X 元多买 Y 量、单价降 Z% 是否值得 |
| 避坑提示 | 自动识别「加价又加价率」、过度囤货、智商税规格 |
| 决策简化 | 把「3口味×4款式」这类仅干扰维度不同的规格按定价因子聚合，12 选 1 降维成 4 选 1，簇内再挑口味 |
| AI 截图识别 | 上传 / 拖拽 / 粘贴截图识别规格与价格，识别后进入可编辑确认列表，支持手动修正（可接真实多模态模型） |
| 图表对比 | 单价柱状图 + 多维能力雷达图（随简化/全量视图联动） |

## 特性

- 深色科技风，亮 / 暗主题一键切换
- 纯前端，数据存浏览器 `localStorage`，不上传任何信息
- 手机 / 电脑响应式，均可用
- 无登录注册、无后端数据库，仅 2 个页面（工作台 + 报告页）

## 技术栈

React 18 + TypeScript + Vite 5 + Tailwind CSS 3 + Framer Motion + Recharts + lucide-react

## 本地开发

```bash
npm install        # 国内可用 --registry=https://registry.npmmirror.com
npm run dev        # 开发预览
npm run build      # 生产构建（tsc + vite）→ dist/
npm run preview    # 预览构建产物
```

## 部署到 Vercel

1. 把本目录推送到 Git 仓库（GitHub / GitLab 均可）
2. 在 Vercel 中 **Import Project**，框架选 **Vite**
3. 构建命令 `npm run build`，输出目录 `dist`（`vercel.json` 已预置，无需手改）
4. Deploy 即可

> 也可以本地 `npm i -g vercel` 后，在项目根目录运行 `vercel` 一键部署。

## 目录结构

```
src/
├── App.tsx                 # 应用入口 / 路由 / 主题
├── components/
│   ├── Workbench.tsx       # 工作台页（规格录入）
│   └── Report.tsx          # 报告页（排名/推荐/边际/避坑/图表）
└── lib/
    ├── types.ts            # 领域模型
    ├── engine.ts           # 计算引擎（换算/打分/边际/避坑）
    └── store.ts            # localStorage 持久化 + 示例数据
```
