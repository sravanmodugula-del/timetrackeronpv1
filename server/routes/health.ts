import { Router } from 'express';
import { checkDatabaseHealth } from '../db.js';
import { isFmbOnPremEnvironment } from '../../fmb-onprem/config/fmb-env.js';

const router = Router();

// Import session health monitoring for enhanced health checks
let SessionHealthMonitor: any = null;
let FmbDeploymentValidator: any = null;

if (isFmbOnPremEnvironment()) {
  import('../../fmb-onprem/storage/session-health-monitor.js').then(module => {
    SessionHealthMonitor = module.SessionHealthMonitor;
  });
  import('../../fmb-onprem/utils/deployment-validator.js').then(module => {
    FmbDeploymentValidator = module.FmbDeploymentValidator;
  });
}

router.get('/health', async (req, res) => {
  try {
    const dbHealth = await checkDatabaseHealth();
    const isOnPrem = isFmbOnPremEnvironment();

    let sessionStoreStatus = 'N/A';
    if (SessionHealthMonitor && isOnPrem) {
      try {
        const monitor = new SessionHealthMonitor();
        sessionStoreStatus = await monitor.checkSessionStoreHealth();
      } catch (error) {
        sessionStoreStatus = 'error';
        console.error('Session store health check failed:', error);
      }
    }

    const healthStatus = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: dbHealth ? 'connected' : 'disconnected',
      sessionStore: sessionStoreStatus,
      environment: process.env.NODE_ENV || 'development',
      deployment: isOnPrem ? 'on-premises' : 'cloud',
      version: process.env.npm_package_version || '1.0.0',
      platform: process.platform
    };

    res.status(dbHealth && (sessionStoreStatus === 'ok' || sessionStoreStatus === 'N/A') ? 200 : 503).json(healthStatus);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

router.get('/health/database', async (req, res) => {
  try {
    const isHealthy = await checkDatabaseHealth();
    const isOnPrem = isFmbOnPremEnvironment();

    let databaseType = 'fallback';
    let schemaValid = false;

    if (isOnPrem && process.env.NODE_ENV === 'production') {
      databaseType = 'mssql';

      try {
        // Dynamic import for MS SQL health checks
        const { checkFmbDatabaseHealth, validateDatabaseSchema } = await import('../../fmb-onprem/config/fmb-database.js');
        const mssqlHealth = await checkFmbDatabaseHealth();
        schemaValid = await validateDatabaseSchema();

        // Also check session store health if available and applicable
        let sessionStoreStatus = 'N/A';
        if (SessionHealthMonitor && FmbDeploymentValidator && FmbDeploymentValidator.isSessionStoreEnabled()) {
          try {
            const monitor = new SessionHealthMonitor();
            sessionStoreStatus = await monitor.checkSessionStoreHealth();
          } catch (error) {
            sessionStoreStatus = 'error';
            console.error('Session store health check failed:', error);
          }
        }

        res.status(mssqlHealth && schemaValid && (sessionStoreStatus === 'ok' || sessionStoreStatus === 'N/A') ? 200 : 503).json({
          database: mssqlHealth && schemaValid ? 'healthy' : 'unhealthy',
          type: databaseType,
          connection: mssqlHealth ? 'connected' : 'disconnected',
          schema: schemaValid ? 'valid' : 'invalid',
          sessionStore: sessionStoreStatus,
          timestamp: new Date().toISOString(),
          server: process.env.FMB_DB_SERVER || 'unknown',
          deployment: 'on-premises'
        });
        return;
      } catch (error) {
        res.status(503).json({
          database: 'error',
          type: databaseType,
          connection: 'failed',
          schema: 'unknown',
          timestamp: new Date().toISOString(),
          error: error instanceof Error ? error.message : 'Unknown error',
          deployment: 'on-premises'
        });
        return;
      }
    }

    res.status(isHealthy ? 200 : 503).json({
      database: isHealthy ? 'healthy' : 'unhealthy',
      type: databaseType,
      connection: isHealthy ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
      deployment: isOnPrem ? 'on-premises' : 'cloud'
    });
  } catch (error) {
    res.status(500).json({
      database: 'error',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// MS SQL specific health endpoint for on-premises deployment
router.get('/health/mssql', async (req, res) => {
  try {
    if (!isFmbOnPremEnvironment() || process.env.NODE_ENV !== 'production') {
      res.status(404).json({
        error: 'MS SQL health check only available in on-premises production environment'
      });
      return;
    }

    const { checkFmbDatabaseHealth, validateDatabaseSchema } = await import('../../fmb-onprem/config/fmb-database.js');

    const [connectionHealth, schemaValid] = await Promise.all([
      checkFmbDatabaseHealth(),
      validateDatabaseSchema()
    ]);

    // Also check session store health if available and applicable
    let sessionStoreStatus = 'N/A';
    if (SessionHealthMonitor && FmbDeploymentValidator && FmbDeploymentValidator.isSessionStoreEnabled()) {
      try {
        const monitor = new SessionHealthMonitor();
        sessionStoreStatus = await monitor.checkSessionStoreHealth();
      } catch (error) {
        sessionStoreStatus = 'error';
        console.error('Session store health check failed:', error);
      }
    }

    const config = {
      server: process.env.FMB_DB_SERVER || 'unknown',
      database: process.env.FMB_DB_NAME || 'unknown',
      port: process.env.FMB_DB_PORT || '1433'
    };

    res.status(connectionHealth && schemaValid && (sessionStoreStatus === 'ok' || sessionStoreStatus === 'N/A') ? 200 : 503).json({
      mssql: {
        connection: connectionHealth ? 'healthy' : 'unhealthy',
        schema: schemaValid ? 'valid' : 'invalid',
        sessionStore: sessionStoreStatus,
        server: config.server,
        database: config.database,
        port: config.port,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({
      mssql: {
        connection: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }
    });
  }
});

export default router;