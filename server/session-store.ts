import session from 'express-session';
import type { FmbStorage } from '../fmb-onprem/storage/fmb-storage.js';
import { loadFmbOnPremConfig, isFmbOnPremEnvironment } from '../fmb-onprem/config/fmb-env.js';
import sql from 'mssql';
import { Store } from 'express-session';
import crypto from 'crypto';
import connectMSSQLServer from 'connect-mssql-v2';
import type { Express } from 'express';

interface SessionData {
  sid: string;
  sess: any;
  expire: Date;
}

interface SessionMetrics {
  totalSessions: number;
  activeSessions: number;
  expiredSessions: number;
  avgDurationMinutes: number;
  lastSessionCreated?: Date;
  earliestExpiry?: Date;
}

export class CustomMSSQLStore extends Store {
  private pool: sql.ConnectionPool | null = null;
  private connectionPromise: Promise<sql.ConnectionPool> | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 1000;
  private isShuttingDown: boolean = false;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.initializeConnection();
    this.startAutomaticCleanup();
    this.setupGracefulShutdown();
  }

  private async initializeConnection(): Promise<sql.ConnectionPool> {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this.createConnection();
    return this.connectionPromise;
  }

  private async createConnection(): Promise<sql.ConnectionPool> {
    const config: sql.config = {
      server: process.env.FMB_DB_SERVER || 'localhost',
      database: process.env.FMB_DB_NAME || 'timetracker',
      user: process.env.FMB_DB_USER || 'timetracker',
      password: process.env.FMB_DB_PASSWORD || '',
      port: parseInt(process.env.FMB_DB_PORT || '1433'),
      options: {
        encrypt: process.env.FMB_DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.FMB_DB_TRUST_CERT === 'true',
        enableArithAbort: true,
        requestTimeout: 30000,
        connectionTimeout: 30000,
        isolationLevel: sql.ISOLATION_LEVEL.READ_COMMITTED,
        abortTransactionOnError: true
      },
      pool: {
        max: 15, // Increased for enterprise load
        min: 3,
        idleTimeoutMillis: 30000,
        acquireTimeoutMillis: 60000,
        createTimeoutMillis: 30000,
        destroyTimeoutMillis: 5000,
        reapIntervalMillis: 1000,
        createRetryIntervalMillis: 200
      }
    };

    try {
      const pool = new sql.ConnectionPool(config);

      // Enhanced connection event handling
      pool.on('connect', () => {
        console.log('🟢 [FMB-SESSION] MS SQL session store connected successfully');
        this.reconnectAttempts = 0; // Reset on successful connection
      });

      pool.on('error', (err) => {
        console.error('🔴 [FMB-SESSION] Connection pool error:', err);
        this.handleConnectionError(err);
      });

      await pool.connect();
      this.pool = pool;

      // Verify session table exists and is accessible
      await this.verifySessionTable();

      return pool;
    } catch (error) {
      console.error('🔴 [FMB-SESSION] Failed to connect to MS SQL session store:', error);
      await this.handleConnectionError(error);
      throw error;
    }
  }

  private async verifySessionTable(): Promise<void> {
    try {
      const pool = await this.getPool();
      await pool.request().query(`
        SELECT TOP 1 sid FROM sessions 
        WHERE 1=0 -- Just verify table structure
      `);
      console.log('🟢 [FMB-SESSION] Session table structure verified');
    } catch (error) {
      console.error('🔴 [FMB-SESSION] Session table verification failed:', error);
      throw new Error('Session table not accessible or missing required columns');
    }
  }

  private async handleConnectionError(error: any): Promise<void> {
    if (this.isShuttingDown) return;

    this.reconnectAttempts++;

    if (this.reconnectAttempts <= this.maxReconnectAttempts) {
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
      console.log(`🟡 [FMB-SESSION] Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);

      setTimeout(async () => {
        try {
          this.pool = null;
          this.connectionPromise = null;
          await this.initializeConnection();
        } catch (reconnectError) {
          console.error('🔴 [FMB-SESSION] Reconnection failed:', reconnectError);
        }
      }, delay);
    } else {
      console.error('🔴 [FMB-SESSION] Max reconnection attempts exceeded. Manual intervention required.');
      this.emit('disconnect'); // Emit event for monitoring systems
    }
  }

  private async getPool(): Promise<sql.ConnectionPool> {
    if (this.pool && this.pool.connected) {
      return this.pool;
    }
    return this.initializeConnection();
  }

  private startAutomaticCleanup(): void {
    // Run cleanup every 5 minutes
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.performCleanup();
      } catch (error) {
        console.error('🔴 [FMB-SESSION] Automatic cleanup failed:', error);
      }
    }, 5 * 60 * 1000);
  }

  private async performCleanup(): Promise<void> {
    try {
      const pool = await this.getPool();
      const request = pool.request();
      request.output('DeletedCount', sql.Int);

      await request.execute('sp_CleanupExpiredSessions');
      const deletedCount = request.parameters.DeletedCount.value;

      if (deletedCount > 0) {
        console.log(`🧹 [FMB-SESSION] Cleaned up ${deletedCount} expired sessions`);
      }
    } catch (error) {
      console.error('🔴 [FMB-SESSION] Session cleanup error:', error);
    }
  }

  private setupGracefulShutdown(): void {
    const shutdown = async () => {
      this.isShuttingDown = true;
      console.log('🟡 [FMB-SESSION] Initiating graceful shutdown...');

      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
      }

      // Perform final cleanup
      try {
        await this.performCleanup();
      } catch (error) {
        console.error('🔴 [FMB-SESSION] Final cleanup failed:', error);
      }

      if (this.pool) {
        try {
          await this.pool.close();
          console.log('🟢 [FMB-SESSION] Session store connection closed gracefully');
        } catch (error) {
          console.error('🔴 [FMB-SESSION] Error closing connection pool:', error);
        }
      }
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    process.on('exit', shutdown);
  }

  async get(sid: string, callback: (err?: any, session?: any) => void): Promise<void> {
    try {
      const pool = await this.getPool();
      const request = pool.request();
      request.input('sid', sql.NVarChar(255), sid);

      const result = await request.query(`
        SELECT sess, expire 
        FROM sessions 
        WHERE sid = @sid AND expire > GETDATE()
      `);

      if (result.recordset.length === 0) {
        return callback();
      }

      const session = JSON.parse(result.recordset[0].sess);
      callback(null, session);
    } catch (error) {
      console.error('🔴 [FMB-SESSION] Error getting session:', {
        sid: sid.substring(0, 8) + '...',
        error: error?.message || 'Unknown error'
      });
      callback(error);
    }
  }

  async set(sid: string, session: any, callback?: (err?: any) => void): Promise<void> {
    try {
      const pool = await this.getPool();
      const request = pool.request();

      // Calculate expiration based on session cookie maxAge
      const maxAge = session.cookie?.maxAge || (7 * 24 * 60 * 60 * 1000); // 7 days default
      const expire = new Date(Date.now() + maxAge);

      // Serialize session data securely
      const sessString = JSON.stringify(session);

      // Regenerate session ID on critical operations (enhanced security)
      if (session.regenerateRequired) {
        const newSid = this.generateSecureSessionId();
        delete session.regenerateRequired;

        request.input('oldSid', sql.NVarChar(255), sid);
        request.input('newSid', sql.NVarChar(255), newSid);
        request.input('sess', sql.NVarChar(sql.MAX), sessString);
        request.input('expire', sql.DateTime2(3), expire);

        // Atomic session ID regeneration
        await request.query(`
          BEGIN TRANSACTION;
          DELETE FROM sessions WHERE sid = @oldSid;
          INSERT INTO sessions (sid, sess, expire, created_at)
          VALUES (@newSid, @sess, @expire, GETDATE());
          COMMIT TRANSACTION;
        `);

        console.log('🔄 [FMB-SESSION] Session ID regenerated for security');
      } else {
        request.input('sid', sql.NVarChar(255), sid);
        request.input('sess', sql.NVarChar(sql.MAX), sessString);
        request.input('expire', sql.DateTime2(3), expire);

        // Use MERGE for atomic upsert operation
        await request.query(`
          MERGE sessions AS target
          USING (VALUES (@sid, @sess, @expire, GETDATE())) AS source (sid, sess, expire, created_at)
          ON target.sid = source.sid
          WHEN MATCHED THEN
            UPDATE SET sess = source.sess, expire = source.expire
          WHEN NOT MATCHED THEN
            INSERT (sid, sess, expire, created_at)
            VALUES (source.sid, source.sess, source.expire, source.created_at);
        `);
      }

      callback?.();
    } catch (error) {
      console.error('🔴 [FMB-SESSION] Error setting session:', {
        sid: sid.substring(0, 8) + '...',
        error: error?.message || 'Unknown error'
      });
      callback?.(error);
    }
  }

  async destroy(sid: string, callback?: (err?: any) => void): Promise<void> {
    try {
      const pool = await this.getPool();
      const request = pool.request();
      request.input('sid', sql.NVarChar(255), sid);

      const result = await request.query('DELETE FROM sessions WHERE sid = @sid');

      if (result.rowsAffected[0] > 0) {
        console.log('🗑️ [FMB-SESSION] Session destroyed successfully');
      }

      callback?.();
    } catch (error) {
      console.error('🔴 [FMB-SESSION] Error destroying session:', {
        sid: sid.substring(0, 8) + '...',
        error: error?.message || 'Unknown error'
      });
      callback?.(error);
    }
  }

  async touch(sid: string, session: any, callback?: (err?: any) => void): Promise<void> {
    try {
      const pool = await this.getPool();
      const request = pool.request();

      const maxAge = session.cookie?.maxAge || (7 * 24 * 60 * 60 * 1000);
      const expire = new Date(Date.now() + maxAge);

      request.input('sid', sql.NVarChar(255), sid);
      request.input('expire', sql.DateTime2(3), expire);

      await request.query(`
        UPDATE sessions 
        SET expire = @expire 
        WHERE sid = @sid AND expire > GETDATE()
      `);

      callback?.();
    } catch (error) {
      console.error('🔴 [FMB-SESSION] Error touching session:', error);
      callback?.(error);
    }
  }

  async clear(callback?: (err?: any) => void): Promise<void> {
    try {
      const pool = await this.getPool();
      await pool.request().query('TRUNCATE TABLE sessions');
      console.log('🧹 [FMB-SESSION] All sessions cleared');
      callback?.();
    } catch (error) {
      console.error('🔴 [FMB-SESSION] Error clearing sessions:', error);
      callback?.(error);
    }
  }

  async length(callback: (err?: any, length?: number) => void): Promise<void> {
    try {
      const pool = await this.getPool();
      const result = await pool.request().query('SELECT COUNT(*) as count FROM sessions WHERE expire > GETDATE()');
      callback(null, result.recordset[0].count);
    } catch (error) {
      console.error('🔴 [FMB-SESSION] Error getting session count:', error);
      callback(error);
    }
  }

  async all(callback: (err?: any, sessions?: any[]) => void): Promise<void> {
    try {
      const pool = await this.getPool();
      const result = await pool.request().query(`
        SELECT sid, sess, expire 
        FROM sessions 
        WHERE expire > GETDATE()
        ORDER BY created_at DESC
      `);

      const sessions = result.recordset.map(row => ({
        sid: row.sid,
        expire: row.expire,
        ...JSON.parse(row.sess)
      }));

      callback(null, sessions);
    } catch (error) {
      console.error('🔴 [FMB-SESSION] Error getting all sessions:', error);
      callback(error);
    }
  }

  // Enterprise-grade session management methods

  private generateSecureSessionId(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  async regenerateSessionId(sid: string, session: any): Promise<string> {
    const newSid = this.generateSecureSessionId();

    try {
      const pool = await this.getPool();
      const request = pool.request();

      const sessString = JSON.stringify(session);
      const maxAge = session.cookie?.maxAge || (7 * 24 * 60 * 60 * 1000);
      const expire = new Date(Date.now() + maxAge);

      request.input('oldSid', sql.NVarChar(255), sid);
      request.input('newSid', sql.NVarChar(255), newSid);
      request.input('sess', sql.NVarChar(sql.MAX), sessString);
      request.input('expire', sql.DateTime2(3), expire);

      // Atomic session ID regeneration
      await request.query(`
        BEGIN TRANSACTION;
        DELETE FROM sessions WHERE sid = @oldSid;
        INSERT INTO sessions (sid, sess, expire, created_at)
        VALUES (@newSid, @sess, @expire, GETDATE());
        COMMIT TRANSACTION;
      `);

      console.log('🔄 [FMB-SESSION] Session ID regenerated for enhanced security');
      return newSid;
    } catch (error) {
      console.error('🔴 [FMB-SESSION] Error regenerating session ID:', error);
      throw error;
    }
  }

  async getSessionMetrics(): Promise<SessionMetrics> {
    try {
      const pool = await this.getPool();
      const result = await pool.request().execute('sp_GetSessionStats');

      const stats = result.recordset[0];
      return {
        totalSessions: stats.total_sessions || 0,
        activeSessions: stats.active_sessions || 0,
        expiredSessions: stats.expired_sessions || 0,
        avgDurationMinutes: stats.avg_session_duration_minutes || 0,
        lastSessionCreated: stats.last_session_created,
        earliestExpiry: stats.earliest_expiry
      };
    } catch (error) {
      console.error('🔴 [FMB-SESSION] Error getting session metrics:', error);
      throw error;
    }
  }

  async getActiveSessions(userId?: string): Promise<any[]> {
    try {
      const pool = await this.getPool();
      const request = pool.request();

      let query = `
        SELECT sid, sess, expire, created_at
        FROM sessions 
        WHERE expire > GETDATE()
      `;

      if (userId) {
        query += ` AND JSON_VALUE(sess, '$.passport.user') = @userId`;
        request.input('userId', sql.NVarChar(255), userId);
      }

      query += ` ORDER BY created_at DESC`;

      const result = await request.query(query);

      return result.recordset.map(row => ({
        sessionId: row.sid.substring(0, 8) + '...',
        userId: JSON.parse(row.sess)?.passport?.user,
        createdAt: row.created_at,
        expiresAt: row.expire,
        durationMinutes: Math.round((row.expire.getTime() - row.created_at.getTime()) / (1000 * 60))
      }));
    } catch (error) {
      console.error('🔴 [FMB-SESSION] Error getting active sessions:', error);
      throw error;
    }
  }

  async revokeUserSessions(userId: string): Promise<number> {
    try {
      const pool = await this.getPool();
      const request = pool.request();
      request.input('userId', sql.NVarChar(255), userId);

      const result = await request.query(`
        DELETE FROM sessions 
        WHERE JSON_VALUE(sess, '$.passport.user') = @userId
      `);

      const revokedCount = result.rowsAffected[0] || 0;
      console.log(`🔒 [FMB-SESSION] Revoked ${revokedCount} sessions for user ${userId}`);

      return revokedCount;
    } catch (error) {
      console.error('🔴 [FMB-SESSION] Error revoking user sessions:', error);
      throw error;
    }
  }

  async extendSession(sid: string, additionalMinutes: number = 60): Promise<boolean> {
    try {
      const pool = await this.getPool();
      const request = pool.request();
      request.input('sid', sql.NVarChar(255), sid);
      request.input('additionalTime', sql.Int, additionalMinutes);

      const result = await request.query(`
        UPDATE sessions 
        SET expire = DATEADD(MINUTE, @additionalTime, expire)
        WHERE sid = @sid AND expire > GETDATE()
      `);

      const extended = result.rowsAffected[0] > 0;
      if (extended) {
        console.log(`⏱️ [FMB-SESSION] Extended session ${sid.substring(0, 8)}... by ${additionalMinutes} minutes`);
      }

      return extended;
    } catch (error) {
      console.error('🔴 [FMB-SESSION] Error extending session:', error);
      return false;
    }
  }
}

// Setup for FMB on-premises sessions using the custom store
async function setupFmbOnPremSessions(app: Express): Promise<void> {
  console.log('🏢 [SESSION] Initializing FMB MS SQL session store...');
  const customStore = new CustomMSSQLStore();
  app.use(session({
    store: customStore,
    secret: process.env.FMB_SESSION_SECRET || 'fallback-secret',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    name: 'fmb.timetracker.session',
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'lax'
    }
  }));
  console.log('🟢 [SESSION] Custom MS SQL session store configured.');
}

// Setup for cloud environments (using memory store or a placeholder)
async function setupCloudSessions(app: Express): Promise<void> {
  console.log('☁️ [SESSION] Cloud environment detected. Using memory session store.');
  // In a cloud environment, you might use a distributed cache like Redis or a managed session service.
  // For simplicity, we'll use the memory store here, but it's not suitable for scaled deployments.
  const MemoryStore = (await import('memorystore')).default;
  const memoryStore = MemoryStore(session);

  app.use(session({
    store: new memoryStore({
      checkPeriod: 86400000 // prune expired entries every 24h
    }),
    secret: process.env.SESSION_SECRET || 'cloud-session-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    name: 'fmb.timetracker.session',
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: 'lax'
    }
  }));
  console.log('🟢 [SESSION] Memory session store configured for cloud.');
}

// Fallback memory store for development
async function setupFallbackMemoryStore(app: Express): Promise<void> {
  const MemoryStore = (await import('memorystore')).default;
  const memoryStore = MemoryStore(session);

  app.use(session({
    store: new memoryStore({
      checkPeriod: 86400000 // prune expired entries every 24h
    }),
    secret: process.env.SESSION_SECRET || 'dev-fallback-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    name: 'fmb.timetracker.session',
    cookie: {
      secure: false, // Development only
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
      sameSite: 'lax'
    }
  }));

  console.log('⚠️ [SESSION] Memory store activated (development only)');
}


// Enhanced session security and monitoring
function enhanceSessionSecurity(store: any, isOnPrem: boolean = false) {
  // This function can be extended to add more security measures or monitoring capabilities.
  // For example, logging session activity, detecting suspicious patterns, etc.
  console.log(`[SESSION] Enhancing security for store type: ${isOnPrem ? 'On-Premises' : 'Cloud'}`);
}

export async function setupSessionStore(app: Express): Promise<void> {
  console.log('🔧 [SESSION] Setting up session store...');

  try {
    // Environment-specific session store setup with validation
    const isOnPrem = process.env.FMB_DEPLOYMENT === 'onprem';

    if (isOnPrem) {
      console.log('🏢 [SESSION] Setting up FMB on-premises session store...');

      // Validate FMB configuration before setup
      const fmbConfig = loadFmbOnPremConfig();
      if (!fmbConfig || !fmbConfig.database) {
        throw new Error('FMB on-premises configuration is missing or invalid');
      }

      await setupFmbOnPremSessions(app);
      enhanceSessionSecurity(null, true); // Pass null as store is initialized within setup function
    } else {
      console.log('☁️ [SESSION] Setting up cloud session store...');
      await setupCloudSessions(app);
      enhanceSessionSecurity(null, false); // Pass null as store is initialized within setup function
    }

    console.log('✅ [SESSION] Session store setup completed successfully');
  } catch (error) {
    console.error('❌ [SESSION] Failed to setup session store:', error);

    // Fallback to memory store in development
    if (process.env.NODE_ENV === 'development') {
      console.log('⚠️ [SESSION] Falling back to memory store for development');
      await setupFallbackMemoryStore(app);
      enhanceSessionSecurity(null, false); // Assuming fallback is like cloud
    } else {
      // In non-development environments, re-throw the error to indicate a critical failure
      throw error;
    }
  }
}

// The createSessionStore function from the original code is no longer directly used
// but its logic is integrated into setupSessionStore and its helper functions.
// If needed for backward compatibility or specific use cases, it can be retained or adapted.
export function createSessionStore() {
  // This function is now effectively replaced by setupSessionStore.
  // If called, it might indicate an older integration point.
  // For now, we'll log a warning and return undefined, as setupSessionStore should be used.
  console.warn('⚠️ [SESSION] createSessionStore() is deprecated. Use setupSessionStore() instead.');
  return undefined; // Indicate that session middleware should be handled by setupSessionStore
}
