/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RECOGNIZE_ENDPOINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** 构建期由 vite.config.ts 的 define 注入，值来自 package.json 的 version */
declare const __APP_VERSION__: string
