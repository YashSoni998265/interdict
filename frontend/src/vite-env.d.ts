/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `mock` (default) serves recorded engine fixtures; `http` calls the real API. */
  readonly VITE_API_MODE?: 'mock' | 'http';
  /** API origin for `http` mode. Empty string means same origin. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
