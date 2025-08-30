import sql from 'mssql';
import { getFmbConfig } from '../fmb-onprem/config/fmb-env.js';

let connectionPool: sql.ConnectionPool | null = null;

// Get FMB database configuration
function getFmbDatabaseConfig() {
  const config = getFmbConfig();
  return {
    server: config.database.server,
    database: config.database.database,
    user: config.database.user,
    password: config.database.password,
    port: config.database.port,
    options: {
      encrypt: config.database.options.encrypt,
      trustServerCertificate: config.database.options.trustServerCertificate,
      enableArithAbort: true,
    },
    pool: {
      max: 20,
      min: 5,
      idleTimeoutMillis: 30000,
    },
    requestTimeout: 30000,
    connectionTimeout: 30000,
  };
}

// Initialize database connection
export async function initializeDatabase() {
  try {
    console.log('🔗 Connecting to FMB MS SQL database...');
    const config = getFmbDatabaseConfig();

    connectionPool = new sql.ConnectionPool(config);
    await connectionPool.connect();

    console.log('✅ FMB Database connection established successfully');
    return connectionPool;
  } catch (error) {
    console.error('❌ Failed to connect to FMB database:', error);
    throw error;
  }
}

// Get database connection
export function getDb(): sql.ConnectionPool {
  if (!connectionPool) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return connectionPool;
}

// Check database health
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    if (!connectionPool || !connectionPool.connected) {
      console.log('🔄 Database not connected, attempting to reconnect...');
      await initializeDatabase();
    }

    // Simple health check query
    const result = await connectionPool!.request().query('SELECT 1 as health_check');
    return result.recordset.length > 0;
  } catch (error) {
    console.error('❌ Database health check failed:', error);
    return false;
  }
}

// Graceful shutdown
export async function closeDatabase() {
  if (connectionPool) {
    try {
      await connectionPool.close();
      console.log('✅ FMB Database connection closed gracefully');
    } catch (error) {
      console.error('❌ Error closing FMB database connection:', error);
    }
  }
}

// Handle process termination
process.on('SIGINT', closeDatabase);
process.on('SIGTERM', closeDatabase);