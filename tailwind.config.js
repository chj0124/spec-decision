/** @type {import('tailwindcss').Config} */
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
        // 暖纸 × 靛蓝（editorial paper & indigo）
        ink: '#16161b',          // 墨黑（暗色模式底 / 深色遮罩）
        // panel / edge 走 CSS 变量，亮暗主题自动切换（见 index.css :root / html.dark）
        panel: 'rgb(var(--c-panel) / <alpha-value>)',
        edge: 'rgb(var(--c-edge) / <alpha-value>)',
        brand: {
          DEFAULT: '#4f46e5',    // 靛蓝主色（交互 / 强调）
          strong: '#4338ca',     // 深靛蓝（hover / 强调）
          // deep 走 CSS 变量：浅色模式为深靛文字，暗色模式自动变亮
          deep: 'rgb(var(--c-brand-deep) / <alpha-value>)',
          // soft 走 CSS 变量：浅色为浅靛底，暗色为暗靛底
          soft: 'rgb(var(--c-brand-soft) / <alpha-value>)',
          mist: '#f6f5f0',       // 暖纸（浅色模式页面底）
        },
      },
      boxShadow: {
        glow: '0 4px 24px rgba(79, 70, 229, 0.18)',
        card: '0 1px 2px rgba(22, 22, 27, 0.04), 0 8px 30px rgba(22, 22, 27, 0.06)',
        soft: '0 1px 3px rgba(22, 22, 27, 0.05)',
      },
    },
  },
  plugins: [],
}
