/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RECOGNIZE_ENDPOINT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
