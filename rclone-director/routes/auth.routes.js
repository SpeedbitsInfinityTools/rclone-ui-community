/**
 * Authentication Routes
 * Handles login, logout, password changes, and session management
 */

const express = require('express');
const router = express.Router();
const auth = require('../auth');
const { loadServers, saveServers, loadTemplates, saveTemplates } = require('../services/data.service');
let mountRestore = null;
try {
    mountRestore = require('../services/mount-restore.service');
} catch (_e) {
    // Optional dependency in older deployments.
}

/**
 * POST /director/auth/login - Verify admin password and create session
 * Returns a random session key that's stored on the backend
 * The master encryption key is stored in server memory (not sent to frontend)
 */
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }
        
        const isValid = await auth.verifyAdminPassword(username, password);
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        // Derive master encryption key from password
        const masterKey = auth.deriveMasterKey(password);
        
        // Create session and store master key on SERVER (not sent to frontend!)
        const sessionKey = auth.createSession(username, masterKey);
        
        // Cache master key for the mount auto-restore loop so it can decrypt
        // encrypted server passwords without a live request. Done lazily so a
        // missing module doesn't break login.
        try {
            if (mountRestore && typeof mountRestore.setMasterKey === 'function') {
                mountRestore.setMasterKey(masterKey);
            }
        } catch (_e) { /* mount-restore service is optional */ }
        
        console.log('[AUTH] Login successful, session created');
        
        res.json({ 
            success: true,
            username: 'admin',
            sessionKey: sessionKey, // Send SESSION KEY (random token), not master key!
            message: 'Authentication successful'
        });
    } catch (error) {
        console.error('[AUTH] Login error:', error);
        res.status(500).json({ error: 'Authentication error', details: error.message });
    }
});

/**
 * POST /director/auth/change-password - Change admin password
 * Requires authentication
 * CRITICAL: Re-encrypts all server passwords and template credentials with new password
 */
router.post('/change-password', auth.requireAdminAuth, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ error: 'Old and new passwords required' });
        }
        
        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters' });
        }
        
        // CRITICAL: Re-encrypt all data with new password
        const reEncryptAllData = async (oldPass, newPass) => {
            console.log('[AUTH] Starting re-encryption of all data...');
            
            // 1. Re-encrypt server passwords
            const servers = await loadServers();
            for (const server of servers.servers) {
                if (server.encryptedPassword) {
                    try {
                        // Decrypt with old password
                        const plaintext = auth.decryptPassword(server.encryptedPassword, oldPass);
                        // Re-encrypt with new password
                        server.encryptedPassword = auth.encryptPassword(plaintext, newPass);
                    } catch (error) {
                        console.error(`[AUTH] Failed to re-encrypt server ${server.name}:`, error);
                        throw new Error(`Failed to re-encrypt server "${server.name}". Password change aborted.`);
                    }
                }
            }
            await saveServers(servers);
            console.log(`[AUTH] Re-encrypted ${servers.servers.length} server passwords`);
            
            // 2. Re-encrypt template parameters
            const templates = await loadTemplates();
            for (const template of templates) {
                try {
                    // Re-encrypt main parameters
                    for (const [key, paramObj] of Object.entries(template.parameters)) {
                        if (paramObj.encrypted) {
                            const plaintext = auth.decryptPassword(paramObj.value, oldPass);
                            template.parameters[key].value = auth.encryptPassword(plaintext, newPass);
                        }
                    }
                    
                    // Re-encrypt base remote parameters if present
                    if (template.baseRemote && template.baseRemote.parameters) {
                        for (const [key, paramObj] of Object.entries(template.baseRemote.parameters)) {
                            if (paramObj.encrypted) {
                                const plaintext = auth.decryptPassword(paramObj.value, oldPass);
                                template.baseRemote.parameters[key].value = auth.encryptPassword(plaintext, newPass);
                            }
                        }
                    }
                } catch (error) {
                    console.error(`[AUTH] Failed to re-encrypt template ${template.name}:`, error);
                    throw new Error(`Failed to re-encrypt template "${template.name}". Password change aborted.`);
                }
            }
            await saveTemplates(templates);
            console.log(`[AUTH] Re-encrypted ${templates.length} template credentials`);
            
            console.log('[AUTH] All data successfully re-encrypted');
        };
        
        // Change password with re-encryption callback
        await auth.changeAdminPassword(oldPassword, newPassword, reEncryptAllData);
        
        // CRITICAL: Destroy ALL sessions after password change
        // This forces all users to re-login with the new password
        auth.destroyAllUserSessions('admin');
        if (mountRestore && typeof mountRestore.clearMasterKey === 'function') {
            mountRestore.clearMasterKey();
        }
        console.log('[AUTH] All sessions destroyed after password change');
        
        res.json({ 
            success: true,
            message: 'Password changed successfully. All encrypted data has been re-encrypted. Please log in again.'
        });
    } catch (error) {
        console.error('[AUTH] Password change error:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /director/auth/logout - Destroy current session
 * Requires authentication
 */
router.post('/logout', auth.requireAdminAuth, (req, res) => {
    try {
        const sessionKey = req.sessionKey;
        auth.destroySession(sessionKey);
        if (mountRestore && typeof mountRestore.clearMasterKey === 'function') {
            mountRestore.clearMasterKey();
        }
        
        res.json({ 
            success: true,
            message: 'Logged out successfully'
        });
    } catch (error) {
        console.error('[AUTH] Logout error:', error);
        res.status(500).json({ error: 'Logout failed' });
    }
});

/**
 * POST /director/auth/refresh - Refresh/extend current session
 * Requires authentication
 * Extends session expiration by another 30 minutes
 */
router.post('/refresh', auth.requireAdminAuth, (req, res) => {
    try {
        const sessionKey = req.sessionKey;
        const refreshed = auth.refreshSession(sessionKey);
        
        if (refreshed) {
            res.json({ 
                success: true,
                message: 'Session refreshed successfully',
                expiresIn: 30 * 60 // 30 minutes in seconds
            });
        } else {
            res.status(404).json({ 
                success: false,
                error: 'Session not found'
            });
        }
    } catch (error) {
        console.error('[AUTH] Refresh error:', error);
        res.status(500).json({ error: 'Refresh failed' });
    }
});

/**
 * GET /director/auth/session-stats - Get session statistics (for monitoring)
 * Protected endpoint (requires auth)
 */
router.get('/session-stats', auth.requireAdminAuth, (req, res) => {
    try {
        const stats = auth.getSessionStats();
        res.json(stats);
    } catch (error) {
        console.error('[AUTH] Session stats error:', error);
        res.status(500).json({ error: 'Failed to get session stats' });
    }
});

/**
 * GET /director/auth/status - Check if admin is initialized
 */
router.get('/status', async (req, res) => {
    try {
        const initialized = await auth.isAdminInitialized();
        res.json({ 
            initialized,
            requiresSetup: !initialized
        });
    } catch (error) {
        console.error('[AUTH] Status check error:', error);
        res.status(500).json({ error: 'Status check failed', details: error.message });
    }
});

module.exports = router;

