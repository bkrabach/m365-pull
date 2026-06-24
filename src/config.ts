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
  // VITE_MSAL_CLIENT_ID (SPA-consented app, has Teams/Channel Graph scopes)
  // takes precedence over VITE_AZURE_CLIENT_ID (EasyAuth platform app, which
  // only has EasyAuth scopes — NOT the channel Graph scopes). EasyAuth's
  // server-side app is chosen by staticwebapp.config.json's
  // clientIdSettingName="AZURE_CLIENT_ID" (a separate server env var),
  // so this SPA clientId flip is EasyAuth-safe.
  clientId:
    import.meta.env.VITE_MSAL_CLIENT_ID ??
    import.meta.env.VITE_AZURE_CLIENT_ID ??
    "",

  // Directory (tenant) ID — your tenant's GUID.
  // VITE_AZURE_TENANT_ID is injected at build time by the platform; falls back
  // to the legacy VITE_MSAL_TENANT_ID for local dev.
  tenantId:
    import.meta.env.VITE_AZURE_TENANT_ID ??
    import.meta.env.VITE_MSAL_TENANT_ID ??
    "",
}
