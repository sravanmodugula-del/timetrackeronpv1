import passport from 'passport';
import { Strategy as SamlStrategy } from '@node-saml/passport-saml';
import type { Express } from 'express';
import { getFmbStorage } from '../config/fmb-database.js';
import { getFmbConfig } from '../config/fmb-env.js';

// Enhanced authentication logging
function authLog(level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG', message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const emoji = level === 'ERROR' ? '🔴' : level === 'WARN' ? '🟡' : level === 'INFO' ? '🔵' : '🟢';
  const logMessage = `${timestamp} ${emoji} [FMB-SAML] ${message}`;

  if (data) {
    console.log(logMessage, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
  } else {
    console.log(logMessage);
  }
}

export async function setupFmbSamlAuth(app: Express) {
  authLog('INFO', 'Initializing FMB SAML Authentication');

  const fmbConfig = getFmbConfig();
  const fmbStorage = getFmbStorage();

  // Validate certificate content before using it
  authLog('DEBUG', 'SAML Certificate validation', {
    certLength: fmbConfig.saml.cert.length,
    hasBeginMarker: fmbConfig.saml.cert.includes('-----BEGIN CERTIFICATE-----'),
    hasEndMarker: fmbConfig.saml.cert.includes('-----END CERTIFICATE-----')
  });

  // Configure SAML strategy with proper certificate handling
  const samlStrategy = new SamlStrategy(
    {
      issuer: fmbConfig.saml.issuer,
      cert: fmbConfig.saml.cert, // IDP certificate for signature validation
      entryPoint: fmbConfig.saml.entryPoint,
      callbackUrl: fmbConfig.saml.callbackUrl,
      acceptedClockSkewMs: 10000, // Increase clock skew tolerance
      identifierFormat: fmbConfig.saml.nameIdFormat,
      // Signature validation settings - match your IDP metadata
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: false, // Based on your IDP metadata
      signatureAlgorithm: 'sha256',
      validateInResponseTo: false,
      disableRequestedAuthnContext: true,
      skipRequestCompression: true,
      // Certificate validation
      cert: [fmbConfig.saml.cert], // Ensure cert is in array format
      // Audience should match your SP entity ID, not IDP
      audience: false, // Disable audience validation for now
      // Additional debugging
      additionalParams: {},
      additionalAuthorizeParams: {}
    },
    async (profile: any, done: any) => {
      try {
        authLog('INFO', 'SAML profile received', {
          nameID: profile.nameID,
          email: profile.email || profile.nameID,
          firstName: profile.firstName,
          lastName: profile.lastName
        });

        // Extract user information from SAML profile
        const email = profile.email || profile.nameID;
        const firstName = profile.firstName || profile.givenName || email.split('@')[0];
        const lastName = profile.lastName || profile.surname || '';

        // Upsert user in database first
        const upsertedUser = await fmbStorage.upsertUser({
          id: email,
          email: email,
          first_name: firstName,
          last_name: lastName,
          profile_image_url: null,
          role: 'user',
          organization_id: null,
          department: null
        });

        authLog('INFO', 'User upserted in database', { email });

        // Create session user object
        const sessionUser = {
          ...upsertedUser,
          userId: upsertedUser.id,
          sub: upsertedUser.id
        };

        authLog('INFO', 'User authenticated and stored', { email });
        done(null, sessionUser);
      } catch (error) {
        authLog('ERROR', 'SAML authentication error', error);
        done(error);
      }
    }
  );

  passport.use('saml', samlStrategy);

  // Serialize user for session with enhanced security logging
  passport.serializeUser((user: any, done) => {
    const userId = user.userId || user.email;
    authLog('DEBUG', 'Serializing user for session', {
      userId: userId,
      timestamp: new Date().toISOString(),
      source: 'saml'
    });
    done(null, userId);
  });

  // Deserialize user from session with session validation
  passport.deserializeUser(async (id: string, done) => {
    try {
      const fmbStorage = getFmbStorage();
      const user = await fmbStorage.getUser(id);

      if (user) {
        // Create consistent user object structure with security metadata
        const sessionUser = {
          ...user,
          userId: user.id,
          sub: user.id, // For compatibility with existing routes
          sessionStartTime: Date.now(),
          lastActivity: Date.now()
        };

        authLog('DEBUG', 'User deserialized successfully', {
          userId: id,
          email: user.email
        });

        done(null, sessionUser);
      } else {
        authLog('WARN', 'User not found during deserialization', { userId: id });
        done(null, false);
      }
    } catch (error) {
      authLog('ERROR', 'Error during user deserialization', { userId: id, error: error?.message });
      done(error);
    }
  });

  // Initialize passport
  app.use(passport.initialize());
  app.use(passport.session());

  // SAML routes
  app.get('/api/login', (req, res, next) => {
    authLog('INFO', 'SAML login initiated', { ip: req.ip, userAgent: req.get('User-Agent') });
    passport.authenticate('saml', {
      failureRedirect: '/login-error',
      failureFlash: true
    })(req, res, next);
  });

  app.post('/saml/acs', (req, res, next) => {
    authLog('INFO', 'SAML ACS callback received', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });

    passport.authenticate('saml', (err, user, info) => {
      if (err) {
        authLog('ERROR', 'SAML authentication error', { 
          error: err.message, 
          stack: err.stack,
          info,
          timestamp: new Date().toISOString()
        });
        return res.redirect('/login-error?reason=auth_error');
      }

      if (!user) {
        authLog('WARN', 'SAML authentication failed - no user', { 
          info,
          errorType: 'no_user',
          timestamp: new Date().toISOString()
        });
        return res.redirect('/login-error?reason=no_user');
      }

      // Regenerate session ID after successful SAML authentication (security best practice)
      req.session.regenerate((regenerateErr) => {
        if (regenerateErr) {
          authLog('ERROR', 'Session regeneration failed', { error: regenerateErr.message });
          return res.redirect('/login-error');
        }

        // Log the user in
        req.logIn(user, (loginErr) => {
          if (loginErr) {
            authLog('ERROR', 'Login failed after SAML validation', { error: loginErr.message });
            return res.redirect('/login-error');
          }

          // Set user in session for authentication state
          req.session.user = {
            id: user.id,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            role: user.role,
            organization_id: user.organization_id,
            department: user.department,
            is_active: user.is_active
          };

          // Mark session as authenticated
          req.session.isAuthenticated = true;
          req.session.authTime = Date.now();

          // Save session explicitly
          req.session.save((err) => {
            if (err) {
              console.log('🔴 [FMB-SAML] Session save error:', err);
            } else {
              console.log('🔵 [FMB-SAML] User session established and saved:', user.email);
            }

            // Redirect to root application after successful authentication
            res.redirect('/');
          });
        });
      });
    })(req, res, next);
  });

  app.get('/api/logout', (req, res) => {
    authLog('INFO', 'User logout initiated', { sessionId: req.sessionID });
    req.logout(() => {
      if (req.session) {
        req.session.destroy(() => {
          res.redirect('/');
        });
      } else {
        res.redirect('/');
      }
    });
  });

  // Error handling routes
  app.get('/login-error', (req, res) => {
    const reason = req.query.reason || 'unknown';
    authLog('ERROR', 'SAML login error page accessed', { reason, timestamp: new Date().toISOString() });
    
    let errorMessage = 'There was an error during the authentication process.';
    if (reason === 'auth_error') {
      errorMessage = 'SAML authentication failed. Please check your credentials and try again.';
    } else if (reason === 'no_user') {
      errorMessage = 'Unable to retrieve user information from SAML response.';
    }
    
    res.status(401).send(`
      <html>
        <head><title>FMB TimeTracker - Login Error</title></head>
        <body style="font-family: Arial, sans-serif; margin: 40px; text-align: center;">
          <h1>Authentication Error</h1>
          <p>${errorMessage}</p>
          <p>Error Code: ${reason}</p>
          <p>Time: ${new Date().toISOString()}</p>
          <hr>
          <p><a href="/api/login" style="background: #007cba; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Try logging in again</a></p>
          <p><small>If this error persists, please contact your system administrator.</small></p>
        </body>
      </html>
    `);
  });

  authLog('INFO', 'FMB SAML Authentication setup completed');
}

// Authentication middleware for FMB
export const isAuthenticated = (req: any, res: any, next: any) => {
  authLog('DEBUG', `FMB Authentication check for ${req.method} ${req.path}`, {
    ip: req.ip,
    sessionId: req.sessionID,
    isAuthenticated: req.isAuthenticated ? req.isAuthenticated() : false
  });

  const hasSession = !!req.session;
  const isAuthenticated = hasSession && !!req.session.user && req.session.isAuthenticated === true;

  if (!isAuthenticated) {
    authLog('WARN', 'Unauthorized access attempt', {
      path: req.path,
      method: req.method,
      ip: req.ip,
      sessionId: req.sessionID
    });
    return res.status(401).json({ message: "Unauthorized - Please log in via SAML" });
  }

  authLog('DEBUG', 'FMB Authentication successful', {
    userId: req.user.userId || req.user.email,
    sessionId: req.sessionID
  });

  next();
};