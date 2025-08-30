
import passport from 'passport';
import { Strategy as SamlStrategy } from 'passport-saml';
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

  // Configure SAML strategy
  const samlStrategy = new SamlStrategy(
    {
      issuer: fmbConfig.saml.issuer,
      cert: fmbConfig.saml.cert,
      entryPoint: fmbConfig.saml.entryPoint,
      callbackUrl: fmbConfig.saml.callbackUrl,
      acceptedClockSkewMs: 5000,
      identifierFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
      wantAssertionsSigned: true,
      signatureAlgorithm: 'sha256'
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

        // Create user object for FMB
        const user = {
          userId: email,
          email: email,
          firstName: firstName,
          lastName: lastName,
          id: email
        };

        // Upsert user in database
        await fmbStorage.upsertUser({
          id: email,
          email: email,
          firstName: firstName,
          lastName: lastName,
          profileImageUrl: null
        });

        authLog('INFO', 'User authenticated and stored', { email });
        done(null, user);
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
        // Validate session integrity
        if (!user.isActive) {
          authLog('WARN', 'Inactive user attempted session access', { userId: id });
          return done(null, false);
        }

        // Update last activity timestamp
        await fmbStorage.updateUserLastLogin(id);

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
          role: user.role,
          lastLogin: user.lastLoginAt 
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
        authLog('ERROR', 'SAML authentication error', { error: err.message, info });
        return res.redirect('/login-error');
      }
      
      if (!user) {
        authLog('WARN', 'SAML authentication failed - no user', { info });
        return res.redirect('/login-error');
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
          
          // Mark session for enhanced security monitoring
          req.session.samlAuthenticated = true;
          req.session.authTimestamp = Date.now();
          req.session.ipAddress = req.ip;
          req.session.userAgent = req.get('User-Agent');
          
          authLog('INFO', 'SAML authentication successful with session regeneration', { 
            userId: user.userId || user.email,
            sessionId: req.sessionID?.substring(0, 8) + '...',
            ip: req.ip
          });
          
          // Save session explicitly to ensure persistence
          req.session.save((saveErr) => {
            if (saveErr) {
              authLog('ERROR', 'Session save failed after authentication', { error: saveErr.message });
              return res.redirect('/login-error');
            }
            
            authLog('INFO', 'Session saved successfully, redirecting to application');
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
    authLog('ERROR', 'SAML login error page accessed');
    res.status(401).send(`
      <html>
        <head><title>FMB TimeTracker - Login Error</title></head>
        <body>
          <h1>Authentication Error</h1>
          <p>There was an error during the authentication process.</p>
          <p><a href="/api/login">Try logging in again</a></p>
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

  if (!req.isAuthenticated() || !req.user) {
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
