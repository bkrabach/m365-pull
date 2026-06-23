/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Injected at build time by the Amplifier Online SWA platform (BYO app reg).
  readonly VITE_AZURE_CLIENT_ID: string
  readonly VITE_AZURE_TENANT_ID: string
  // Legacy names kept for local dev via .env.local.
  readonly VITE_MSAL_CLIENT_ID: string
  readonly VITE_MSAL_TENANT_ID: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
