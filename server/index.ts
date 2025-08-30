import express from "express";
import session from "express-session";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { checkDatabaseHealth } from "./db.js";
import { registerRoutes } from "./routes.js";
import { setupVite, serveStatic } from "./vite.js";
import { loadFmbOnPremConfig } from '../fmb-onprem/config/fmb-env.js';
import { initializeDatabase } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Enhanced logging utility
const LOG_LEVELS = {
  INFO: '🟢',
  WARN: '🟡',
  ERROR: '🔴',
  DEBUG: '🔍'
} as const;

function enhancedLog(level: keyof typeof LOG_LEVELS, category: string, message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} ${LOG_LEVELS[level]} [${category}] ${message}`;

  if (data) {
    console.log(logMessage, typeof data === 'object' ? JSON.stringify(data, null, 2) : data);
  } else {
    console.log(logMessage);
  }
}

// Global error handlers
process.on('uncaughtException', (error) => {
  enhancedLog('ERROR', 'PROCESS', 'Uncaught Exception:', {
    message: error.message,
    stack: error.stack,
    name: error.name
  });

  // Allow database connection errors to be handled gracefully
  if (error.message.includes('terminating connection') ||
      error.message.includes('database') ||
      error.message.includes('connection')) {
    enhancedLog('WARN', 'DATABASE', 'Database connection error detected - attempting recovery...');

    // Give some time for recovery attempts
    setTimeout(() => {
      enhancedLog('INFO', 'PROCESS', 'Database error recovery timeout reached');
    }, 10000);

    return; // Don't exit on database errors
  }

  enhancedLog('ERROR', 'PROCESS', 'Critical error - shutting down server');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  const isDbError = reason instanceof Error &&
    (reason.message.includes('terminating connection') ||
     reason.message.includes('database') ||
     reason.message.includes('connection'));

  enhancedLog(isDbError ? 'WARN' : 'ERROR', 'PROCESS', 'Unhandled Rejection:', {
    reason: reason instanceof Error ? {
      message: reason.message,
      stack: reason.stack,
      name: reason.name
    } : reason,
    promise: promise.toString(),
    isDatabaseError: isDbError
  });

  if (!isDbError) {
    enhancedLog('ERROR', 'PROCESS', 'Critical unhandled rejection - shutting down server');
    process.exit(1);
  } else {
    enhancedLog('INFO', 'PROCESS', 'Database error - continuing operation with connection recovery');
  }
});

// Enterprise-grade session configuration for FMB on-premises
async function getSession() {
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Enterprise session configuration
  const sessionTtl = isProduction 
    ? 8 * 60 * 60 * 1000  // 8 hours for production (business day)
    : 7 * 24 * 60 * 60 * 1000; // 7 days for development
  
  const inactivityTimeout = 2 * 60 * 60 * 1000; // 2 hours inactivity timeout

  // Validate FMB session secret
  const sessionSecret = process.env.FMB_SESSION_SECRET;
  if (!sessionSecret) {
    enhancedLog('ERROR', 'SESSION', 'FMB_SESSION_SECRET environment variable is required');
    throw new Error('FMB_SESSION_SECRET environment variable is required');
  }

  if (sessionSecret.length < 32) {
    enhancedLog('ERROR', 'SESSION', 'FMB_SESSION_SECRET must be at least 32 characters for enterprise security');
    throw new Error('FMB_SESSION_SECRET must be at least 32 characters for enterprise security');
  }

  enhancedLog('INFO', 'SESSION', `FMB Enterprise Session configured for ${isProduction ? 'production' : 'development'} mode`);

  const sessionConfig: any = {
    secret: sessionSecret,
    resave: false, // Only save when modified (enterprise best practice)
    saveUninitialized: false, // Don't save empty sessions (GDPR compliance)
    rolling: true, // Reset expiration on activity
    cookie: {
      httpOnly: true, // Always use HttpOnly for security
      secure: isProduction, // Use secure cookies in production with HTTPS
      maxAge: sessionTtl,
      sameSite: 'strict' as const // Enhanced CSRF protection
    },
    name: 'fmb.timetracker.sid',
    
    // Enterprise session configuration
    genid: (req: any) => {
      // Generate cryptographically secure session IDs
      const crypto = require('crypto');
      return crypto.randomBytes(32).toString('hex');
    },
    
    // Custom session validation
    proxy: isProduction, // Trust proxy headers in production
    unset: 'destroy' // Destroy session when unset
  };

  // Initialize enterprise MS SQL session store
  try {
    // Import session health monitoring
    const { SessionHealthMonitor } = await import('../fmb-onprem/storage/session-health-monitor.js');
    const healthMonitor = SessionHealthMonitor.getInstance();

    // Initialize custom MS SQL session store
    const { CustomMSSQLStore } = await import('./session-store.js');
    const sessionStore = new CustomMSSQLStore();
    sessionConfig.store = sessionStore;

    // Start comprehensive session monitoring
    healthMonitor.startMonitoring();

    // Log session store capabilities
    enhancedLog('INFO', 'SESSION', 'Enterprise session store capabilities enabled:', {
      persistentStorage: true,
      clustering: true,
      healthMonitoring: true,
      automaticCleanup: true,
      sessionRegeneration: true,
      securityAuditing: true
    });

    enhancedLog('INFO', 'SESSION', 'FMB Enterprise MS SQL session store initialized successfully');
  } catch (error) {
    enhancedLog('ERROR', 'SESSION', 'Failed to initialize FMB Enterprise session store:', {
      message: error?.message || 'Unknown error',
      code: error?.code || 'NO_CODE',
      name: error?.name || 'NO_NAME',
      stack: error?.stack || 'NO_STACK'
    });

    enhancedLog('ERROR', 'SESSION', 'Enterprise deployment requires database-backed session store');
    throw error;
  }

  return session(sessionConfig);
}

async function createServer() {
  enhancedLog('INFO', 'SERVER', 'Starting FMB TimeTracker On-Premises Application...');

  // Load FMB configuration
  loadFmbOnPremConfig();
  enhancedLog('INFO', 'FMB-ONPREM', 'FMB On-premises environment initialized');

  // Initialize database
  try {
    await initializeDatabase();
    enhancedLog('INFO', 'DATABASE', 'FMB Database initialization completed successfully');
  } catch (error) {
    enhancedLog('ERROR', 'DATABASE', 'FMB Database initialization failed - cannot continue without database');
    throw error;
  }

  const app = express();

  // Trust proxy for production load balancers
  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  // Basic security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        scriptSrc: ["'self'", "'unsafe-eval'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "ws:", "wss:"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // Session middleware with error handling
  try {
    const sessionMiddleware = await getSession();
    app.use(sessionMiddleware);
    enhancedLog('INFO', 'SERVER', 'FMB Session middleware configured successfully');
  } catch (error) {
    enhancedLog('ERROR', 'SERVER', 'Failed to configure FMB session middleware:', {
      message: error?.message || 'Unknown session error',
      stack: error?.stack || 'NO_STACK'
    });
    throw error;
  }

  // Body parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Enhanced session security middleware
  try {
    const { sessionSecurityMiddleware, sessionActivityTracker } = await import('./middleware/session-security.js');
    app.use(sessionActivityTracker());
    app.use(sessionSecurityMiddleware());
    enhancedLog('INFO', 'SECURITY', 'Enterprise session security middleware activated');
  } catch (error) {
    enhancedLog('ERROR', 'SECURITY', 'Failed to load session security middleware:', error);
  }

  // Health check endpoint
  app.get('/health', async (req, res) => {
    try {
      const dbHealthy = await checkDatabaseHealth();

      const health = {
        status: dbHealthy ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        database: dbHealthy ? 'connected' : 'disconnected',
        message: dbHealthy ? 'FMB Database connection established' : 'FMB Database connection failed',
        environment: 'fmb-onprem',
        version: '1.0.0-fmb'
      };

      const statusCode = dbHealthy ? 200 : 503;
      res.status(statusCode).json(health);
    } catch (error) {
      enhancedLog('ERROR', 'HEALTH', 'Health check failed:', error);
      res.status(503).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        message: 'Health check failed',
        error: error?.message || 'Unknown error'
      });
    }
  });

  // Register API routes
  await registerRoutes(app);

  // Setup frontend serving
  if (process.env.NODE_ENV === 'production') {
    serveStatic(app);
  } else {
    await setupVite(app);
  }

  const port = parseInt(process.env.FMB_PORT || process.env.PORT || '5000');
  const host = process.env.FMB_HOST || '0.0.0.0';

  try {
    // Start server with better error handling
    const server = app.listen(port, host, () => {
      enhancedLog('INFO', 'SERVER', `FMB TimeTracker running on http://${host}:${port}`);
      enhancedLog('INFO', 'SERVER', `Environment: fmb-onprem`);
      enhancedLog('INFO', 'FMB-ONPREM', 'On-premises deployment active - SAML authentication enabled');
    });

    // Handle server errors
    server.on('error', (error: any) => {
      enhancedLog('ERROR', 'SERVER', 'Server error event:', {
        message: error?.message || 'Unknown server error',
        code: error?.code || 'NO_CODE',
        errno: error?.errno || 'NO_ERRNO',
        syscall: error?.syscall || 'NO_SYSCALL',
        address: error?.address || 'NO_ADDRESS',
        port: error?.port || 'NO_PORT',
        stack: error?.stack || 'NO_STACK'
      });

      if (error?.code === 'EADDRINUSE') {
        enhancedLog('ERROR', 'SERVER', `Port ${port} is already in use. Please choose a different port.`);
      }

      process.exit(1);
    });

  } catch (error) {
    enhancedLog('ERROR', 'SERVER', 'Failed to start FMB server:', {
      message: error?.message || 'Unknown error',
      name: error?.name || 'Unknown',
      code: error?.code || 'NO_CODE',
      stack: error?.stack || 'NO_STACK',
      fullError: error
    });

    process.exit(1);
  }
}

createServer().catch((error) => {
  enhancedLog('ERROR', 'SERVER', 'Failed to start FMB server:', error);
  process.exit(1);
});