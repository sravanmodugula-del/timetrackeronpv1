
import { loadFmbOnPremConfig } from '../config/fmb-env.js';
import { OptimizedSessionManager } from '../storage/session-manager.js';

export class FmbDeploymentValidator {
  static async validateDeployment(): Promise<{ valid: boolean; issues: string[] }> {
    const issues: string[] = [];
    
    console.log('🔧 [VALIDATOR] Starting FMB deployment validation...');

    // 1. Environment Variables
    try {
      const config = loadFmbOnPremConfig();
      console.log('✅ [VALIDATOR] Environment configuration loaded successfully');
    } catch (error) {
      issues.push(`Environment configuration error: ${error?.message}`);
    }

    // 2. Database Connectivity
    try {
      const sessionManager = OptimizedSessionManager.getInstance();
      const pool = await sessionManager.initializeSessionPool();
      console.log('✅ [VALIDATOR] Database connectivity verified');
    } catch (error) {
      issues.push(`Database connectivity error: ${error?.message}`);
    }

    // 3. Session Store Functionality
    try {
      const sessionManager = OptimizedSessionManager.getInstance();
      const pool = await sessionManager.getPool();
      
      if (pool) {
        const request = pool.request();
        const result = await request.query('SELECT COUNT(*) as count FROM sessions');
        console.log('✅ [VALIDATOR] Session store functionality verified');
      } else {
        issues.push('Session store pool not available');
      }
    } catch (error) {
      issues.push(`Session store error: ${error?.message}`);
    }

    // 4. Required Tables
    try {
      const sessionManager = OptimizedSessionManager.getInstance();
      const pool = await sessionManager.getPool();
      
      if (pool) {
        const request = pool.request();
        const result = await request.query(`
          SELECT TABLE_NAME 
          FROM INFORMATION_SCHEMA.TABLES 
          WHERE TABLE_NAME IN ('sessions', 'users', 'organizations', 'projects', 'time_entries')
        `);
        
        const requiredTables = ['sessions', 'users', 'organizations', 'projects', 'time_entries'];
        const existingTables = result.recordset.map(row => row.TABLE_NAME);
        const missingTables = requiredTables.filter(table => !existingTables.includes(table));
        
        if (missingTables.length > 0) {
          issues.push(`Missing database tables: ${missingTables.join(', ')}`);
        } else {
          console.log('✅ [VALIDATOR] All required database tables exist');
        }
      }
    } catch (error) {
      issues.push(`Database schema validation error: ${error?.message}`);
    }

    // 5. Session Store Performance Test
    try {
      const sessionManager = OptimizedSessionManager.getInstance();
      const startTime = Date.now();
      await sessionManager.cleanupExpiredSessions();
      const cleanupTime = Date.now() - startTime;
      
      if (cleanupTime > 5000) { // 5 seconds
        issues.push(`Session cleanup performance warning: ${cleanupTime}ms (should be < 5000ms)`);
      } else {
        console.log(`✅ [VALIDATOR] Session cleanup performance: ${cleanupTime}ms`);
      }
    } catch (error) {
      issues.push(`Session cleanup test failed: ${error?.message}`);
    }

    const valid = issues.length === 0;
    
    if (valid) {
      console.log('✅ [VALIDATOR] FMB deployment validation passed');
    } else {
      console.log('🔴 [VALIDATOR] FMB deployment validation failed with issues:', issues);
    }

    return { valid, issues };
  }

  static async generateHealthReport(): Promise<any> {
    const { SessionHealthMonitor } = await import('../storage/session-health-monitor.js');
    const healthMonitor = SessionHealthMonitor.getInstance();
    
    return {
      timestamp: new Date().toISOString(),
      sessionStats: await healthMonitor.getSessionStats(),
      deploymentValidation: await this.validateDeployment()
    };
  }
}
