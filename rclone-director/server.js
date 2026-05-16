#!/usr/bin/env node
/**
 * ============================================================================
 * Rclone Director - Backend API Proxy
 * ============================================================================
 * 
 * A smart proxy layer between the frontend and multiple rclone backends.
 * 
 * Features:
 * - Multi-server management (CRUD operations)
 * - Transparent proxying of all rclone API calls
 * - Native mount persistence (no systemd timers needed)
 * - Server-side credential management
 * - Request logging and error handling
 * 
 * (c) 2025 Infinity Tools by Smart In Venture / www.speedbits.io
 * ============================================================================
 */

require('dotenv').config();

const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { PORT } = require('./config/constants');

// ============================================================================
// ERROR LOG CONFIGURATION - Prevents log explosion (see post-mortem)
// ============================================================================
const ERROR_LOG_CONFIG = {
    maxSizeMB: 200,          // Max log file size before rotation (200MB)
    rateLimitMs: 5000,       // Don't log same error within this window (5 seconds)
    floodThreshold: 100,     // Exit if this many errors in floodWindowMs
    floodWindowMs: 60000,    // Time window for flood detection (60 seconds)
};

// Error tracking state
let lastErrorMessage = null;
let lastErrorTime = 0;
let errorTimestamps = [];    // Rolling window of error timestamps

// Logs directory
const LOGS_DIR = process.env.LOGS_DIR || './logs';

/**
 * Sanitize URLs and data for logging - removes sensitive credentials
 * @param {string} str - String that might contain credentials
 * @returns {string} - Sanitized string
 */
