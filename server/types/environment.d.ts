
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: 'development' | 'production' | 'test';
      FMB_DEPLOYMENT?: 'onprem' | 'cloud';
      DATABASE_URL?: string;
      SESSION_SECRET?: string;
      FMB_DB_SERVER?: string;
      FMB_DB_DATABASE?: string;
      FMB_DB_USER?: string;
      FMB_DB_PASSWORD?: string;
      FMB_DB_PORT?: string;
      FMB_DB_ENCRYPT?: string;
      FMB_SAML_ENTITY_ID?: string;
      FMB_SAML_SSO_URL?: string;
      FMB_SAML_ACS_URL?: string;
      FMB_SAML_CERT?: string;
    }
  }
}

export {};
