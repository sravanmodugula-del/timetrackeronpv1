import type { Request, Response, NextFunction } from 'express';
import type { Session } from 'express-session';

interface SecureSessionRequest extends Request {
  sessionStore: any;
  session: Session & {
    samlAuthenticated?: boolean;
    authTimestamp?: number;
    lastActivity?: number;
    lastRegeneration?: number;
    ipAddress?: string;
    userAgent?: string;
  };
}

// Enhanced session security middleware for FMB enterprise environment
export function sessionSecurityMiddleware() {
  return async (req: SecureSessionRequest, res: Response, next: NextFunction) => {
    // Skip security checks for non-authenticated routes
    if (!req.session || !req.user) {
      return next();
    }

    try {
      const now = Date.now();
      const session = req.session as any;

      // 1. Session tampering detection
      if (session.ipAddress && session.ipAddress !== req.ip) {
        console.log('🚨 [SECURITY] Session IP mismatch detected', {
          sessionIp: session.ipAddress,
          requestIp: req.ip,
          userId: req.user?.userId || req.user?.email,
          sessionId: req.sessionID?.substring(0, 8) + '...'
        });

        // Destroy potentially compromised session
        return req.session.destroy((err) => {
          if (err) console.error('Error destroying compromised session:', err);
          res.status(401).json({ 
            message: 'Session security violation detected',
            reason: 'ip_mismatch',
            action: 'session_terminated'
          });
        });
      }

      // 2. Inactivity timeout check
      const lastActivity = session.lastActivity || session.authTimestamp || now;
      const inactivityTimeout = 2 * 60 * 60 * 1000; // 2 hours

      if (now - lastActivity > inactivityTimeout) {
        console.log('⏰ [SECURITY] Session expired due to inactivity', {
          userId: req.user?.userId || req.user?.email,
          lastActivity: new Date(lastActivity).toISOString(),
          inactiveMinutes: Math.round((now - lastActivity) / (1000 * 60))
        });

        return req.session.destroy((err) => {
          if (err) console.error('Error destroying inactive session:', err);
          res.status(401).json({ 
            message: 'Session expired due to inactivity',
            reason: 'inactivity_timeout',
            action: 'please_reauthenticate'
          });
        });
      }

      // 3. Session aging check (force re-authentication after extended periods)
      const maxSessionAge = 8 * 60 * 60 * 1000; // 8 hours maximum
      const sessionAge = now - (session.authTimestamp || now);

      if (sessionAge > maxSessionAge) {
        console.log('🔄 [SECURITY] Session aged out, requiring re-authentication', {
          userId: req.user?.userId || req.user?.email,
          sessionAgeHours: Math.round(sessionAge / (1000 * 60 * 60))
        });

        return req.session.destroy((err) => {
          if (err) console.error('Error destroying aged session:', err);
          res.status(401).json({ 
            message: 'Session expired - please re-authenticate',
            reason: 'session_aged_out',
            action: 'reauthentication_required'
          });
        });
      }

      // 4. Update activity timestamp
      session.lastActivity = now;

      // 5. Regenerate session ID periodically for enhanced security
      const timeSinceRegeneration = now - (session.lastRegeneration || session.authTimestamp || now);
      const regenerationInterval = 60 * 60 * 1000; // 1 hour

      if (timeSinceRegeneration > regenerationInterval) {
        console.log('🔄 [SECURITY] Regenerating session ID for enhanced security');

        req.session.regenerate((err) => {
          if (err) {
            console.error('Session regeneration failed:', err);
            return next(); // Continue with existing session
          }

          // Preserve critical session data after regeneration
          req.session.samlAuthenticated = true;
          req.session.authTimestamp = session.authTimestamp;
          req.session.lastActivity = now;
          req.session.lastRegeneration = now;
          req.session.ipAddress = req.ip;
          req.session.userAgent = req.get('User-Agent');

          // Re-establish passport user
          req.logIn(req.user, (loginErr) => {
            if (loginErr) {
              console.error('Re-login failed after regeneration:', loginErr);
            }
            next();
          });
        });

        return; // Exit early, next() called in regenerate callback
      }

      // 6. Save session changes
      req.session.save((err) => {
        if (err) {
          console.error('🔴 [SESSION] Failed to save session updates:', err);
        }
        next();
      });

    } catch (error) {
      console.error('🔴 [SECURITY] Session security middleware error:', error);
      next(); // Continue with request despite security check failure
    }
  };
}

// Session activity tracking middleware
export function sessionActivityTracker() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.session && req.user) {
      const session = req.session as any;
      session.lastActivity = Date.now();
      session.requestCount = (session.requestCount || 0) + 1;

      // Track API vs page requests
      if (req.path.startsWith('/api/')) {
        session.lastApiActivity = Date.now();
      }
    }
    next();
  };
}

// Enhanced logout with session cleanup
export function enhancedLogout() {
  return async (req: SecureSessionRequest, res: Response) => {
    const userId = req.user?.userId || req.user?.email;
    const sessionId = req.sessionID;

    console.log('🚪 [AUTH] Enhanced logout initiated', {
      userId,
      sessionId: sessionId?.substring(0, 8) + '...',
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    // Clear all user sessions if requested
    const clearAllSessions = req.query.clearAll === 'true';

    if (clearAllSessions && req.sessionStore && userId) {
      try {
        // Revoke all sessions for this user
        if (typeof req.sessionStore.revokeUserSessions === 'function') {
          const revokedCount = await req.sessionStore.revokeUserSessions(userId);
          console.log(`🔒 [AUTH] Revoked ${revokedCount} sessions for user ${userId}`);
        }
      } catch (error) {
        console.error('🔴 [AUTH] Failed to revoke user sessions:', error);
      }
    }

    // Standard logout process
    req.logout((err) => {
      if (err) {
        console.error('🔴 [AUTH] Logout error:', err);
      }

      if (req.session) {
        req.session.destroy((destroyErr) => {
          if (destroyErr) {
            console.error('🔴 [AUTH] Session destruction error:', destroyErr);
          }

          // Clear the session cookie
          res.clearCookie('fmb.timetracker.sid');

          console.log('✅ [AUTH] Logout completed successfully');
          res.redirect('/');
        });
      } else {
        res.redirect('/');
      }
    });
  };
}