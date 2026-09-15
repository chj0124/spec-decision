/** @type {import('tailwindcss').Config} */
/*
 * ===== 设计令牌总表（「运营指挥中心」大屏风） =====
 * 配色全部走 CSS 变量（index.css :root / html.dark），Tailwind 只负责注册。
 * 改色只动 index.css 的变量值，组件与图表（lib/useChartTheme）随主题自动联动。
 *
 * 暗色（主战场）            亮色（适配）
 * --c-bg     #050A14 深蓝黑  #F4F7FA 冷灰白   页面底
 * --c-panel  #0B1220         #FFFFFF          面板底（一级）
 * --c-panel-2 #0E1830        #F1F5F9          面板底（二级 / 嵌套 / 表头）
 * --c-edge   #1E3048 青调    #D5E0EA          1px 描边
 * --c-brand  #22D3EE 青蓝    #0891B2 深青     主强调 / 数据条 / 激活态
 * --c-brand-strong #38BDF8   #0E7490          hover / 渐变终点
 * --c-pos    #34D399 绿      #059669          正向指标（降幅 / 划算 / 省钱）
 * --c-neg    #F87171 红      #DC2626          负向 / 高危告警
 * --c-warn   #FBBF24 橙      #D97706          中警（过期 / 低置信度 / 提示）
 * --c-text-hi #E6F1FF        #0F1D2E          一级文字
 * --c-text-lo #7D8BA8        #5B6B82          二级文字 / 英文副标
 */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: [
          '"Space Grotesk"',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Noto Sans SC"',
          '"Microsoft YaHei"',
          'system-ui',
          'sans-serif',
        ],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        ink: '#050A14',          // 指挥舱深底（暗色模式页面底 / 深色文字底）
        // panel / edge / brand 全走 CSS 变量，亮暗主题自动切换（见 index.css）
        panel: 'rgb(var(--c-panel) / <alpha-value>)',
        panel2: 'rgb(var(--c-panel-2) / <alpha-value>)',
        edge: 'rgb(var(--c-edge) / <alpha-value>)',
        brand: {
          DEFAULT: 'rgb(var(--c-brand) / <alpha-value>)',
          strong: 'rgb(var(--c-brand-strong) / <alpha-value>)',
          deep: 'rgb(var(--c-brand-deep) / <alpha-value>)',
          soft: 'rgb(var(--c-brand-soft) / <alpha-value>)',
          mist: 'rgb(var(--c-bg) / <alpha-value>)',
        },
        pos: 'rgb(var(--c-pos) / <alpha-value>)',
        neg: 'rgb(var(--c-neg) / <alpha-value>)',
        warn: 'rgb(var(--c-warn) / <alpha-value>)',
        hi: 'rgb(var(--c-text-hi) / <alpha-value>)',
        lo: 'rgb(var(--c-text-lo) / <alpha-value>)',
      },
      boxShadow: {
        glow: '0 0 18px rgba(34, 211, 238, 0.22)',   // 极轻青色发光：仅冠军卡 / 激活态
        card: '0 1px 2px rgba(5, 10, 20, 0.05), 0 8px 30px rgba(5, 10, 20, 0.07)',
        soft: '0 1px 3px rgba(5, 10, 20, 0.06)',
      },
    },
  },
  plugins: [],
}
