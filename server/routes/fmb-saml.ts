
/**
 * FMB On-Premises SAML Routes
 */

import { Router } from 'express';
import passport from 'passport';
import { getFmbSamlMetadata } from '../../fmb-onprem/auth/fmb-saml-auth.js';

const router = Router();

// SAML metadata endpoint
router.get('/saml/metadata', (req, res) => {
  try {
    const metadata = getFmbSamlMetadata();
    res.set('Content-Type', 'application/xml');
    res.send(metadata);
  } catch (error) {
    console.error('🔴 [FMB-SAML] Failed to generate metadata:', error);
    res.status(500).json({ error: 'Failed to generate SAML metadata' });
  }
});

// SAML SSO initiation (if needed for SP-initiated flow)
router.get('/saml/login', passport.authenticate('fmb-saml'));

// SAML Assertion Consumer Service (ACS)
router.post('/saml/acs', 
  passport.authenticate('fmb-saml', { 
    failureRedirect: '/login-error',
    successRedirect: '/'
  })
);

// Logout endpoint
router.post('/saml/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      console.error('🔴 [FMB-SAML] Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    
    req.session.destroy((err) => {
      if (err) {
        console.error('🔴 [FMB-SAML] Session destruction error:', err);
      }
      res.redirect('/');
    });
  });
});

export default router;
