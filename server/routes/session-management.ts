
import { Router } from 'express';
import type { Express } from 'express';
import { isAuthenticated } from '../../fmb-onprem/auth/fmb-saml-auth.js';

const router = Router();

function extractUserId(user: any): string {
  return user.userId || user.email || user.id;
}

export function registerSessionManagementRoutes(app: Express) {
  // Admin-only session management endpoints
  
  // Get session statistics
  app.get('/api/admin/sessions/stats', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const storage = await import('../storage.js').then(m => m.getStorage());
      const user = await storage.getUser(userId);
      
      if (user?.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
      }

      if (req.sessionStore && typeof req.sessionStore.getSessionMetrics === 'function') {
        const metrics = await req.sessionStore.getSessionMetrics();
        res.json(metrics);
      } else {
        res.status(501).json({ message: 'Session metrics not available' });
      }
    } catch (error) {
      console.error('Error getting session stats:', error);
      res.status(500).json({ message: 'Failed to get session statistics' });
    }
  });

  // Get active sessions
  app.get('/api/admin/sessions/active', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const storage = await import('../storage.js').then(m => m.getStorage());
      const user = await storage.getUser(userId);
      
      if (user?.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
      }

      const { userId: filterUserId } = req.query;

      if (req.sessionStore && typeof req.sessionStore.getActiveSessions === 'function') {
        const sessions = await req.sessionStore.getActiveSessions(filterUserId);
        res.json(sessions);
      } else {
        res.status(501).json({ message: 'Active sessions not available' });
      }
    } catch (error) {
      console.error('Error getting active sessions:', error);
      res.status(500).json({ message: 'Failed to get active sessions' });
    }
  });

  // Revoke user sessions
  app.post('/api/admin/sessions/revoke/:targetUserId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = extractUserId(req.user);
      const storage = await import('../storage.js').then(m => m.getStorage());
      const user = await storage.getUser(userId);
      
      if (user?.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
      }

      const { targetUserId } = req.params;

      if (req.sessionStore && typeof req.sessionStore.revokeUserSessions === 'function') {
        const revokedCount = await req.sessionStore.revokeUserSessions(targetUserId);
        
        console.log(`🔒 [ADMIN] ${userId} revoked ${revokedCount} sessions for user ${targetUserId}`);
        
        res.json({
          message: `Successfully revoked ${revokedCount} sessions`,
          revokedCount,
          targetUserId
        });
      } else {
        res.status(501).json({ message: 'Session revocation not available' });
      }
    } catch (error) {
      console.error('Error revoking sessions:', error);
      res.status(500).json({ message: 'Failed to revoke sessions' });
    }
  });

  // Extend current session
  app.post('/api/sessions/extend', isAuthenticated, async (req: any, res) => {
    try {
      const { additionalMinutes = 60 } = req.body;
      
      if (req.sessionStore && typeof req.sessionStore.extendSession === 'function') {
        const extended = await req.sessionStore.extendSession(req.sessionID, additionalMinutes);
        
        if (extended) {
          console.log(`⏱️ [SESSION] User extended their session by ${additionalMinutes} minutes`);
          res.json({ 
            message: 'Session extended successfully',
            additionalMinutes,
            newExpiry: new Date(Date.now() + (additionalMinutes * 60 * 1000))
          });
        } else {
          res.status(404).json({ message: 'Session not found or already expired' });
        }
      } else {
        res.status(501).json({ message: 'Session extension not available' });
      }
    } catch (error) {
      console.error('Error extending session:', error);
      res.status(500).json({ message: 'Failed to extend session' });
    }
  });

  // Get current session info
  app.get('/api/sessions/current', isAuthenticated, async (req: any, res) => {
    try {
      const session = req.session as any;
      
      res.json({
        sessionId: req.sessionID?.substring(0, 8) + '...',
        authTimestamp: session.authTimestamp,
        lastActivity: session.lastActivity,
        requestCount: session.requestCount || 0,
        samlAuthenticated: session.samlAuthenticated || false,
        ipAddress: session.ipAddress,
        expiresIn: session.cookie?.maxAge || 0
      });
    } catch (error) {
      console.error('Error getting session info:', error);
      res.status(500).json({ message: 'Failed to get session information' });
    }
  });

  console.log('🛡️ [SESSION-MGMT] Enterprise session management routes registered');
}

export default router;
