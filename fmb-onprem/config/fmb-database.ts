import sql from 'mssql';
import { loadFmbOnPremConfig } from './fmb-env.js';
import { FmbStorage } from '../storage/fmb-storage.js';

let pool: sql.ConnectionPool | null = null;
let db: any = null;
let fmbStorageInstance: FmbStorage | null = null;

export async function initializeFmbDatabase() {
  // Skip database initialization during build process
  if (process.env.npm_lifecycle_event === 'build' || 
      process.env.NODE_ENV === 'development') {
    console.log('🔧 Skipping FMB database initialization during build/development');
    return;
  }

  console.log('🔧 Initializing FMB on-premises MS SQL database...');

  try {
    const config = loadFmbOnPremConfig();

    if (!config || !config.database) {
      throw new Error('FMB configuration not loaded properly');
    }

    console.log(`🔗 Attempting connection to ${config.database.server}:${config.database.port}/${config.database.database}`);

    // Ensure SSL certificate trust for on-premises deployment
    const dbConfig = {
      ...config.database,
      options: {
        ...config.database.options,
        trustServerCertificate: true, // Force trust for self-signed certificates
        cryptoCredentialsDetails: {
          rejectUnauthorized: false // Allow all certificates
        }
      }
    };

    fmbStorageInstance = new FmbStorage({
      server: dbConfig.server,
      database: dbConfig.database,
      user: dbConfig.user,
      password: dbConfig.password,
      options: {
        port: parseInt(dbConfig.port.toString()),
        enableArithAbort: true,
        connectTimeout: 30000,
        requestTimeout: 30000,
        encrypt: dbConfig.options.encrypt,
        trustServerCertificate: dbConfig.options.trustServerCertificate
      },
    });

    await fmbStorageInstance.connect();
    console.log('✅ FMB MS SQL database connected successfully');
  } catch (error) {
    console.error('❌ Failed to connect to FMB database:', error?.message || 'Unknown connection error');

    if (error?.code === 'ESOCKET') {
      console.error('🔴 Database connection error: Unable to reach the database server');
      console.error('💡 Please verify:');
      console.error('   - Database server is running and accessible');
      console.error('   - Network connectivity to the database server');
      console.error('   - Firewall settings allow connections on the database port');
      console.error('   - Database credentials are correct');
    }

    // Don't throw error during development or build
    if (process.env.NODE_ENV === 'development' || 
        process.env.npm_lifecycle_event === 'build') {
      console.log('🟡 [FMB-DATABASE] Database connection failed - continuing without database connection');
      return;
    }

    throw new Error(`Database connection failed: ${error?.message || 'Unable to establish connection'}`);
  }
}

export function getFmbStorage(): import('../../server/storage.js').IStorage {
  if (!fmbStorageInstance) {
    // Skip storage creation during build or development
    if (process.env.npm_lifecycle_event === 'build' || 
        process.env.NODE_ENV === 'development') {
      console.log('🔧 [FMB-DATABASE] Skipping storage creation during build/development');
      // Return a mock storage that doesn't attempt connections
      return createMockStorage();
    }

    console.log('🔧 [FMB-DATABASE] Creating new FMB storage instance...');
    try {
      const config = loadFmbOnPremConfig();

      if (!config || !config.database) {
        throw new Error('FMB configuration not available');
      }

      fmbStorageInstance = new FmbStorage({
        server: config.database.server,
        database: config.database.database,
        user: config.database.user,
        password: config.database.password,
        options: {
          port: config.database.port,
          enableArithAbort: true,
          connectTimeout: 30000,
          requestTimeout: 30000,
          encrypt: config.database.options.encrypt,
          trustServerCertificate: config.database.options.trustServerCertificate
        },
      });

      // Auto-connect to database
      fmbStorageInstance.connect().catch(error => {
        console.error('❌ [FMB-DATABASE] Failed to connect to FMB database:', error);
      });
    } catch (error) {
      console.error('❌ [FMB-DATABASE] Failed to create storage instance:', error);
      return createMockStorage();
    }
  }

  return fmbStorageInstance as any as import('../../server/storage.js').IStorage;
}

function createMockStorage(): import('../../server/storage.js').IStorage {
  return {
    async connect() { return true; },
    async disconnect() { return true; },
    async getUser() { throw new Error('Database not available in development mode'); },
    async upsertUser() { throw new Error('Database not available in development mode'); },
    async getProjects() { return []; },
    async getTimeEntries() { return []; },
    async getDashboardStats() { return { totalHours: 0, totalProjects: 0, totalEmployees: 0 }; }
  } as any;
}

// Export the storage instance directly for compatibility
export { fmbStorageInstance as activeStorage };

export async function closeFmbDatabase() {
  if (pool) {
    await pool.close();
    pool = null;
    db = null;
    console.log('✅ [FMB-DATABASE] MS SQL Server connection closed');
  }
  if (fmbStorageInstance) {
    await fmbStorageInstance.disconnect();
    fmbStorageInstance = null;
    console.log('✅ [FMB-DATABASE] FMB database connection closed');
  }
}

export { pool as fmbPool, db as fmbDb };

// Database health check for on-prem
export async function checkFmbDatabaseHealth(): Promise<boolean> {
  try {
    if (!fmbStorageInstance) {
      return false;
    }

    // Test database connectivity with a simple query
    const result = await fmbStorageInstance.execute('SELECT 1 as health');
    return result && result.length > 0 && result[0].health === 1;
  } catch (error) {
    console.error('🔴 [FMB-DATABASE] Health check failed:', error);
    return false;
  }
}

// Validate database schema exists
export async function validateDatabaseSchema(): Promise<boolean> {
  try {
    if (!fmbStorageInstance) {
      return false;
    }

    // Check if required tables exist
    const result = await fmbStorageInstance.execute(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_catalog = 'timetracker' 
        AND table_name IN ('users', 'projects', 'tasks', 'time_entries', 'organizations', 'departments', 'employees')
    `);

    const requiredTables = ['users', 'projects', 'tasks', 'time_entries', 'organizations', 'departments', 'employees'];
    const existingTables = result.map((row: any) => row.table_name);

    const missingTables = requiredTables.filter(table => !existingTables.includes(table));

    if (missingTables.length > 0) {
      console.error('🔴 [FMB-DATABASE] Missing required tables:', missingTables);
      console.error('💡 Run the database setup script: fmb-onprem/scripts/fmb-setup-db.sql');
      return false;
    }

    console.log('✅ [FMB-DATABASE] Database schema validation passed');
    return true;
  } catch (error) {
    console.error('🔴 [FMB-DATABASE] Schema validation failed:', error);
    return false;
  }
}

// Raw SQL query helper for MS SQL
export async function executeFmbQuery(query: string, params: any[] = []): Promise<any> {
  try {
    if (!fmbStorageInstance) {
      await initializeFmbDatabase();
    }

    // Assuming FmbStorage has an execute method that accepts query and parameters
    // This is a placeholder and should be adapted based on FmbStorage implementation
    const result = await fmbStorageInstance!.execute(query, params);
    return result;
  } catch (error) {
    console.error('🔴 [FMB-DATABASE] Query execution failed:', error);
    throw error;
  }
}