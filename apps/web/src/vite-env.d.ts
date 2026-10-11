/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  /** Название платформы на главной странице; не задано — из словаря (landing.brand). */
  readonly VITE_BRAND_NAME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