function sanitizeForLogs(str) {
    if (!str || typeof str !== 'string') return str;
    
    let sanitized = str;
    
    // Mask OAuth tokens in URLs: code=xxx, token=xxx, access_token=xxx, etc.
    sanitized = sanitized.replace(/([?&](?:code|token|access_token|refresh_token|id_token|state)=)[^&\s"'}]+/gi, '$1***');
    
    // Mask Bearer tokens in headers
    sanitized = sanitized.replace(/(Bearer\s+)[^\s"']+/gi, '$1***');
    
    // Mask Authorization header values
    sanitized = sanitized.replace(/(["']?authorization["']?\s*:\s*["']?)[^"',}\s]+/gi, '$1***');
    
    // Mask client_secret values
    sanitized = sanitized.replace(/(["']?client_secret["']?\s*:\s*["']?)[^"',}\s]+/gi, '$1***');
    
    // Mask password values
    sanitized = sanitized.replace(/(["']?password["']?\s*:\s*["']?)[^"',}\s]+/gi, '$1***');
    
    // Mask S3-style credentials: s3:ACCESS_KEY:SECRET_KEY@...
    sanitized = sanitized.replace(/s3:[^:]+:[^@]+@/gi, 's3:***@');
    sanitized = sanitized.replace(/s3%3A[^%]+%3A[^%]+%40/gi, 's3%3A***%40');
    
    // Mask X-Session-Key header values (64 hex chars)
    sanitized = sanitized.replace(/(["']?x-session-key["']?\s*:\s*["']?)[0-9a-f]{64}/gi, '$1***');
    
    return sanitized;
}

/**
 * Sanitize an object recursively for logging
 * @param {any} obj - Object to sanitize
 * @returns {any} - Sanitized object
 */
function sanitizeObjectForLogs(obj) {
    if (!obj) return obj;
    if (typeof obj === 'string') return sanitizeForLogs(obj);
    if (typeof obj !== 'object') return obj;
    
    // Handle arrays
    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObjectForLogs(item));
    }
    
    // Handle objects
    const sanitized = {};
    const sensitiveKeys = ['password', 'token', 'access_token', 'refresh_token', 'id_token', 
                          'client_secret', 'authorization', 'x-session-key', 'code', 'state'];
    
    for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase();
        if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
            sanitized[key] = '***';
        } else if (typeof value === 'object' && value !== null) {
            sanitized[key] = sanitizeObjectForLogs(value);
        } else if (typeof value === 'string') {
            sanitized[key] = sanitizeForLogs(value);
        } else {
            sanitized[key] = value;
        }
    }
    
    return sanitized;
}

/**
 * Write error to file with size limits, rotation, rate limiting, and flood protection
 * @param {string} title - Error title
 * @param {object} payload - Error details
 */
function writeFatalErrorLog(title, payload) {
    const now = Date.now();
    const errorMessage = `${title}: ${payload.message || payload.reason || 'Unknown'}`;
    
    // ========================================================================
    // RATE LIMITING: Skip if same error occurred within rate limit window
    // ========================================================================
    if (lastErrorMessage === errorMessage && (now - lastErrorTime) < ERROR_LOG_CONFIG.rateLimitMs) {
        return; // Skip duplicate error
    }
    lastErrorMessage = errorMessage;
    lastErrorTime = now;
    
    // ========================================================================
    // FLOOD PROTECTION: Exit if too many errors in time window
    // ========================================================================
    // Clean up old timestamps outside the window
    errorTimestamps = errorTimestamps.filter(ts => (now - ts) < ERROR_LOG_CONFIG.floodWindowMs);
    errorTimestamps.push(now);
    
    if (errorTimestamps.length > ERROR_LOG_CONFIG.floodThreshold) {
        console.error('');
        console.error('🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨');
        console.error('🚨 FATAL: Error flood detected!');
        console.error(`🚨 ${errorTimestamps.length} errors in ${ERROR_LOG_CONFIG.floodWindowMs / 1000} seconds`);
        console.error('🚨 Exiting immediately to prevent log explosion / disk exhaustion');
        console.error('🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨🚨');
        console.error('');
        process.exit(1);
    }
    
    // ========================================================================
    // WRITE TO ERROR LOG FILE (with size limits and rotation)
    // ========================================================================
    try {
        // Ensure logs directory exists
        if (!fs.existsSync(LOGS_DIR)) {
            fs.mkdirSync(LOGS_DIR, { recursive: true });
        }
        
        const logPath = path.join(LOGS_DIR, 'server-errors.log');
        const oldLogPath = path.join(LOGS_DIR, 'server-errors.log.old');
        
        // Check file size and rotate if needed
        try {
            const stats = fs.statSync(logPath);
            if (stats.size > ERROR_LOG_CONFIG.maxSizeMB * 1024 * 1024) {
                // Rotate: delete old backup, rename current to .old
                if (fs.existsSync(oldLogPath)) {
                    fs.unlinkSync(oldLogPath);
                }
                fs.renameSync(logPath, oldLogPath);
                console.log(`[ERROR-LOG] Rotated log file (was ${Math.round(stats.size / 1024 / 1024)}MB)`);
            }
        } catch (e) {
            // File doesn't exist yet - that's fine
        }
        
        // Sanitize payload before writing
        const sanitizedPayload = sanitizeObjectForLogs(payload);
        
        // Write error entry
        const entry = [
            '================================================================================',
            `[${new Date().toISOString()}] ${title}`,
            '================================================================================',
            JSON.stringify(sanitizedPayload, null, 2),
            '',
            ''
        ].join('\n');
        
        fs.appendFileSync(logPath, entry, 'utf8');
        
    } catch (writeError) {
        // If we can't write to log file, at least log to console
        console.error('[ERROR-LOG] Failed to write to error log file:', writeError.message);
    }
}

// Import routes
const authRoutes = require('./routes/auth.routes');
let serversRoutes;
try {
    serversRoutes = require('./routes/servers.routes');
} catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
        console.error('');
        console.error('╔════════════════════════════════════════════════════════════════╗');
        console.error('║              ERROR: Missing servers.routes.js                 ║');
        console.error('╠════════════════════════════════════════════════════════════════╣');
        console.error('║  This commercial Docker image requires Infinity Tools         ║');
        console.error('║  deployment. The servers.routes.js file must be injected by   ║');
        console.error('║  Infinity Tools during container deployment.                 ║');
        console.error('║                                                                ║');
        console.error('║  Please use Infinity Tools to deploy this image.              ║');
        console.error('║  Visit: https://www.speedbits.io                             ║');
        console.error('╚════════════════════════════════════════════════════════════════╝');
        console.error('');
        process.exit(1);
    }
    throw error;
}
const templatesRoutes = require('./routes/templates.routes');
const backupRoutes = require('./routes/backup.routes');
const oauthRoutes = require('./routes/oauth.routes');
const mountsRoutes = require('./routes/mounts.routes');
const proxyRoutes = require('./routes/proxy.routes');
const healthRoutes = require('./routes/health.routes');
const filesystemRoutes = require('./routes/filesystem.routes');
const notificationsRoutes = require('./routes/notifications.routes');
const healthMonitor = require('./services/health-monitor.service');

// Wire health monitor into notification routes
notificationsRoutes.setHealthMonitor(healthMonitor);

const app = express();

// ============================================================================
// MIDDLEWARE
// ============================================================================

app.use(cors());
app.use(morgan('combined'));

// URL-encoded parser (for OAuth POST callbacks and form submissions)
app.use(express.urlencoded({ extended: false }));

// JSON parser for non-file routes
app.use((req, res, next) => {
    // Skip JSON parsing for file upload routes (handled in proxy.routes.js)
    if (req.path.includes('/operations/uploadfile')) {
        return next();
    }
    express.json({ limit: '50mb' })(req, res, next);
});

// ============================================================================
// ROUTES
// ============================================================================

// Health check (must come first, before authentication)
app.use('/director/health', healthRoutes);

// Authentication
app.use('/director/auth', authRoutes);

// Server management
app.use('/director/servers', serversRoutes);

// Template management
app.use('/director/templates', templatesRoutes);

// Backup & Restore
app.use('/director/backup', backupRoutes);

// OAuth
// Mounted at BOTH paths:
//   /director/oauth       — internal/legacy path used by the bundled nginx
//                           (location /api/director/ → proxy_pass /director/), so nginx
//                           rewrites the incoming /api/director/oauth/* down to /director/oauth/*.
//   /api/director/oauth   — public path used by the OAuth provider redirect_uri and by the
//                           RcloneAuthApp helper when forwarding callbacks. Mounting it here
//                           too means direct-to-Director deployments (no proxy in front) work
//                           with the same helper without per-deployment configuration.
app.use('/director/oauth', oauthRoutes);
app.use('/api/director/oauth', oauthRoutes);

// Mounts
app.use('/director/mount', mountsRoutes);
app.use('/director/mounts', mountsRoutes);

// Notifications & Health Monitoring
app.use('/director/notifications', notificationsRoutes);

// Filesystem browser
app.use('/director/filesystem', filesystemRoutes);

// Rclone API Proxy (must come last - catch-all)
app.use('/rclone', proxyRoutes);

// ============================================================================
// ERROR HANDLING
// ============================================================================

// 404 handler
app.use((req, res) => {
            res.status(404).json({ 
        error: 'Not Found',
        message: `Cannot ${req.method} ${req.path}`,
        availableEndpoints: [
            '/director/health',
            '/director/auth/*',
            '/director/servers/*',
            '/director/templates/*',
            '/director/backup/*',
            '/director/oauth/*',
            '/director/mount/*',
            '/director/mounts/*',
            '/director/notifications/*',
            '/director/filesystem/*',
            '/rclone/*'
        ]
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('[ERROR]', err.stack);
    res.status(err.status || 500).json({
        error: err.message || 'Internal Server Error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    Rclone Director API                         ║');
    console.log('╠════════════════════════════════════════════════════════════════╣');
    console.log(`║  [OK] Server listening on port ${PORT}`.padEnd(67, ' ') + '║');
    console.log(`║  [OK] Health check: http://localhost:${PORT}/director/health`.padEnd(67, ' ') + '║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('[SERVER] Rclone Director started successfully');
    console.log('[SERVER] Press Ctrl+C to stop');

    // Initialize health monitor (loads state, auto-starts if configured)
    healthMonitor.initialize().catch(err => {
        console.error('[SERVER] Health monitor initialization failed:', err.message);
    });
});

// ============================================================================
// CRASH PREVENTION - Global Error Handlers
// ============================================================================
// IMPORTANT: Fatal errors MUST exit to prevent infinite error loops.
// Use a process manager (PM2, Docker restart policy, systemd) for auto-restart.
// See post-mortem: Log file explosion caused by non-exiting error handlers.
// ============================================================================

// Catch uncaught exceptions (synchronous errors not caught in try-catch)
process.on('uncaughtException', (error) => {
    console.error('');
    console.error('🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑');
    console.error('[FATAL] Uncaught Exception - Director will exit');
    console.error('🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('');
    
    // Write to error log file (with all protections)
    writeFatalErrorLog('Uncaught Exception', {
        message: error.message,
        stack: error.stack,
        name: error.name,
        code: error.code,
        timestamp: new Date().toISOString()
    });
    
    // Exit after brief delay to allow log write to complete
    // Process manager (Docker, PM2, systemd) will restart us
    setTimeout(() => {
        console.error('🛑 Exiting due to uncaught exception (process manager will restart)');
        process.exit(1);
    }, 1000);
});

// Catch unhandled promise rejections (async errors not caught)
process.on('unhandledRejection', (reason, promise) => {
    console.error('');
    console.error('🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑');
    console.error('[FATAL] Unhandled Promise Rejection - Director will exit');
    console.error('🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑🛑');
    console.error('Reason:', reason);
    console.error('');
    
    // Write to error log file (with all protections)
    writeFatalErrorLog('Unhandled Promise Rejection', {
        reason: reason instanceof Error ? {
            message: reason.message,
            stack: reason.stack,
            name: reason.name
        } : String(reason),
        timestamp: new Date().toISOString()
    });
    
    // Exit after brief delay to allow log write to complete
    setTimeout(() => {
        console.error('🛑 Exiting due to unhandled rejection (process manager will restart)');
        process.exit(1);
    }, 1000);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('\n[SERVER] SIGTERM received, shutting down gracefully...');
    healthMonitor.stop();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('\n[SERVER] SIGINT received, shutting down gracefully...');
    healthMonitor.stop();
    process.exit(0);
});
