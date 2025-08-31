
import { Router } from 'express';
import { getFmbConfig } from '../../fmb-onprem/config/fmb-env.js';

const router = Router();

// SAML configuration debug endpoint (admin only)
router.get('/debug/saml-config', (req, res) => {
  try {
    const fmbConfig = getFmbConfig();
    
    const debugInfo = {
      timestamp: new Date().toISOString(),
      samlConfig: {
        issuer: fmbConfig.saml.issuer,
        entryPoint: fmbConfig.saml.entryPoint,
        callbackUrl: fmbConfig.saml.callbackUrl,
        nameIdFormat: fmbConfig.saml.nameIdFormat,
        certLength: fmbConfig.saml.cert?.length || 0,
        certValid: fmbConfig.saml.cert?.includes('-----BEGIN CERTIFICATE-----') && 
                   fmbConfig.saml.cert?.includes('-----END CERTIFICATE-----')
      },
      environment: {
        nodeEnv: process.env.NODE_ENV,
        deployment: process.env.FMB_DEPLOYMENT
      }
    };

    res.json(debugInfo);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to retrieve SAML debug info',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
