
// FMB On-Premises Authentication Module Exports

export * from './types';
export * from './permissions';  
export * from './authorization';
export * from './middleware';

// Export FMB SAML authentication functions
export { setupFmbSamlAuth, isAuthenticated } from '../../fmb-onprem/auth/fmb-saml-auth';

// Main authentication check for FMB
export { isAuthenticated as requireAuth } from '../../fmb-onprem/auth/fmb-saml-auth';
