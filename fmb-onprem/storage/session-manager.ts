import sql from 'mssql';
import { loadFmbOnPremConfig } from '../config/fmb-env.js';

export class OptimizedSessionManager {
  private static instance: OptimizedSessionManager;
  private pool: sql.ConnectionPool | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 2000;

  private constructor() {}

  static getInstance(): OptimizedSessionManager {
    if (!OptimizedSessionManager.instance) {
      OptimizedSessionManager.instance = new OptimizedSessionManager();
    }
    return OptimizedSessionManager.instance;
  }

  async initializeSessionPool(): Promise<sql.ConnectionPool> {
    if (this.pool && this.pool.connected) {
      return this.pool;
    }

    const config = loadFmbOnPremConfig();

    const poolConfig: sql.config = {
      server: config.database.server,
      database: config.database.database,
      user: config.database.user,
      password: config.database.password,
      port: config.database.port,
      options: {
        encrypt: config.database.options.encrypt,
        trustServerCertificate: config.database.options.trustServerCertificate,
        enableArithAbort: true,
        connectTimeout: 15000,
        requestTimeout: 10000
      },
      pool: {
        max: 8,
        min: 2,
        idleTimeoutMillis: 30000,
        acquireTimeoutMillis: 30000,
        createTimeoutMillis: 30000,
        destroyTimeoutMillis: 5000,
        reapIntervalMillis: 1000,
        createRetryIntervalMillis: 2000
      }
    };

    try {
      this.pool = new sql.ConnectionPool(poolConfig);

      this.pool.on('error', (err) => {
        console.error('🔴 [SESSION-POOL] Connection pool error:', err);
        this.handleConnectionError();
      });

      await this.pool.connect();
      await this.ensureSessionTable();

      console.log('✅ [SESSION-POOL] Optimized session pool initialized successfully');
      this.reconnectAttempts = 0;

      return this.pool;
    } catch (error) {
      console.error('🔴 [SESSION-POOL] Failed to initialize session pool:', error);
      await this.handleConnectionError();
      throw error;
    }
  }

  private async ensureSessionTable(): Promise<void> {
    if (!this.pool) return;

    try {
      const request = new sql.Request(this.pool);

      // Check if sessions table exists and get its structure
      const tableCheck = await request.query(`
        SELECT COLUMN_NAME, DATA_TYPE 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'sessions'
      `);

      if (tableCheck.recordset.length === 0) {
        // Create table to match the main SQL setup schema
        await request.query(`
          CREATE TABLE sessions (
            sid NVARCHAR(255) NOT NULL PRIMARY KEY,
            sess NVARCHAR(MAX) NOT NULL,
            expire DATETIME2(3) NOT NULL,
            created_at DATETIME2(3) NOT NULL DEFAULT GETDATE()
          );
          CREATE INDEX IDX_sessions_expire ON sessions(expire);
          CREATE INDEX IDX_sessions_sid_expire ON sessions(sid, expire);
        `);
        console.log('✅ [SESSION-POOL] Session table created with connect-mssql-v2 compatible structure');
      } else {
        console.log('✅ [SESSION-POOL] Sessions table already exists');
        // Verify column structure matches expected schema
        const expectedColumns = ['sid', 'sess', 'expire', 'created_at'];
        const actualColumns = tableCheck.recordset.map(row => row.COLUMN_NAME.toLowerCase());
        const missingColumns = expectedColumns.filter(col => !actualColumns.includes(col));

        if (missingColumns.length > 0) {
          console.log('⚠️ [SESSION-POOL] Session table schema mismatch:', {
            expected: expectedColumns,
            actual: actualColumns,
            missing: missingColumns
          });
        } else {
          console.log('✅ [SESSION-POOL] Session table schema is correct');
        }
      }
    } catch (error) {
      console.error('🔴 [SESSION-POOL] Failed to ensure session table:', error);
    }
  }

  private async handleConnectionError(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('🔴 [SESSION-POOL] Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(`🟡 [SESSION-POOL] Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);

    setTimeout(async () => {
      try {
        await this.initializeSessionPool();
      } catch (error) {
        console.error('🔴 [SESSION-POOL] Reconnection failed:', error);
      }
    }, delay);
  }

  async getPool(): Promise<sql.ConnectionPool | null> {
    return this.pool;
  }

  async closeSessionPool(): Promise<void> {
    if (this.pool) {
      try {
        await this.pool.close();
        this.pool = null;
        console.log('✅ [SESSION-POOL] Session pool closed successfully');
      } catch (error) {
        console.error('🔴 [SESSION-POOL] Error closing session pool:', error);
      }
    }
  }

  async cleanupExpiredSessions(): Promise<number> {
    if (!this.pool) return 0;

    try {
      const request = new sql.Request(this.pool);
      const result = await request.query('DELETE FROM sessions WHERE expire < GETDATE()');
      const deletedCount = result.rowsAffected[0] || 0;

      if (deletedCount > 0) {
        console.log(`🧹 [SESSION-CLEANUP] Cleaned up ${deletedCount} expired sessions`);
      }

      return deletedCount;
    } catch (error) {
      console.error('🔴 [SESSION-CLEANUP] Failed to cleanup expired sessions:', error);
      return 0;
    }
  }
}