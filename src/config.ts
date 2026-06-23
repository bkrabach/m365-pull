// MSAL configuration sourced from Vite env vars at build time.
//
// Set these in `.env.local` (gitignored). See `.env.example` for the schema
// and README.md "First-time setup" for how to provision your own Entra app
// registration.
//
// These are public values — clientId ships to browsers in every JWT, tenant
// IDs are not secrets — but they DO tie the SPA to a specific Entra app and
// its admin-consented Graph permissions. Forks should use their own.

export const config = {
  // Application (client) ID from your Entra app registration.
  // VITE_AZURE_CLIENT_ID is injected at build time by the Amplifier Online
  // SWA platform (EasyAuth BYO app registration). Falls back to the legacy
  // VITE_MSAL_CLIENT_ID for local dev via .env.local.
  clientId:
    import.meta.env.VITE_AZURE_CLIENT_ID ??
    import.meta.env.VITE_MSAL_CLIENT_ID ??
    "",

  // Directory (tenant) ID — your tenant's GUID.
  // VITE_AZURE_TENANT_ID is injected at build time by the platform; falls back
  // to the legacy VITE_MSAL_TENANT_ID for local dev.
  tenantId:
    import.meta.env.VITE_AZURE_TENANT_ID ??
    import.meta.env.VITE_MSAL_TENANT_ID ??
    "",
}
