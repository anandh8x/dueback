/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ARC_RPC_URL?: string;
  readonly VITE_ARC_EXPLORER_URL?: string;
  readonly VITE_ORGANIZATION_REGISTRY_ADDRESS?: string;
  readonly VITE_DUEBACK_CAMPAIGNS_ADDRESS?: string;
  readonly VITE_FEATURED_CAMPAIGN_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
