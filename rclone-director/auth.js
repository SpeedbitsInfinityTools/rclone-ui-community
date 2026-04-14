/**
 * Authentication & Encryption utilities for Rclone Director
 * 
 * Security Model:
 * 1. Admin password is hashed with bcrypt (stored in admin.json)
 * 2. Rclone server passwords are encrypted with admin password
 * 3. Admin password kept in sessionStorage on frontend for decryption
 */

const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || '/config';
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const SALT_ROUNDS = 12;

// In-memory session store
// In production, this should be replaced with Redis or similar
// For now, in-memory is acceptable for single-instance deployment
// NOTE: We store HASHED session keys (SHA-256) for security, not plaintext
const activeSessions = new Map(); // SHA256(sessionKey) -> { username, masterKey, createdAt, expiresAt, lastAccess }

// Session configuration (matching Borgmatic Director security standards)
const SESSION_DURATION = 30 * 60 * 1000; // 30 minutes absolute expiration
const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes of inactivity
const SESSION_CLEANUP_INTERVAL = 5 * 60 * 1000; // Clean up every 5 minutes
const MAX_SESSIONS_PER_USER = 10; // Prevent session exhaustion attacks

// Start session cleanup task
setInterval(() => {
    const now = Date.now();
    let expiredCount = 0;
    let inactiveCount = 0;
    
    for (const [hashedKey, session] of activeSessions.entries()) {
        // Check absolute expiration
        if (session.expiresAt < now) {
            activeSessions.delete(hashedKey);
            expiredCount++;
            continue;
        }
        
        // Check inactivity timeout
        if (now - session.lastAccess > INACTIVITY_TIMEOUT) {
            activeSessions.delete(hashedKey);
            inactiveCount++;
        }
    }
    
    if (expiredCount > 0 || inactiveCount > 0) {
        console.log(`[AUTH] Session cleanup: ${expiredCount} expired, ${inactiveCount} inactive. Active sessions: ${activeSessions.size}`);
    }
}, SESSION_CLEANUP_INTERVAL);

/**
 * Hash session key using SHA-256
 * We store hashed keys in memory, not plaintext
 * This prevents token theft if server memory is compromised
 * @param {string} sessionKey - Raw session key
 * @returns {string} - SHA-256 hash (hex)
 */
function hashSessionKey(sessionKey) {
    return crypto.createHash('sha256').update(sessionKey).digest('hex');
}

// ============================================================================
// ADMIN PASSWORD MANAGEMENT
// ============================================================================

/**
 * Initialize admin user with hashed password
 */
async function initializeAdmin(password) {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const adminData = {
        username: 'admin',
        passwordHash: hash,
        createdAt: new Date().toISOString(),
        version: '1.0'
    };
    
    // Ensure data directory exists
    await fs.mkdir(DATA_DIR, { recursive: true });
    
    await fs.writeFile(ADMIN_FILE, JSON.stringify(adminData, null, 2));
    console.log('[AUTH] Admin user initialized');
    return true;
}

/**
 * Load admin data
 */
async function loadAdmin() {
    try {
        const data = await fs.readFile(ADMIN_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            // Admin not initialized - use environment variable or default
            const defaultPassword = process.env.ADMIN_PASSWORD || 'admin';
            console.log('[AUTH] Admin file not found - initializing with password from environment');
            await initializeAdmin(defaultPassword);
            return loadAdmin();
        }
        throw error;
    }
}

/**
 * Verify admin password
 */
async function verifyAdminPassword(username, password) {
    if (username !== 'admin') {
        return false;
    }
    
    const admin = await loadAdmin();
    return await bcrypt.compare(password, admin.passwordHash);
}

/**
 * Change admin password
 * CRITICAL: This must re-encrypt ALL encrypted data with the new password
 * @param {string} oldPassword - Current admin password (for decryption)
 * @param {string} newPassword - New admin password (for re-encryption)
 * @param {Function} reEncryptCallback - Callback to re-encrypt all data
 */
