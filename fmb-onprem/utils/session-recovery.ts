
import { OptimizedSessionManager } from '../storage/session-manager.js';
import { loadFmbOnPremConfig } from '../config/fmb-env.js';

export class SessionRecoveryUtils {
  private static sessionManager = OptimizedSessionManager.getInstance();

  /**
   * Validates and repairs session store connectivity
   */
  static async validateAndRepairSessionStore(): Promise<boolean> {
    try {
      console.log('🔧 [SESSION-RECOVERY] Validating session store...');
      
      const pool = await this.sessionManager.getPool();
      if (!pool || !pool.connected) {
        console.log('🟡 [SESSION-RECOVERY] Pool not connected, initializing...');
        await this.sessionManager.initializeSessionPool();
      }

      // Test basic operations
      const testResult = await this.testSessionOperations();
      if (!testResult) {
        console.log('🔴 [SESSION-RECOVERY] Session operations test failed');
        return false;
      }

      console.log('✅ [SESSION-RECOVERY] Session store validation successful');
      return true;
    } catch (error) {
      console.error('🔴 [SESSION-RECOVERY] Session store validation failed:', error?.message);
      return false;
    }
  }

  /**
   * Tests basic session CRUD operations
   */
  private static async testSessionOperations(): Promise<boolean> {
    try {
      const pool = await this.sessionManager.getPool();
      if (!pool) return false;

      const testSid = `recovery-test-${Date.now()}`;
      const testData = { test: true, timestamp: new Date().toISOString() };

      // Test CREATE
      const createRequest = pool.request();
      createRequest.input('sid', testSid);
      createRequest.input('sess', JSON.stringify(testData));
      createRequest.input('expire', new Date(Date.now() + 300000)); // 5 minutes

      await createRequest.query(`
        INSERT INTO sessions (sid, sess, expire, created_at)
        VALUES (@sid, @sess, @expire, GETDATE())
      `);

      // Test READ
      const readRequest = pool.request();
      readRequest.input('sid', testSid);
      const readResult = await readRequest.query('SELECT sess FROM sessions WHERE sid = @sid');

      // Test DELETE
      const deleteRequest = pool.request();
      deleteRequest.input('sid', testSid);
      await deleteRequest.query('DELETE FROM sessions WHERE sid = @sid');

      return readResult.recordset.length > 0;
    } catch (error) {
      console.error('🔴 [SESSION-RECOVERY] Session operations test failed:', error?.message);
      return false;
    }
  }

  /**
   * Recovers from session store failures during SAML authentication
   */
  static async handleSamlSessionFailure(req: any, res: any, next: any): Promise<void> {
    try {
      console.log('🟡 [SESSION-RECOVERY] Handling SAML session failure...');
      
      // Attempt to repair session store
      const repaired = await this.validateAndRepairSessionStore();
      
      if (repaired) {
        console.log('✅ [SESSION-RECOVERY] Session store repaired, retrying SAML flow');
        
        // Regenerate session to ensure clean state
        req.session.regenerate((err: any) => {
          if (err) {
            console.error('🔴 [SESSION-RECOVERY] Session regeneration failed:', err);
            return res.status(500).json({ 
              error: 'Session recovery failed',
              timestamp: new Date().toISOString() 
            });
          }
          next();
        });
      } else {
        console.error('🔴 [SESSION-RECOVERY] Unable to repair session store');
        return res.status(503).json({ 
          error: 'Session service unavailable',
          timestamp: new Date().toISOString(),
          supportInfo: 'Please contact IT support'
        });
      }
    } catch (error) {
      console.error('🔴 [SESSION-RECOVERY] Recovery process failed:', error?.message);
      return res.status(500).json({ 
        error: 'Internal server error during session recovery',
        timestamp: new Date().toISOString() 
      });
    }
  }

  /**
   * Middleware to ensure session store availability
   */
  static createSessionAvailabilityMiddleware() {
    return async (req: any, res: any, next: any) => {
      // Skip check for non-authenticated routes
      if (req.path.includes('/health') || req.path.includes('/api/auth/login')) {
        return next();
      }

      try {
        const pool = await this.sessionManager.getPool();
        if (!pool || !pool.connected) {
          console.log('🟡 [SESSION-MIDDLEWARE] Session store not available, attempting repair...');
          
          const repaired = await this.validateAndRepairSessionStore();
          if (!repaired) {
            return res.status(503).json({
              error: 'Session service temporarily unavailable',
              retryAfter: 30
            });
          }
        }
        
        next();
      } catch (error) {
        console.error('🔴 [SESSION-MIDDLEWARE] Session availability check failed:', error?.message);
        next(); // Continue anyway to avoid blocking the application
      }
    };
  }
}
