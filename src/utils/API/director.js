import axios from 'axios';
import {SESSION_KEY} from '../Constants';

/**
 * Rclone Director API Client
 * Handles director-specific endpoints (server management, enhanced mounts, etc.)
 */
const directorAPI = axios.create({
    baseURL: '/api/director',
    headers: {'Content-Type': 'application/json'},
    responseType: 'json'
});

/**
 * Interceptor adds admin password to all Director API calls
 */
directorAPI.interceptors.request.use(
    config => {
        // Add session key header (REQUIRED for authentication)
        // This is a random token issued at login, stored on backend
        const sessionKey = sessionStorage.getItem(SESSION_KEY);
        if (sessionKey && sessionKey !== 'null' && sessionKey !== 'undefined') {
            config.headers['X-Session-Key'] = sessionKey;
        }
        return config;
    },
    error => Promise.reject(error)
);

/**
 * Response interceptor to handle 401, 503, and network errors globally
 */
directorAPI.interceptors.response.use(
    response => response, // Pass through successful responses
    error => {
        // IMPORTANT: Don't redirect if we're already on the login page to prevent infinite loops
        // HashRouter uses #/login format, so check hash exactly
        const currentHash = window.location.hash;
        const isLoginPage = currentHash === '#/login' || currentHash === '#/login/' || 
                           currentHash.startsWith('#/login?') || currentHash.startsWith('#/login/?');
        
        // Handle 503 Service Unavailable - RCD backend not reachable
        // IMPORTANT: Do NOT redirect to login, just pass through the error
        // Dashboard will handle it gracefully with a banner
        if (error.response && error.response.status === 503) {
            console.warn('[DIRECTOR] Backend unavailable (503) - dashboard will show error banner');
            return Promise.reject(error);
        }
        
        // Handle 401 Unauthorized - session expired or invalid
        if (error.response && error.response.status === 401) {
            // If we're already on the login page, just pass through the error
            // This prevents infinite redirect loops when Login component calls signOut()
            if (isLoginPage) {
                console.log('[AUTH] 401 on login page - ignoring (prevents redirect loop)');
                return Promise.reject(error);
            }
            
            console.error('[AUTH] Session expired or invalid (401). Redirecting to login...');
            
            // Preserve server selection across logout/login
            const lastServerId = localStorage.getItem('RCLONE_LAST_SERVER_ID');
            
            // Clear all session data
            sessionStorage.clear();
            localStorage.clear();
            
            // Restore server selection
            if (lastServerId) {
                localStorage.setItem('RCLONE_LAST_SERVER_ID', lastServerId);
            }
            
            // Store error message for login page
            sessionStorage.setItem('LOGIN_ERROR', 'Your session has expired or is invalid. Please log in again.');
            
            // Redirect to login page (use hash routing)
            window.location.hash = '#/login';
            
            // Return a rejected promise to prevent further processing
            return Promise.reject(error);
        }
        
        // Handle network errors (backend not reachable)
        if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
            // If we're already on the login page, just pass through the error
            if (isLoginPage) {
                console.log('[DIRECTOR] Network error on login page - ignoring (prevents redirect loop)');
                return Promise.reject(error);
            }
            
            console.error('[DIRECTOR] Backend not reachable. Redirecting to login...');
            
            // Preserve server selection across logout/login
            const lastServerId = localStorage.getItem('RCLONE_LAST_SERVER_ID');
            
            // Clear all session data
            sessionStorage.clear();
            localStorage.clear();
            
            // Restore server selection
            if (lastServerId) {
                localStorage.setItem('RCLONE_LAST_SERVER_ID', lastServerId);
            }
            
            // Store error message for login page
            sessionStorage.setItem('LOGIN_ERROR', 'The Rclone Director backend server is not running!');
            
            // Redirect to login page (use hash routing)
            window.location.hash = '#/login';
            
            // Return a rejected promise to prevent further processing
            return Promise.reject(error);
        }
        
        // For all other errors, pass them through
        return Promise.reject(error);
    }
);

// ============================================================================
// AUTHENTICATION
// ============================================================================

/**
 * Login with admin credentials
 */
export async function login(username, password) {
    const response = await directorAPI.post('/auth/login', { username, password });
    return response.data;
}

/**
 * Check authentication status
 */
export async function getAuthStatus() {
    const response = await directorAPI.get('/auth/status');
    return response.data;
}

/**
 * Change admin password
 */
export async function changePassword(oldPassword, newPassword) {
    const response = await directorAPI.post('/auth/change-password', { oldPassword, newPassword });
    return response.data;
}

// ============================================================================
// SERVER MANAGEMENT
// ============================================================================

/**
 * Get all rclone servers
 */
export async function getServers() {
    const response = await directorAPI.get('/servers');
    return response.data;
}

/**
 * Create a new rclone server
 */
export async function createServer(serverData) {
    const response = await directorAPI.post('/servers', serverData);
    return response.data;
}

/**
 * Update an existing rclone server
 */
export async function updateServer(serverId, serverData) {
    const response = await directorAPI.put(`/servers/${serverId}`, serverData);
    return response.data;
}

