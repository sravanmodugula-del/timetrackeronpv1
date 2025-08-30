
import { OptimizedSessionManager } from './session-manager.js';
import { loadFmbOnPremConfig } from '../config/fmb-env.js';

export class SessionHealthMonitor {
  private static instance: SessionHealthMonitor;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private sessionManager: OptimizedSessionManager;
  private healthCheckInterval = 5 * 60 * 1000; // 5 minutes

  private constructor() {
    this.sessionManager = OptimizedSessionManager.getInstance();
  }

  static getInstance(): SessionHealthMonitor {
    if (!SessionHealthMonitor.instance) {
      SessionHealthMonitor.instance = new SessionHealthMonitor();
    }
    return SessionHealthMonitor.instance;
  }

  startMonitoring(): void {
    if (this.monitoringInterval) {
      console.log('🟡 [SESSION-MONITOR] Monitoring already active');
      return;
    }

    console.log('🟢 [SESSION-MONITOR] Starting session health monitoring...');
    
    this.monitoringInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, this.healthCheckInterval);

    // Perform initial health check
    this.performHealthCheck();
  }

  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      console.log('🔴 [SESSION-MONITOR] Session monitoring stopped');
    }
  }

  private async performHealthCheck(): Promise<void> {
    try {
      const pool = await this.sessionManager.getPool();
      
      if (!pool || !pool.connected) {
        console.log('🟡 [SESSION-MONITOR] Session pool not connected, attempting reconnection...');
        await this.sessionManager.initializeSessionPool();
        return;
      }

      // Test session operations
      const testSessionId = `health-check-${Date.now()}`;
      const testSessionData = { 
        testData: 'health-check', 
        timestamp: new Date().toISOString() 
      };

      // Test write operation
      const request = pool.request();
      request.input('sid', testSessionId);
      request.input('sess', JSON.stringify(testSessionData));
      request.input('expire', new Date(Date.now() + 300000)); // 5 minutes

      await request.query(`
        INSERT INTO sessions (sid, sess, expire, created_at)
        VALUES (@sid, @sess, @expire, GETDATE())
      `);

      // Test read operation
      const readRequest = pool.request();
      readRequest.input('sid', testSessionId);
      const result = await readRequest.query('SELECT sess FROM sessions WHERE sid = @sid');

      // Cleanup test session
      const cleanupRequest = pool.request();
      cleanupRequest.input('sid', testSessionId);
      await cleanupRequest.query('DELETE FROM sessions WHERE sid = @sid');

      if (result.recordset.length > 0) {
        console.log('✅ [SESSION-MONITOR] Session store health check passed');
        
        // Perform cleanup of expired sessions
        const deletedCount = await this.sessionManager.cleanupExpiredSessions();
        if (deletedCount > 0) {
          console.log(`🧹 [SESSION-MONITOR] Cleaned ${deletedCount} expired sessions`);
        }
      } else {
        console.log('🟡 [SESSION-MONITOR] Session store read test failed');
      }

    } catch (error) {
      console.error('🔴 [SESSION-MONITOR] Health check failed:', error?.message);
      
      // Attempt to reinitialize the pool
      try {
        await this.sessionManager.initializeSessionPool();
        console.log('🟢 [SESSION-MONITOR] Session pool reinitialized after health check failure');
      } catch (reinitError) {
        console.error('🔴 [SESSION-MONITOR] Failed to reinitialize session pool:', reinitError?.message);
      }
    }
  }

  async getSessionStats(): Promise<any> {
    try {
      const pool = await this.sessionManager.getPool();
      if (!pool) return null;

      const request = pool.request();
      const result = await request.query(`
        SELECT 
          COUNT(*) as total_sessions,
          COUNT(CASE WHEN expire > GETDATE() THEN 1 END) as active_sessions,
          COUNT(CASE WHEN expire <= GETDATE() THEN 1 END) as expired_sessions,
          AVG(DATEDIFF(MINUTE, created_at, expire)) as avg_session_duration_minutes
        FROM sessions
      `);

      return result.recordset[0];
    } catch (error) {
      console.error('🔴 [SESSION-MONITOR] Failed to get session stats:', error?.message);
      return null;
    }
  }
}