async function changeAdminPassword(oldPassword, newPassword, reEncryptCallback) {
    const admin = await loadAdmin();
    
    // Verify old password
    const isValid = await bcrypt.compare(oldPassword, admin.passwordHash);
    if (!isValid) {
        throw new Error('Current password is incorrect');
    }
    
    // If a re-encryption callback is provided, use it to re-encrypt all data
    // This is CRITICAL to prevent data loss
    if (reEncryptCallback) {
        console.log('[AUTH] Re-encrypting all data with new password...');
        await reEncryptCallback(oldPassword, newPassword);
    }
    
    // Hash new password
    admin.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    admin.updatedAt = new Date().toISOString();
    
    await fs.writeFile(ADMIN_FILE, JSON.stringify(admin, null, 2));
    console.log('[AUTH] Admin password changed successfully');
    return true;
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

/**
 * Create a new session for authenticated user
 * @param {string} username - Username
 * @param {string} masterKey - Master encryption key derived from password
 * @returns {string} - Session key (random token, sent to client)
 */
function createSession(username, masterKey) {
    // Enforce session limit per user to prevent exhaustion attacks
    const userSessions = [];
    for (const [hashedKey, session] of activeSessions.entries()) {
        if (session.username === username) {
            userSessions.push({ hashedKey, createdAt: session.createdAt });
        }
    }
    
    // If user has too many sessions, remove the oldest one
    if (userSessions.length >= MAX_SESSIONS_PER_USER) {
        // Sort by creation time (oldest first)
        userSessions.sort((a, b) => a.createdAt - b.createdAt);
        
        // Remove oldest session
        const oldestSession = userSessions[0];
        activeSessions.delete(oldestSession.hashedKey);
        console.log(`[AUTH] Removed oldest session for ${username} (session limit: ${MAX_SESSIONS_PER_USER})`);
    }
    
    // Generate cryptographically random session key
    const sessionKey = crypto.randomBytes(32).toString('hex'); // 64 hex chars
    
    // Hash the session key before storing (security best practice)
    const hashedKey = hashSessionKey(sessionKey);
    
    const now = Date.now();
    const session = {
        username: username,
        masterKey: masterKey, // Store master key in server memory (not disk)
        createdAt: now,
        expiresAt: now + SESSION_DURATION,
        lastAccess: now
    };
    
    // Store with HASHED key, not plaintext
    activeSessions.set(hashedKey, session);
    
    console.log(`[AUTH] Session created for ${username}: ${sessionKey.substring(0, 16)}... (expires in 30 min)`);
    console.log(`[AUTH] Active sessions: ${activeSessions.size}`);
    
    // Return UNHASHED key to client (they need the original token)
    return sessionKey;
}

/**
 * Get session by session key
 * Validates expiration and inactivity timeout
 * Updates last access time on successful lookup
 * 
 * SLIDING WINDOW BEHAVIOR:
 * - If session age > 15 minutes, extend absolute expiration by another 30 minutes
 * - This keeps active users logged in indefinitely
 * - Inactivity timeout (30 min) still applies for idle sessions
 * 
 * @param {string} sessionKey - Session key (unhashed, from client)
 * @returns {object|null} - Session object or null if not found/expired
 */
function getSession(sessionKey) {
    // Hash the incoming key to look it up
    const hashedKey = hashSessionKey(sessionKey);
    const session = activeSessions.get(hashedKey);
    
    if (!session) {
        return null;
    }
    
    const now = Date.now();
    
    // Check inactivity timeout (30 minutes since last access)
    // This still applies even with sliding window
    if (now - session.lastAccess > INACTIVITY_TIMEOUT) {
        activeSessions.delete(hashedKey);
        console.log('[AUTH] Session expired (inactivity timeout)');
        return null;
    }
    
    // SLIDING WINDOW: Extend session if it's been active for more than 15 minutes
    const sessionAge = now - session.createdAt;
    const EXTENSION_THRESHOLD = 15 * 60 * 1000; // 15 minutes
    
    if (sessionAge > EXTENSION_THRESHOLD) {
        // Extend the absolute expiration by another 30 minutes
        session.expiresAt = now + SESSION_DURATION;
        console.log(`[AUTH] Session extended (active for ${Math.floor(sessionAge / 60000)} min)`);
    }
    
    // Update last access time (session is still active)
    session.lastAccess = now;
    
    return session;
}

/**
 * Destroy a session
 * @param {string} sessionKey - Session key to destroy (unhashed, from client)
 */
function destroySession(sessionKey) {
    const hashedKey = hashSessionKey(sessionKey);
    const existed = activeSessions.delete(hashedKey);
    if (existed) {
        console.log(`[AUTH] Session destroyed: ${sessionKey.substring(0, 16)}...`);
    }
}

/**
 * Destroy all sessions for a user (e.g., on password change)
 * @param {string} username - Username
 */
function destroyAllUserSessions(username) {
    let count = 0;
    for (const [hashedKey, session] of activeSessions.entries()) {
        if (session.username === username) {
            activeSessions.delete(hashedKey);
            count++;
        }
    }
    console.log(`[AUTH] Destroyed ${count} sessions for user: ${username}`);
}

/**
 * Refresh/extend a session (reset expiration timer)
 * This is called when user performs an action to extend their session
 * @param {string} sessionKey - Session key (unhashed, from client)
 * @returns {boolean} - True if session was refreshed, false if not found
 */
function refreshSession(sessionKey) {
    const hashedKey = hashSessionKey(sessionKey);
    const session = activeSessions.get(hashedKey);
    
    if (!session) {
        return false;
    }
    
    const now = Date.now();
    
    // Extend expiration and update last access
    session.expiresAt = now + SESSION_DURATION;
    session.lastAccess = now;
    
    console.log(`[AUTH] Session refreshed: ${sessionKey.substring(0, 16)}... (new expiration: 30 min from now)`);
    return true;
}

/**
 * Get session statistics
 * @returns {object} - { activeCount, totalCreated }
 */
function getSessionStats() {
    return {
        activeCount: activeSessions.size,
        sessionDuration: SESSION_DURATION / 1000 / 60, // in minutes
        inactivityTimeout: INACTIVITY_TIMEOUT / 1000 / 60 // in minutes
    };
}

/**
 * Get the most recently active master key from authenticated sessions.
 * Used by background services that need to decrypt stored credentials.
 * @returns {string|null} Hex-encoded master key or null
 */
function getAnyActiveMasterKey() {
    let newest = null;
    for (const session of activeSessions.values()) {
        if (!newest || session.lastAccess > newest.lastAccess) {
            newest = session;
        }
    }
    return newest?.masterKey || null;
}

// ============================================================================
// PASSWORD ENCRYPTION/DECRYPTION
// ============================================================================

/**
 * Derive encryption key from admin password
 * Uses PBKDF2 to derive a consistent 32-byte key from the password
 * Iterations: 600,000 (OWASP 2023 recommendation for PBKDF2-SHA256)
 * @param {string|Buffer} password - Password or master key
 * @param {Buffer} salt - Salt for key derivation
 * @returns {Buffer} - Derived 32-byte key
 */
function deriveKey(password, salt) {
    // OWASP recommends 600,000 iterations for PBKDF2-SHA256 (as of 2023)
    // This significantly increases resistance to brute-force attacks
    return crypto.pbkdf2Sync(password, salt, 600000, 32, 'sha256');
}

/**
 * Derive master encryption key from admin password
 * This is done ONCE at login and the result is stored in sessionStorage
 * Uses a fixed salt to ensure consistency (same password = same key)
 * @param {string} password - The admin password
 * @returns {string} - Hex-encoded master encryption key
 */
function deriveMasterKey(password) {
    // Use a fixed application-wide salt for master key derivation
    // This ensures the same password always produces the same master key
    // Note: This salt is not secret - it's just for key derivation consistency
    const MASTER_KEY_SALT = Buffer.from('rclone-director-master-key-salt-v1', 'utf8');
    
    // Derive a 32-byte master key from the password
    const masterKey = crypto.pbkdf2Sync(password, MASTER_KEY_SALT, 600000, 32, 'sha256');
    
    return masterKey.toString('hex');
}

/**
 * Encrypt rclone server password with admin password or master key
 * @param {string} plaintext - The password to encrypt
 * @param {string} adminPasswordOrKey - Either plaintext password OR master key (hex string)
 * @returns {object} - { encrypted, salt, iv }
 */
function encryptPassword(plaintext, adminPasswordOrKey) {
    try {
        // Determine if we received a master key (64 hex chars) or plaintext password
        const isMasterKey = /^[0-9a-f]{64}$/i.test(adminPasswordOrKey);
        let masterKeyBuffer;
        
        if (isMasterKey) {
            // Already a master key - use directly
            masterKeyBuffer = Buffer.from(adminPasswordOrKey, 'hex');
        } else {
            // Plaintext password - derive master key first
            const masterKeyHex = deriveMasterKey(adminPasswordOrKey);
            masterKeyBuffer = Buffer.from(masterKeyHex, 'hex');
        }
        
        // Generate random salt for this specific encryption
        const salt = crypto.randomBytes(16);
        
        // Derive encryption key from master key + salt
        const key = deriveKey(masterKeyBuffer, salt);
        
        // Generate random IV
        const iv = crypto.randomBytes(16);
        
        // Encrypt
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        // Return: salt + iv + encrypted (all as hex)
        return {
            encrypted: encrypted,
            salt: salt.toString('hex'),
            iv: iv.toString('hex')
        };
    } catch (error) {
        console.error('[AUTH] Encryption error:', error.message);
        throw new Error('Failed to encrypt password');
    }
}

/**
 * Decrypt rclone server password with admin password or master key
 * @param {object} encryptedData - { encrypted, salt, iv }
 * @param {string} adminPasswordOrKey - Either plaintext password OR master key (hex string)
 * @returns {string} - Decrypted plaintext
 */
function decryptPassword(encryptedData, adminPasswordOrKey) {
    try {
        const { encrypted, salt, iv } = encryptedData;
        
        // Determine if we received a master key (64 hex chars) or plaintext password
        const isMasterKey = /^[0-9a-f]{64}$/i.test(adminPasswordOrKey);
        let masterKeyBuffer;
        
        if (isMasterKey) {
            // Already a master key - use directly
            masterKeyBuffer = Buffer.from(adminPasswordOrKey, 'hex');
        } else {
            // Plaintext password - derive master key first
            const masterKeyHex = deriveMasterKey(adminPasswordOrKey);
            masterKeyBuffer = Buffer.from(masterKeyHex, 'hex');
        }
        
        // Derive decryption key from master key + salt
        const key = deriveKey(masterKeyBuffer, Buffer.from(salt, 'hex'));
        
        // Decrypt
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(iv, 'hex'));
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (error) {
        console.error('[AUTH] Decryption error:', error.message);
        throw new Error('Failed to decrypt password - incorrect admin password?');
    }
}

// ============================================================================
// EXPRESS MIDDLEWARE
// ============================================================================

/**
 * Authentication middleware for protected routes
 * Accepts session key in X-Session-Key header
 * Session key is issued at login and stored on backend
 */
async function requireAdminAuth(req, res, next) {
    try {
        // Get session key from header
        let sessionKey = null;
        
        // Check X-Session-Key header (primary method)
        if (req.headers['x-session-key']) {
            sessionKey = req.headers['x-session-key'];
        }
        
        // Check Authorization header (Bearer token format)
        if (!sessionKey) {
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                sessionKey = authHeader.substring(7);
            }
        }
        
        // BACKWARD COMPATIBILITY: Also accept X-Admin-Password for migration period
        // This allows old clients to continue working
        if (!sessionKey && req.headers['x-admin-password']) {
            const value = req.headers['x-admin-password'];
            
            // Check if it's a valid session key format (64 hex chars)
            if (/^[0-9a-f]{64}$/i.test(value)) {
                // Could be a session key from old deployment
                sessionKey = value;
            } else {
                // It's a plaintext password - verify and create temp session
                const isValid = await verifyAdminPassword('admin', value);
                if (!isValid) {
                    return res.status(401).json({ 
                        error: 'Authentication failed',
                        message: 'Invalid admin password' 
                    });
                }
                
                // Derive master key and create temporary session
                const masterKey = deriveMasterKey(value);
                sessionKey = createSession('admin', masterKey);
                console.log('[AUTH] Created temporary session for legacy client');
            }
        }
        
        if (!sessionKey) {
            return res.status(401).json({ 
                error: 'Authentication required',
                message: 'Session key must be provided in X-Session-Key header' 
            });
        }
        
        // Validate session
        const session = getSession(sessionKey);
        if (!session) {
            return res.status(401).json({ 
                error: 'Authentication failed',
                message: 'Invalid or expired session' 
            });
        }
        
        // Store session info in request for use in route handlers
        req.session = session;
        req.sessionKey = sessionKey;
        req.adminPassword = session.masterKey; // For encryption/decryption operations
        
        next();
    } catch (error) {
        console.error('[AUTH] Authentication error:', error);
        res.status(500).json({ error: 'Authentication error', details: error.message });
    }
}

/**
 * Check if admin is initialized
 */
async function isAdminInitialized() {
    try {
        await fs.access(ADMIN_FILE);
        return true;
    } catch {
        return false;
    }
}

module.exports = {
    initializeAdmin,
    loadAdmin,
    verifyAdminPassword,
    changeAdminPassword,
    encryptPassword,
    decryptPassword,
    deriveMasterKey,
    createSession,
    getSession,
    destroySession,
    destroyAllUserSessions,
    refreshSession,
    getSessionStats,
    getAnyActiveMasterKey,
    requireAdminAuth,
    isAdminInitialized
};