/**
 * Delete a rclone server
 */
export async function deleteServer(serverId) {
    const response = await directorAPI.delete(`/servers/${serverId}`);
    return response.data;
}

/**
 * Set default server
 */
export async function setDefaultServer(serverId) {
    const response = await directorAPI.post(`/servers/${serverId}/set-default`);
    return response.data;
}

/**
 * Test connection to a server
 */
export async function testServer(serverId) {
    const response = await directorAPI.post(`/servers/${serverId}/test`);
    return response.data;
}

/**
 * Restart RCD service on a specific server
 * Calls core/quit which triggers systemd auto-restart
 */
export async function restartServer(serverId) {
    const response = await directorAPI.post(`/servers/${serverId}/restart`);
    return response.data;
}

// ============================================================================
// ENHANCED MOUNT OPERATIONS
// ============================================================================

/**
 * Create a mount with optional persistence
 */
export async function createMount(mountData) {
    const response = await directorAPI.post('/mount/create', mountData);
    return response.data;
}

/**
 * Unmount and remove from persistence
 */
export async function unmount(mountData) {
    const response = await directorAPI.post('/mount/unmount', mountData);
    return response.data;
}

/**
 * Get all persistent mounts
 */
export async function getPersistentMounts() {
    const response = await directorAPI.get('/mounts/persistent');
    return response.data;
}

// ============================================================================
// TEMPLATE MANAGEMENT
// ============================================================================

/**
 * Get all templates
 */
export async function getTemplates() {
    const response = await directorAPI.get('/templates');
    return response.data;
}

/**
 * Get a single template by ID (with decrypted parameters)
 */
export async function getTemplate(templateId) {
    const response = await directorAPI.get(`/templates/${templateId}`);
    return response.data;
}

/**
 * Create a new template
 */
export async function createTemplate(templateData) {
    const response = await directorAPI.post('/templates', templateData);
    return response.data;
}

/**
 * Delete a template
 */
export async function deleteTemplate(templateId) {
    const response = await directorAPI.delete(`/templates/${templateId}`);
    return response.data;
}

// ============================================================================
// BACKUP & RESTORE
// ============================================================================

/**
 * Export all settings (decrypted)
 */
export async function exportSettings(password) {
    const response = await directorAPI.post('/backup/export', { password });
    return response.data;
}

/**
 * Import settings from backup
 */
export async function importSettings(data, password, mode = 'merge') {
    const response = await directorAPI.post('/backup/import', { data, password, mode });
    return response.data;
}

// ============================================================================
// OAUTH AUTHENTICATION
// ============================================================================

/**
 * Start OAuth flow for a remote
 * Returns auth_url to open in popup and callback_token for RcloneAuthApp
 */
export async function startOAuthFlow(name, type, parameters, serverId = null) {
    const response = await directorAPI.post('/oauth/authorize', {
        name,
        type,
        parameters,
        serverId
    });
    return response.data;
}

/**
 * Send callback token and server info to RcloneAuthApp
 * @param {string} callbackToken - Token from OAuth authorize endpoint
 * @param {string} serverUrl - Director server URL (auto-detected from browser)
 * @returns {Promise<Object>} Response from local app
 */
export async function sendTokenToLocalApp(callbackToken, serverUrl) {
    try {
        const response = await fetch('http://localhost:53682/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                token: callbackToken,
                server_url: serverUrl
            })
        });
        
        if (!response.ok) {
            throw new Error(`Local app responded with status ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        // App not running or connection failed
        throw error;
    }
}

/**
 * Test connection to RcloneAuthApp
 * @returns {Promise<Object>} Response from local app
 */
export async function testLocalAppConnection() {
    try {
        const response = await fetch('http://localhost:53682/api/test', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Local app responded with status ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        throw error;
    }
}

/**
 * Check if OAuth authentication completed
 * Polls to see if remote config was created with tokens
 */
export async function checkOAuthStatus(name, serverId = null) {
    const response = await directorAPI.post('/oauth/check', {
        name,
        serverId
    });
    return response.data;
}

/**
 * Get OAuth account information (email, name, etc.)
 */
export async function getOAuthAccountInfo(name, serverId = null) {
    const response = await directorAPI.post('/oauth/account', {
        name,
        serverId
    }, {
        timeout: 25000 // 25 seconds for remote servers with network latency
    });
    return response.data;
}

/**
 * Revoke OAuth authentication (delete config)
 */
export async function revokeOAuth(name, serverId = null) {
    const response = await directorAPI.post('/oauth/revoke', {
        name,
        serverId
    });
    return response.data;
}

/**
 * Detect if client is accessing from same machine as server
 */
export async function detectOAuthEnvironment(serverId = null) {
    // NOTE: This is now handled client-side in NewDrive.js by checking window.location.hostname
    // Backend endpoint kept for backwards compatibility but not actively used
    const response = await directorAPI.post('/oauth/environment', { serverId });
    return response.data;
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

/**
 * Check director health
 */
export async function checkHealth() {
    const response = await directorAPI.get('/health');
    return response.data;
}

export default directorAPI;

