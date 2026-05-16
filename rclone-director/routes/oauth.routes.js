/**
 * OAuth Routes
 * Handles OAuth authentication flows for rclone remotes
 * Delegates to oauth/index.js module for provider-specific implementations
 */

const express = require('express');
const router = express.Router();
const axios = require('axios'); // For direct API calls to OAuth providers
const auth = require('../auth');
const oauthHandlers = require('../oauth');
const { loadServers } = require('../services/data.service');
const { axiosInstance } = require('../services/server.service');

// In-memory store for OAuth state (maps state -> { remoteName, remoteType, serverId, createdAt })
// Used to match OAuth callbacks with the original OAuth request
// In production, consider using Redis or database for persistence across restarts
const oauthStateStore = new Map();

// Debug mode - only log verbose OAuth info when explicitly enabled
const DEBUG_OAUTH = process.env.DEBUG_OAUTH === 'true';

/**
 * Debug logging helper - only logs when DEBUG_OAUTH=true
 */
function debugLog(...args) {
    if (DEBUG_OAUTH) {
        console.log(...args);
    }
}

/**
 * Sanitize data for logging - removes sensitive OAuth tokens and credentials
 * @param {any} data - Data to sanitize
 * @returns {any} - Sanitized data safe for logging
 */
function sanitizeForLog(data) {
    if (!data) return data;
    if (typeof data === 'string') {
        // Mask OAuth codes, tokens, secrets in strings
        return data
            .replace(/([?&](?:code|token|access_token|refresh_token|id_token)=)[^&\s"'}]+/gi, '$1***')
            .replace(/(Bearer\s+)[^\s"']+/gi, '$1***')
            .replace(/(["']?(?:authorization|x-session-key|x-callback-token)["']?\s*:\s*["']?)[^"',}\s]+/gi, '$1***');
    }
    if (typeof data !== 'object') return data;
    
    // Handle objects
    const sanitized = Array.isArray(data) ? [] : {};
    const sensitiveKeys = ['code', 'token', 'access_token', 'refresh_token', 'id_token', 
                          'client_secret', 'authorization', 'x-session-key', 'x-callback-token',
                          'password', 'state'];
    
    for (const [key, value] of Object.entries(data)) {
        const lowerKey = key.toLowerCase();
        if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
            sanitized[key] = '***';
        } else if (typeof value === 'object' && value !== null) {
            sanitized[key] = sanitizeForLog(value);
        } else if (typeof value === 'string') {
            sanitized[key] = sanitizeForLog(value);
        } else {
            sanitized[key] = value;
        }
    }
    return sanitized;
}

/**
 * Helper: Get server by ID
 */
async function getServerById(serverId) {
    const config = await loadServers();
    return config.servers.find(s => s.id === serverId);
}

/**
 * Helper: Get default server
 */
async function getDefaultServer() {
    const config = await loadServers();
    const defaultId = config.defaultServerId || 'default';
    return config.servers.find(s => s.id === defaultId) || config.servers[0];
}

/**
 * POST /director/oauth/authorize - Start OAuth flow for a remote
 * Protected: Requires admin authentication
 * 
 * This endpoint handles OAuth flows for remotes like Dropbox, Google Drive, etc.
 * Uses Rclone's headless OAuth endpoints (noopauth/get) which do NOT start a webserver.
 * 
 * Implementation details:
 * - Uses Rclone's `noopauth/get` endpoint to get auth URL without starting webserver
 * - No port conflicts! No localhost:53682 webserver needed
 * - Returns auth_url to frontend to open in popup
 * - Stores OAuth state temporarily for callback matching
 * - Callback endpoint uses `noopauth/callback` to complete OAuth flow
 * 
 * This is the recommended approach for headless Rclone RCD environments.
 * See: https://rclone.org/rc/#noopauth-get and https://rclone.org/rc/#noopauth-callback
 */
router.post('/authorize', auth.requireAdminAuth, async (req, res) => {
    try {
        const { name, type, parameters, serverId } = req.body;
        const adminPassword = req.adminPassword;
        
        if (!name || !type) {
            return res.status(400).json({ error: 'Missing required fields: name, type' });
        }
        
        // Check if this provider is implemented in our new OAuth module
        if (oauthHandlers.providers[type]) {
            // Use new OAuth implementation
            console.log(`[OAUTH] Using new OAuth implementation for ${type}`);
            return await oauthHandlers.handleAuthorize(req, res, getServerById, getDefaultServer, axiosInstance);
        }
        
        // Provider not yet implemented in our OAuth module
        console.log(`[OAUTH] Provider "${type}" is not yet supported for OAuth authentication`);
        
        const supportedProviders = Object.keys(oauthHandlers.providers).join(', ');
        return res.status(400).json({ 
            error: `OAuth for "${type}" is not yet supported`,
            details: `This provider's OAuth flow has not been implemented yet. Supported providers: ${supportedProviders}. For "${type}", please use account key, SAS URL, or connection string authentication instead.`,
            supported_providers: Object.keys(oauthHandlers.providers)
        });
        
        /* 
         * Legacy noopauth fallback (disabled - rc/noopauth/get does not exist in rclone)
         * Kept for reference if rclone adds this endpoint in the future
         */
        if (false) { // eslint-disable-line no-constant-condition
        // Get target server
        const server = serverId ? await getServerById(serverId) : await getDefaultServer();
        if (!server) {
            return res.status(404).json({ error: 'No rclone server configured' });
        }
        
        // Decrypt password
        let password = server.password;
        if (server.encryptedPassword) {
            try {
                password = auth.decryptPassword(server.encryptedPassword, adminPassword);
            } catch (error) {
                return res.status(401).json({ error: 'Failed to decrypt server credentials' });
            }
        }
        
        // Clean up parameters - remove empty OAuth fields to use Rclone defaults
        // Handle case where parameters is undefined or null
        const cleanParams = { ...(parameters || {}) };
        if (!cleanParams.client_id || cleanParams.client_id === '') {
            delete cleanParams.client_id;
        }
        if (!cleanParams.client_secret || cleanParams.client_secret === '') {
            delete cleanParams.client_secret;
        }
        
        console.log(`[OAUTH] Starting headless OAuth flow for ${type} remote "${name}"`);
        
        try {
            const response = await axiosInstance.post(
                `${server.url}/rc/noopauth/get`,
                {
                    type: type
                },
                {
                    auth: { username: server.username, password: password },
                    timeout: 10000
                }
            );
            
            // Extract auth URL from response
            let authUrl = null;
            if (response.data) {
                authUrl = response.data.url || 
                         response.data.result?.url ||
                         response.data.auth_url;
            }
            
            if (authUrl) {
                console.log(`[OAUTH] Auth URL received for ${name} (headless mode)`);
                
                // Replace redirect_uri with our public callback endpoint ONLY if Rclone includes it.
                // In headless mode, Rclone may use urn:ietf:wg:oauth:2.0:oob or similar.
                // Use the /api/director/* path so the URL works behind nginx (which routes
                // /api/director/* → upstream /director/*). Director also mounts its OAuth router
                // at /api/director/oauth as a safety net for direct-Node deployments.
                const publicCallbackUrl = `${req.protocol}://${req.get('host')}/api/director/oauth/callback`;
                
                let urlObj = null;
                let stateParam = null;
                
                try {
                    urlObj = new URL(authUrl);
                    if (urlObj.searchParams.has('redirect_uri')) {
                        // Only replace if redirect_uri exists (some providers ignore it anyway)
                        const currentRedirectUri = urlObj.searchParams.get('redirect_uri');
                        // Only replace localhost:53682 patterns, leave others unchanged
                        if (currentRedirectUri.includes('localhost:53682') || currentRedirectUri.includes('127.0.0.1:53682')) {
                            urlObj.searchParams.set('redirect_uri', publicCallbackUrl);
                            authUrl = urlObj.toString();
                            console.log(`[OAUTH] Replaced redirect_uri with public callback URL`);
                        }
                    }
                    
                    // Extract state parameter from parsed URL
                    stateParam = urlObj.searchParams.get('state');
                } catch (urlError) {
                    // If URL parsing fails, log warning and try to extract state with regex fallback
                    console.warn('[OAUTH] Failed to parse auth URL:', urlError.message);
                    const stateMatch = authUrl.match(/[?&]state=([^&]+)/);
                    stateParam = stateMatch ? decodeURIComponent(stateMatch[1]) : null;
                }
                
                // State is required for OAuth flow - bail out if missing
                if (!stateParam) {
                    console.error('[OAUTH] No state parameter found in auth URL');
                    return res.status(500).json({
                        error: 'OAuth flow initialization failed',
                        details: 'No state parameter in authorization URL'
                    });
                }
                
                // Store OAuth state temporarily for callback processing
                // Maps state -> { remoteName, remoteType, serverId, password, parameters }
                // Store decrypted password (short-lived, cleaned up after use)
                // This is acceptable for single-service architecture - password is in memory anyway
                // For multi-instance deployments, consider using Redis with encrypted storage
                oauthStateStore.set(stateParam, {
                    remoteName: name,
                    remoteType: type,
                    serverId: serverId || null,
                    password: password, // Decrypted password (short-lived, cleaned up after callback)
                    parameters: cleanParams, // Store original parameters (client_id, client_secret, etc.)
                    createdAt: Date.now()
                });
                
                // Clean up old OAuth states (older than 1 hour)
                const oneHourAgo = Date.now() - 3600000;
                for (const [state, info] of oauthStateStore.entries()) {
                    if (info.createdAt < oneHourAgo) {
                        oauthStateStore.delete(state);
                    }
                }
                
                console.log(`[OAUTH] Modified auth URL: ${authUrl.substring(0, 150)}...`);
                
                return res.json({ 
                    success: true,
                    auth_url: authUrl,
                    remote_name: name,
                    remote_type: type,
                    state: stateParam  // Return state for frontend reference
                });
            } else {
                // Check if config was created (might have tokens already)
                const configCheck = await axiosInstance.post(
                    `${server.url}/config/get`,
                    { name: name },
                    {
                        auth: { username: server.username, password: password },
                        timeout: 10000
                    }
                );
                
                if (configCheck.data && Object.keys(configCheck.data).length > 0) {
                    // Config exists - check if it has tokens
                    const hasToken = configCheck.data.token || 
                                   configCheck.data.access_token ||
                                   configCheck.data.refresh_token;
                    
                    if (hasToken) {
                        return res.json({
                            success: true,
                            already_authenticated: true,
                            message: 'Remote already has authentication tokens'
                        });
                    }
                }
                
                // No auth_url and no valid config
                const errorMsg = response.data?.error || 'OAuth flow not started. Check Rclone RCD logs.';
                console.error(`[OAUTH] Failed to get auth URL:`, errorMsg);
                return res.status(500).json({ 
                    error: 'Failed to start OAuth flow',
                    details: errorMsg
                });
            }
        } catch (rcloneError) {
            console.error('[OAUTH] Rclone error:', rcloneError.response?.data || rcloneError.message);
            
            // Check for timeout
            if (rcloneError.code === 'ECONNABORTED' || rcloneError.message.includes('timeout')) {
                console.error('[OAUTH] Rclone request timed out');
                
                return res.status(500).json({
                    error: 'OAuth request timed out',
                    details: 'Rclone is taking too long to respond. Please check Rclone RCD logs and try again.',
                    suggestion: 'Ensure Rclone RCD is running and accessible.'
                });
            }
            
            // Check if it's a port conflict error (shouldn't happen with noopauth, but handle gracefully)
            const errorMsg = rcloneError.response?.data?.error || rcloneError.message;
            if (errorMsg.includes('address already in use') || errorMsg.includes('bind')) {
                // Extract port number from error if available
                const portMatch = errorMsg.match(/port\s+(\d+)|:(\d+)/i);
                const port = portMatch ? (portMatch[1] || portMatch[2]) : 'unknown';
                
                console.error(`[OAUTH] Port conflict detected on port ${port} (unexpected with headless OAuth)`);
                
                return res.status(500).json({
                    error: 'OAuth server port conflict',
                    details: `Port ${port} is already in use. This is unexpected with headless OAuth flow.`,
                    suggestion: 'Please restart Rclone RCD and try again.',
                    port: port
                });
            }
            
            return res.status(rcloneError.response?.status || 500).json({
                error: 'Failed to start OAuth flow',
                details: errorMsg
            });
        }
        } // end if (false) - legacy noopauth block
    } catch (error) {
        console.error('[OAUTH] Authorization error:', error);
        res.status(500).json({
            error: 'OAuth authorization failed',
            details: error.message
        });
    }
});

/**
 * POST /director/oauth/environment - Detect if RCD server is local or remote
 * Protected: Requires admin authentication
 * 
 * Determines if the selected RCD server is running on the same machine as the browser
 * This is used to decide whether to use RcloneAuthApp (local) or browser redirect (remote)
 */
router.post('/environment', auth.requireAdminAuth, async (req, res) => {
    try {
        const { serverId } = req.body;
        const adminPassword = req.adminPassword;
        
        // Get target server
        const server = serverId ? await getServerById(serverId) : await getDefaultServer();
        if (!server) {
            return res.status(404).json({ error: 'No rclone server configured' });
        }
        
        // Parse server URL to check if it's local or remote
        let isLocalMachine = false;
        try {
            const url = new URL(server.url);
            const hostname = url.hostname;
            
            // Check if hostname indicates a local machine
            isLocalMachine = hostname === 'localhost' || 
                           hostname === '127.0.0.1' ||
                           hostname.startsWith('127.') ||
                           hostname === '[::1]' ||
                           hostname.endsWith('.local') ||
                           hostname === 'host.docker.internal';
            
            console.log(`[OAUTH ENV] Server ${server.name} (${server.url}) is ${isLocalMachine ? 'LOCAL' : 'REMOTE'}`);
        } catch (urlError) {
            console.error('[OAUTH ENV] Failed to parse server URL:', urlError);
            // Default to remote if URL parsing fails
            isLocalMachine = false;
        }
        
        return res.json({
            success: true,
            isLocalMachine: isLocalMachine,
            serverUrl: server.url,
            serverName: server.name
        });
    } catch (error) {
        console.error('[OAUTH ENV] Environment detection error:', error);
        res.status(500).json({
            error: 'Failed to detect OAuth environment',
            details: error.message
        });
    }
});

/**
 * POST /director/oauth/check - Check OAuth status for a remote
 * Protected: Requires admin authentication
 * 
 * Checks if a remote has OAuth tokens configured
 */
router.post('/check', auth.requireAdminAuth, async (req, res) => {
    try {
        const { name, type, serverId } = req.body;
        const adminPassword = req.adminPassword;
        
        if (!name) {
            return res.status(400).json({ error: 'Missing required field: name' });
        }
        
        // Get target server
        const server = serverId ? await getServerById(serverId) : await getDefaultServer();
        if (!server) {
            return res.status(404).json({ error: 'No rclone server configured' });
        }
        
        // Decrypt password
        let password = server.password;
        if (server.encryptedPassword) {
            try {
                password = auth.decryptPassword(server.encryptedPassword, adminPassword);
            } catch (error) {
                return res.status(401).json({ error: 'Failed to decrypt server credentials' });
            }
        }
        
        try {
            // Check if remote exists and has OAuth tokens
            const configResponse = await axiosInstance.post(
                `${server.url}/config/get`,
                { name: name },
                {
                    auth: { username: server.username, password: password },
                    timeout: 5000
                }
            );
            
            if (configResponse.data && Object.keys(configResponse.data).length > 0) {
                // Check if it has OAuth tokens
                const hasToken = configResponse.data.token || 
                               configResponse.data.access_token ||
                               configResponse.data.refresh_token;
                
                if (hasToken) {
                    return res.json({
                        success: true,
                        authenticated: true,
                        remote: name,
                        type: configResponse.data.type || type
                    });
                }
            }
            
            // Remote exists but not authenticated
            return res.json({
                success: true,
                authenticated: false,
                remote: name
            });
        } catch (rcloneError) {
            // Remote doesn't exist or other error
            if (rcloneError.response?.status === 404) {
                return res.json({
                    success: true,
                    authenticated: false,
                    remote: name,
                    message: 'Remote not found'
                });
            }
            
            throw rcloneError;
        }
    } catch (error) {
        console.error('[OAUTH] Check status error:', error);
        res.status(500).json({
            error: 'Failed to check OAuth status',
            details: error.message
        });
    }
});

/**
 * POST /director/oauth/account - Get account information for an authenticated OAuth remote
 * Protected: Requires admin authentication
 * 
 * Fetches user account information (email, name, etc.) from OAuth providers
 */
router.post('/account', auth.requireAdminAuth, async (req, res) => {
    try {
        const { name, serverId } = req.body;
        const adminPassword = req.adminPassword;
        
        if (!name) {
            return res.status(400).json({ error: 'Missing required field: name' });
        }
        
        // Get target server
        const server = serverId ? await getServerById(serverId) : await getDefaultServer();
        if (!server) {
            return res.status(404).json({ error: 'No rclone server configured' });
        }
        
        // Decrypt password
        let password = server.password;
        if (server.encryptedPassword) {
            try {
                password = auth.decryptPassword(server.encryptedPassword, adminPassword);
            } catch (error) {
                return res.status(401).json({ error: 'Failed to decrypt server credentials' });
            }
        }
        
        try {
            // Get remote configuration to determine type
            const configResponse = await axiosInstance.post(
                `${server.url}/config/get`,
                { name: name },
                {
                    auth: { username: server.username, password: password },
                    timeout: 15000 // Increased for remote servers
                }
            );
            
            if (!configResponse.data || Object.keys(configResponse.data).length === 0) {
                return res.status(404).json({ 
                    error: 'Remote not found',
                    message: `Remote "${name}" does not exist`
                });
            }
            
            const remoteType = configResponse.data.type;
            
            // Try to get account info using the remote's about endpoint
            // This works for most OAuth providers (Drive, OneDrive, Dropbox, etc.)
            try {
                const aboutResponse = await axiosInstance.post(
                    `${server.url}/operations/about`,
                    {
                        fs: `${name}:`
                    },
                    {
                        auth: { username: server.username, password: password },
                        timeout: 20000 // Increased for remote servers with network latency
                    }
                );
                
                // Extract relevant account information
                const aboutData = aboutResponse.data;
                const accountInfo = {
                    provider: remoteType,
                    total: aboutData.total,
                    used: aboutData.used,
                    free: aboutData.free,
                    // Some providers include additional info
                    features: aboutData.features
                };
                
                // Try to get user info - use direct API calls with OAuth tokens
                try {
                    // Get the token from config
                    let tokenData = null;
                    if (configResponse.data.token) {
                        try {
                            tokenData = typeof configResponse.data.token === 'string' 
                                ? JSON.parse(configResponse.data.token) 
                                : configResponse.data.token;
                            console.log(`[OAUTH] Token found for ${name}, expires: ${tokenData.expiry || 'unknown'}`);
                        } catch (parseErr) {
                            console.log(`[OAUTH] Could not parse token for ${name}`);
                        }
                    }
                    
                    if (remoteType === 'drive' && tokenData && tokenData.access_token) {
                        // Google Drive: Use Drive API /about endpoint (includes user info)
                        console.log(`[OAUTH] Fetching Google Drive user info via /about for ${name}`);
                        try {
                            const userResponse = await axios.get(
                                'https://www.googleapis.com/drive/v3/about?fields=user',
                                {
                                    headers: {
                                        'Authorization': `Bearer ${tokenData.access_token}`
                                    },
                                    timeout: 10000 // Increased for remote servers
                                }
                            );
                            
                            console.log(`[OAUTH] Google Drive /about response:`, JSON.stringify(userResponse.data));
                            
                            if (userResponse.data && userResponse.data.user) {
                                accountInfo.email = userResponse.data.user.emailAddress;
                                accountInfo.name = userResponse.data.user.displayName;
                            }
                        } catch (googleErr) {
                            console.log('[OAUTH] Google Drive API error:', googleErr.response?.data?.error || googleErr.message);
                        }
                    } else if (remoteType === 'onedrive' && tokenData && tokenData.access_token) {
                        // OneDrive: Use /me/drive endpoint (returns owner info)
                        console.log(`[OAUTH] Fetching OneDrive user info via /me/drive for ${name}`);
                        try {
                            const userResponse = await axios.get(
                                'https://graph.microsoft.com/v1.0/me/drive',
                                {
                                    headers: {
                                        'Authorization': `Bearer ${tokenData.access_token}`
                                    },
                                    timeout: 10000 // Increased for remote servers
                                }
                            );
                            
                            console.log(`[OAUTH] OneDrive /me/drive response owner:`, JSON.stringify(userResponse.data?.owner));
                            
                            if (userResponse.data && userResponse.data.owner && userResponse.data.owner.user) {
                                accountInfo.email = userResponse.data.owner.user.email;
                                accountInfo.name = userResponse.data.owner.user.displayName;
                            }
                        } catch (msErr) {
                            console.log('[OAUTH] OneDrive API error:', msErr.response?.data?.error || msErr.message);
                        }
                    } else if (remoteType === 'dropbox' && tokenData && tokenData.access_token) {
                        // Dropbox: Use Dropbox API to get account info
                        console.log(`[OAUTH] Fetching Dropbox account info via API for ${name}`);
                        try {
                            const userResponse = await axios.post(
                                'https://api.dropboxapi.com/2/users/get_current_account',
                                null,
                                {
                                    headers: {
                                        'Authorization': `Bearer ${tokenData.access_token}`
                                    },
                                    timeout: 10000 // Increased for remote servers
                                }
                            );
                            
                            console.log(`[OAUTH] Dropbox account response:`, JSON.stringify(userResponse.data));
                            
                            if (userResponse.data) {
                                accountInfo.email = userResponse.data.email;
                                accountInfo.name = userResponse.data.name?.display_name || userResponse.data.display_name;
                            }
                        } catch (dropboxErr) {
                            console.log('[OAUTH] Dropbox API error:', dropboxErr.response?.data?.error || dropboxErr.message);
                        }
                    } else if (remoteType === 'box' && tokenData && tokenData.access_token) {
                        // Box: Use Box API to get user info
                        console.log(`[OAUTH] Fetching Box user info via API for ${name}`);
                        try {
                            const userResponse = await axios.get(
                                'https://api.box.com/2.0/users/me',
                                {
                                    headers: {
                                        'Authorization': `Bearer ${tokenData.access_token}`
                                    },
                                    timeout: 10000 // Increased for remote servers
                                }
                            );
                            
                            if (userResponse.data) {
                                accountInfo.email = userResponse.data.login;
                                accountInfo.name = userResponse.data.name;
                            }
                        } catch (boxErr) {
                            console.log('[OAUTH] Box API error:', boxErr.response?.data?.error || boxErr.message);
                        }
                    } else {
                        console.log(`[OAUTH] No token-based user info available for ${name} (type: ${remoteType})`);
                    }
                } catch (userError) {
                    // User info not available, continue without it
                    console.log('[OAUTH] User info not available for this provider:', userError.message);
                }
                
                console.log(`[OAUTH] Final account info for ${name}:`, JSON.stringify(accountInfo));
                
                console.log(`[OAUTH] Account info retrieved for ${name}`);
                
                return res.json({
                    success: true,
                    account: accountInfo
                });
            } catch (aboutError) {
                // About command failed - provider might not support it
                console.log('[OAUTH] About command not supported for this provider');
                
                return res.json({
                    success: true,
                    account: {
                        provider: remoteType,
                        message: 'Account info not available for this provider'
                    }
                });
            }
        } catch (rcloneError) {
            console.error('[OAUTH] Account info error:', rcloneError.response?.data || rcloneError.message);
            
            if (rcloneError.response?.status === 404) {
                return res.status(404).json({
                    error: 'Remote not found',
                    message: `Remote "${name}" does not exist`
                });
            }
            
            throw rcloneError;
        }
    } catch (error) {
        console.error('[OAUTH] Get account info error:', error);
        res.status(500).json({
            error: 'Failed to get account information',
            details: error.message
        });
    }
});

/**
 * POST /director/oauth/revoke - Revoke OAuth authentication for a remote
 * Protected: Requires admin authentication
 * 
 * Removes OAuth tokens from a remote configuration
 */
router.post('/revoke', auth.requireAdminAuth, async (req, res) => {
    try {
        const { name, serverId } = req.body;
        const adminPassword = req.adminPassword;
        
        if (!name) {
            return res.status(400).json({ error: 'Missing required field: name' });
        }
        
        // Get target server
        const server = serverId ? await getServerById(serverId) : await getDefaultServer();
        if (!server) {
            return res.status(404).json({ error: 'No rclone server configured' });
        }
        
        // Decrypt password
        let password = server.password;
        if (server.encryptedPassword) {
            try {
                password = auth.decryptPassword(server.encryptedPassword, adminPassword);
            } catch (error) {
                return res.status(401).json({ error: 'Failed to decrypt server credentials' });
            }
        }
        
        try {
            // Get current remote configuration
            const configResponse = await axiosInstance.post(
                `${server.url}/config/get`,
                { name: name },
                {
                    auth: { username: server.username, password: password },
                    timeout: 5000
                }
            );
            
            if (!configResponse.data || Object.keys(configResponse.data).length === 0) {
                // Remote doesn't exist yet (unsaved wizard) - just return success
                return res.json({
                    success: true,
                    message: `No saved remote "${name}" to revoke`,
                    remote: name,
                    notFound: true
                });
            }
            
            const currentConfig = configResponse.data;
            const remoteType = currentConfig.type;
            
            // Check if remote has OAuth tokens
            const hasToken = currentConfig.token || 
                           currentConfig.access_token ||
                           currentConfig.refresh_token;
            
            if (!hasToken) {
                return res.json({
                    success: true,
                    message: `Remote "${name}" does not have OAuth tokens`,
                    remote: name,
                    alreadyRevoked: true
                });
            }
            
            // To revoke OAuth: simply delete the remote
            // Recreating without tokens triggers Rclone's OAuth flow which tries to bind port 53682
            // This causes "address already in use" errors if RcloneAuthApp is running
            // Better UX: Let user re-add the remote from scratch if they want it back
            
            await axiosInstance.post(
                `${server.url}/config/delete`,
                { name: name },
                {
                    auth: { username: server.username, password: password },
                    timeout: 5000
                }
            );
            
            console.log(`[OAUTH] Revoked authentication for remote: ${name} (deleted)`);
            
            return res.json({
                success: true,
                message: `Remote "${name}" deleted successfully`,
                remote: name,
                deleted: true
            });
        } catch (rcloneError) {
            console.error('[OAUTH] Revoke error:', rcloneError.response?.data || rcloneError.message);
            
            if (rcloneError.response?.status === 404) {
                // Remote doesn't exist (unsaved wizard) - return success instead of error
                return res.json({
                    success: true,
                    message: `No saved remote "${name}" to revoke`,
                    remote: name,
                    notFound: true
                });
            }
            
            throw rcloneError;
        }
    } catch (error) {
        console.error('[OAUTH] Revoke authentication error:', error);
        res.status(500).json({
            error: 'Failed to revoke authentication',
            details: error.message
        });
    }
});

/**
 * GET/POST /director/oauth/callback - OAuth callback endpoint
 * Protected by callback token (from RcloneAuthApp) or public (for direct browser redirects)
 * 
 * Receives OAuth callbacks from providers (Dropbox, Google Drive, etc.)
 * Uses Rclone's headless OAuth flow (noopauth/callback) to complete authentication
 * This avoids port conflicts and works perfectly for headless servers
 * 
 * Supports both GET and POST methods (some providers use POST)
 * 
 * Security: If callback_token is provided (from RcloneAuthApp), it must be valid and unused
 */
router.all('/callback', async (req, res) => {
    // Set CORS headers to allow RcloneAuthApp to call this endpoint
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Callback-Token');
    
    // Log callback receipt (always) - but NO sensitive data
    console.log(`[OAUTH CALLBACK] Received ${req.method} request to /director/oauth/callback`);
    
    // Debug-only verbose logging with sanitization (enable with DEBUG_OAUTH=true)
    debugLog(`[OAUTH CALLBACK DEBUG] Headers:`, JSON.stringify(sanitizeForLog(req.headers), null, 2));
    debugLog(`[OAUTH CALLBACK DEBUG] Body:`, JSON.stringify(sanitizeForLog(req.body), null, 2));
    debugLog(`[OAUTH CALLBACK DEBUG] Query:`, JSON.stringify(sanitizeForLog(req.query), null, 2));
    
    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
        debugLog('[OAUTH CALLBACK DEBUG] Responding to OPTIONS preflight');
        return res.status(200).end();
    }
    
    // Check for callback token (from RcloneAuthApp)
    const callbackToken = req.headers['x-callback-token'] || req.body?.callback_token || req.query?.callback_token;
    if (callbackToken) {
        // Validate token if provided
        if (!oauthHandlers.validateCallbackToken(callbackToken)) {
            console.error('[OAUTH] Invalid or expired callback token');
            return res.status(401).json({
                error: 'Invalid or expired callback token',
                message: 'The callback token is invalid, expired, or has already been used.'
            });
        }
        console.log('[OAUTH] Valid callback token provided by RcloneAuthApp');
    }
    
    try {
        // Extract state to determine which handler to use
        const { state } = req.method === 'POST' ? (req.body || {}) : req.query;
        
        if (!state) {
            return res.status(400).send('Missing state parameter in OAuth callback');
        }
        
        // Check if this is a new OAuth implementation (from oauth module)
        const oauthState = oauthHandlers.getOAuthState(state);
        if (oauthState) {
            // Use new OAuth callback handler
            console.log('[OAUTH] Using new OAuth callback handler');
            return await oauthHandlers.handleCallback(req, res, getServerById, getDefaultServer, axiosInstance);
        }
        
        // Fall back to old noopauth callback implementation
        console.log('[OAUTH] Using Rclone noopauth callback handler');
        
        // Look up OAuth state
        const stateInfo = oauthStateStore.get(state);
        if (!stateInfo) {
            console.error('[OAUTH] OAuth state not found or expired:', state);
            return res.status(400).send('OAuth state not found or expired. Please start the OAuth process again.');
        }
        
        // Extract callback data (code, state)
        const { code } = req.method === 'POST' ? (req.body || {}) : req.query;
        
        if (!code) {
            console.error('[OAUTH] No authorization code received in callback');
            oauthStateStore.delete(state); // Clean up
            return res.status(400).send('No authorization code received');
        }
        
        // Get stored OAuth parameters
        const { remoteName, remoteType, serverId, password, parameters } = stateInfo;
        
        // Clean up state immediately (one-time use)
        oauthStateStore.delete(state);
        
        // Get server
        const server = serverId ? await getServerById(serverId) : await getDefaultServer();
        if (!server) {
            console.error('[OAUTH] Server not found for OAuth callback');
            return res.status(500).send('Server configuration not found');
        }
        
        // Use stored password (already decrypted when stored in authorize step)
        // This is acceptable for single-service architecture - password is in memory anyway
        // State is cleaned up immediately after use and expires after 1 hour
        if (!password) {
            console.error('[OAUTH] Password not available in OAuth state');
            return res.status(500).send('Server password not available');
        }
        
        // Use Rclone's headless OAuth callback endpoint
        // NOTE: Correct endpoint is /rc/noopauth/callback (not /noopauth/callback)
        // This completes the OAuth flow without needing a local webserver
        try {
            const callbackResponse = await axiosInstance.post(
                `${server.url}/rc/noopauth/callback`,
                {
                    type: remoteType,
                    code: code,
                    state: state
                },
                {
                    auth: { username: server.username, password: password },
                    timeout: 15000
                }
            );
            
            // Extract tokens from response
            const tokens = callbackResponse.data.result || callbackResponse.data;
            console.log(`[OAUTH] OAuth tokens received for ${remoteName}`);
            
            // Create the remote config with the obtained tokens
            // Format token as JSON string if it's an object
            let tokenParam = tokens;
            if (typeof tokens === 'object') {
                tokenParam = JSON.stringify(tokens, null, 0); // Compact JSON (no whitespace)
            }
            
            // Build parameters object - include token and any additional OAuth parameters
            // Some remotes (Google Drive, OneDrive) require client_id and client_secret
            const configParameters = {
                token: tokenParam
            };
            
            // Add client_id and client_secret if provided in original parameters
            if (parameters.client_id) {
                configParameters.client_id = parameters.client_id;
            }
            if (parameters.client_secret) {
                configParameters.client_secret = parameters.client_secret;
            }
            
            console.log(`[OAUTH] Creating Rclone config for ${remoteType} remote "${remoteName}"`);
            
            // Create/update Rclone remote config
            const configResponse = await axiosInstance.post(
                `${server.url}/config/create`,
                {
                    name: remoteName,
                    type: remoteType,
                    parameters: configParameters
                },
                {
                    auth: { username: server.username, password: password },
                    timeout: 10000
                }
            );
            
            console.log(`[OAUTH] Remote "${remoteName}" created successfully`);
            
            // Return success page
            return res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>OAuth Success</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 40px; text-align: center; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
                        .container { background: rgba(255,255,255,0.1); padding: 30px; border-radius: 10px; max-width: 500px; margin: 0 auto; backdrop-filter: blur(10px); }
                        h1 { margin: 0 0 20px 0; font-size: 32px; }
                        p { font-size: 18px; line-height: 1.6; margin: 20px 0; }
                        .icon { font-size: 64px; margin-bottom: 20px; }
                        .remote-name { font-weight: bold; background: rgba(255,255,255,0.2); padding: 5px 15px; border-radius: 5px; display: inline-block; margin: 10px 0; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="icon">✅</div>
                        <h1>OAuth Successful!</h1>
                        <p>Remote <span class="remote-name">${remoteName}</span> has been configured successfully.</p>
                        <p>You can close this window and return to the application.</p>
                    </div>
                    <script>
                        // Auto-close after 3 seconds
                        setTimeout(() => { window.close(); }, 3000);
                    </script>
                </body>
                </html>
            `);
        } catch (rcloneError) {
            console.error('[OAUTH] Rclone callback error:', rcloneError.response?.data || rcloneError.message);
            
            const errorMsg = rcloneError.response?.data?.error || rcloneError.message;
            return res.status(500).send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>OAuth Error</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 40px; text-align: center; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; }
                        .container { background: rgba(255,255,255,0.1); padding: 30px; border-radius: 10px; max-width: 500px; margin: 0 auto; backdrop-filter: blur(10px); }
                        h1 { margin: 0 0 20px 0; font-size: 32px; }
                        p { font-size: 16px; line-height: 1.6; margin: 20px 0; }
                        .icon { font-size: 64px; margin-bottom: 20px; }
                        .error { background: rgba(255,255,255,0.2); padding: 15px; border-radius: 5px; margin: 20px 0; word-break: break-word; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="icon">❌</div>
                        <h1>OAuth Failed</h1>
                        <p>Failed to complete OAuth authentication for <strong>${remoteName}</strong>.</p>
                        <div class="error">${errorMsg}</div>
                        <p>Please close this window and try again.</p>
                    </div>
                </body>
                </html>
            `);
        }
    } catch (error) {
        console.error('[OAUTH] Callback error:', error);
        return res.status(500).send('OAuth callback failed');
    }
});

// Export router and state store (for cleanup/testing)
module.exports = router;
module.exports.oauthStateStore = oauthStateStore;

