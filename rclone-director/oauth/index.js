/**
 * OAuth Module - Handler Functions
 * 
 * Handles OAuth flows for all Rclone backends
 * Replaces the previous Rclone noopauth-based implementation
 * 
 * This module exports handler functions that server.js can use
 * rather than being a separate router, so it can access server functions
 */

const utils = require('./utils');
const DropboxProvider = require('./providers/dropbox');
const DriveProvider = require('./providers/drive');
const OneDriveProvider = require('./providers/onedrive');
const BoxProvider = require('./providers/box');
const PCloudProvider = require('./providers/pcloud');
const YandexProvider = require('./providers/yandex');
const JottacloudProvider = require('./providers/jottacloud');
const HiDriveProvider = require('./providers/hidrive');
const MailruProvider = require('./providers/mailru');
const GPhotosProvider = require('./providers/gphotos');
const GCSProvider = require('./providers/gcs');
const PikpakProvider = require('./providers/pikpak');
const PremiumizemeProvider = require('./providers/premiumizeme');
const PutioProvider = require('./providers/putio');
const SharefileProvider = require('./providers/sharefile');
const ZohoProvider = require('./providers/zoho');
const http = require('http');
const express = require('express');

// Debug mode - only log verbose OAuth info when explicitly enabled
const DEBUG_OAUTH = process.env.DEBUG_OAUTH === 'true';

/**
 * Sanitize URL for logging - removes OAuth codes and tokens
 * @param {string} url - URL to sanitize
 * @returns {string} - Sanitized URL safe for logging
 */
function sanitizeUrlForLog(url) {
    if (!url) return url;
    // Mask OAuth codes, tokens, state values
    return url
        .replace(/([?&](?:code|token|access_token|refresh_token|id_token)=)[^&\s]+/gi, '$1***')
        .replace(/([?&]state=)[^&\s]+/gi, '$1[state]'); // Keep state indicator but mask value
}

// Provider registry - maps provider name to provider class
const providers = {
    dropbox: DropboxProvider,
    drive: DriveProvider,
    onedrive: OneDriveProvider,
    box: BoxProvider,
    pcloud: PCloudProvider,
    yandex: YandexProvider,
    jottacloud: JottacloudProvider,
    hidrive: HiDriveProvider,
    mailru: MailruProvider,
    gphotos: GPhotosProvider,
    gcs: GCSProvider,
    pikpak: PikpakProvider,
    premiumizeme: PremiumizemeProvider,
    putio: PutioProvider,
    sharefile: SharefileProvider,
    zoho: ZohoProvider
};

// In-memory store for OAuth state
// Maps state -> { remoteName, remoteType, serverId, password, parameters, createdAt }
const oauthStateStore = new Map();

// In-memory store for callback tokens (for RcloneAuthApp)
// Maps token -> { createdAt, expiresAt, used }
// Tokens are single-use and expire after 2 minutes
const callbackTokenStore = new Map();
const CALLBACK_TOKEN_EXPIRY = 2 * 60 * 1000; // 2 minutes

// Temporary OAuth callback server on port 53682 (Rclone's registered redirect_uri)
// This is used for local access scenarios (browser on same machine as server)
// For remote access, RcloneAuthApp handles port 53682 on the user's local machine
// This server is started when OAuth begins (for Dropbox with default client ID) and stopped after callback completes
let oauthCallbackServer = null;
let oauthCallbackServerTimeout = null; // Timeout to auto-stop server if OAuth never completes
const OAUTH_CALLBACK_PORT = 53682;
const OAUTH_CALLBACK_TIMEOUT = 10 * 60 * 1000; // 10 minutes - OAuth flows should complete quickly

/**
 * Clean up old OAuth state entries (older than 1 hour)
 */
function cleanupOldState() {
    const oneHourAgo = Date.now() - 3600000;
    for (const [state, info] of oauthStateStore.entries()) {
        if (info.createdAt < oneHourAgo) {
            oauthStateStore.delete(state);
        }
    }
}

/**
 * Clean up expired callback tokens
 */
function cleanupExpiredTokens() {
    const now = Date.now();
    for (const [token, info] of callbackTokenStore.entries()) {
        if (info.expiresAt < now || info.used) {
            callbackTokenStore.delete(token);
        }
    }
}

/**
 * Generate a new callback token for RcloneAuthApp
 * @returns {string} Token string
 */
function generateCallbackToken() {
    const crypto = require('crypto');
    const token = 'cb_' + crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    callbackTokenStore.set(token, {
        createdAt: now,
        expiresAt: now + CALLBACK_TOKEN_EXPIRY,
        used: false
    });
    // Clean up expired tokens periodically
    cleanupExpiredTokens();
    return token;
}

/**
 * Validate and consume a callback token
 * @param {string} token - Token to validate
 * @returns {boolean} True if token is valid and unused
 */
function validateCallbackToken(token) {
    if (!token) return false;
    
    cleanupExpiredTokens();
    const tokenInfo = callbackTokenStore.get(token);
    
    if (!tokenInfo) {
        return false; // Token doesn't exist
    }
    
    if (tokenInfo.used) {
        return false; // Token already used
    }
    
    if (tokenInfo.expiresAt < Date.now()) {
        callbackTokenStore.delete(token);
        return false; // Token expired
    }
    
    // Mark token as used (single-use)
    tokenInfo.used = true;
    return true;
}

/**
 * Handle OAuth authorization request
 * 
 * Generates authorization URL and stores state for callback
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} getServerById - Function to get server by ID
 * @param {Function} getDefaultServer - Function to get default server
 * @param {Object} axiosInstance - Axios instance for Rclone API calls
 */
async function handleAuthorize(req, res, getServerById, getDefaultServer, axiosInstance) {
    // Initialize status messages array at the start so it's always available
    const statusMessages = [];
    
    try {
        const { name, type, parameters, serverId } = req.body;
        
        if (!name || !type) {
            return res.status(400).json({ error: 'Missing required fields: name, type' });
        }
        
        // Get server configuration first (needed for checking existing config)
        const server = serverId ? await getServerById(serverId) : await getDefaultServer();
        if (!server) {
            return res.status(404).json({ error: 'No rclone server configured' });
        }
        
        // Decrypt password
        let password = server.password;
        if (server.encryptedPassword) {
            const auth = require('../auth');
            try {
                password = auth.decryptPassword(server.encryptedPassword, req.adminPassword);
            } catch (error) {
                return res.status(401).json({ error: 'Failed to decrypt server credentials' });
            }
        }
        
        // Check if remote is already authenticated before starting OAuth
        try {
            const existingConfig = await axiosInstance.post(
                `${server.url}/config/get`,
                { name: name },
                {
                    auth: { username: server.username, password: password },
                    timeout: 5000
                }
            );
            
            if (existingConfig.data && Object.keys(existingConfig.data).length > 0) {
                const config = existingConfig.data;
                // Check if config has OAuth tokens (in root or parameters)
                const hasToken = config.token ||
                               config.access_token ||
                               config.refresh_token ||
                               (config.parameters && (
                                   config.parameters.token ||
                                   config.parameters.access_token ||
                                   config.parameters.refresh_token
                               ));
                
                if (hasToken) {
                    console.log(`[OAUTH] Remote "${name}" already authenticated, skipping OAuth flow`);
                    return res.json({
                        success: true,
                        already_authenticated: true,
                        message: 'Remote already has authentication tokens',
                        remote_name: name,
                        remote_type: type
                    });
                }
            }
        } catch (checkError) {
            // Config doesn't exist or error checking - that's fine, proceed with OAuth
            console.log(`[OAUTH] Config check: ${checkError.response?.status === 404 ? 'not found' : 'error'} - proceeding with OAuth`);
        }
        
        // Get provider implementation
        const ProviderClass = providers[type];
        if (!ProviderClass) {
            return res.status(400).json({ 
                error: `OAuth not implemented for provider: ${type}`,
                supported: Object.keys(providers)
            });
        }
        
        const provider = new ProviderClass();
        
        // Generate state
        const state = utils.generateState();
        console.log(`[OAUTH] Generated state for ${type}: ${state.substring(0, 20)}... (length: ${state.length})`);
        
        // Build redirect URI (public callback endpoint)
        const host = req.get('host');
        if (!host) {
            return res.status(400).json({ error: 'Missing Host header' });
        }
        const redirectUri = `${req.protocol}://${host}/director/oauth/callback`;
        
        // Get client credentials (allow override from parameters)
        // Normalize empty strings to null
        const clientId = parameters?.client_id && parameters.client_id.trim() !== '' 
            ? parameters.client_id.trim() 
            : null;
        const clientSecret = parameters?.client_secret && parameters.client_secret.trim() !== '' 
            ? parameters.client_secret.trim() 
            : null;
        
        // For providers using Rclone's default client ID (like Dropbox),
        // we need to use Rclone's registered redirect_uri (localhost:53682)
        // We start a temporary listener on that port to catch callbacks (like Rclone does)
        let effectiveRedirectUri = redirectUri;
        
        // Check if we're using Rclone's default client ID
        // Different providers use different redirect URIs:
        // - Box, Drive: use 127.0.0.1 (oauthutil.RedirectURL)
        // - Dropbox, OneDrive, pCloud: use localhost (oauthutil.RedirectLocalhostURL)
        const rcloneDefaultClientIds = {
            'dropbox': '5jcck7diasz0rqy',
            'drive': '202264815644.apps.googleusercontent.com',
            'onedrive': 'b15665d9-eda6-4092-8539-0eec376afd59',
            'box': 'd0374ba6pgmaguie02ge15sv1mllndho',
            'pcloud': 'DnONSzyJXpm',
            'yandex': 'ac39b43b9eba4cae8ffb788c06d816a8',
            'hidrive': '6b0258fdda630d34db68a3ce3cbf19ae',
            'gphotos': '202264815644-rt1o1c9evjaotbpbab10m83i8cnjk077.apps.googleusercontent.com',
            'gcs': '202264815644.apps.googleusercontent.com',
            'pikpak': 'YUMx5nI8ZU8Ap8pm',
            'premiumizeme': '658922194',
            'putio': '4131',
            'sharefile': 'djQUPlHTUM9EvayYBWuKC5IrVIoQde46',
            'zoho': '1000.46MXF275FM2XV7QCHX5A7K3LGME66B'
            // Note: Mail.ru uses Password Credentials Grant (username/password), not authorization code flow
            // It doesn't use redirect URIs, so it's not included here
        };
        
        // Providers that use 127.0.0.1 (oauthutil.RedirectURL)
        const providersUsing127001 = ['box', 'drive', 'yandex', 'gphotos', 'gcs', 'pikpak', 'premiumizeme'];
        
        // Providers that use localhost (oauthutil.RedirectLocalhostURL)
        const providersUsingLocalhost = ['dropbox', 'onedrive', 'pcloud', 'jottacloud', 'hidrive', 'putio', 'zoho'];
        
        // Note: HiDrive uses TitleBarRedirectURL (urn:ietf:wg:oauth:2.0:oob) in Rclone,
        // but for web-based flow we use localhost redirect URL instead
        // Note: ShareFile uses RedirectPublicSecureURL (https://oauth.rclone.org/) in Rclone,
        // but for web-based flow we'll use standard redirect URI (defaults to 127.0.0.1)
        
        const isRcloneDefaultClientId = !clientId || clientId === rcloneDefaultClientIds[type];
        
        if (isRcloneDefaultClientId && rcloneDefaultClientIds[type]) {
            // Determine correct redirect URI based on provider
            // Box and Drive use 127.0.0.1, others use localhost
            if (providersUsing127001.includes(type)) {
                effectiveRedirectUri = `http://127.0.0.1:${OAUTH_CALLBACK_PORT}/`;
            } else if (providersUsingLocalhost.includes(type)) {
                effectiveRedirectUri = `http://localhost:${OAUTH_CALLBACK_PORT}/`;
            } else {
                // Default to 127.0.0.1 for unknown providers
                effectiveRedirectUri = `http://127.0.0.1:${OAUTH_CALLBACK_PORT}/`;
            }
            console.log(`[OAUTH] Using Rclone's registered redirect_uri for ${type}: ${effectiveRedirectUri}`);
            
            // Start temporary callback server on port 53682 to catch OAuth callbacks
            // This is needed because Rclone's default client IDs are registered with localhost:53682
            console.log(`[OAUTH] 🔍 Checking port ${OAUTH_CALLBACK_PORT} status before starting OAuth callback server...`);
            
            try {
                // First, detect what's using the port
                statusMessages.push({ step: 'checking-port', message: `Checking port ${OAUTH_CALLBACK_PORT}...` });
                const portStatus = await detectPort53682Status();
                
                if (portStatus.inUse && portStatus.type === 'our-server') {
                    // Our server is already running - reuse it
                    console.log(`[OAUTH] ✅ Our callback server is already running, reusing it`);
                    statusMessages.push({ step: 'port-ready', message: `Port ${OAUTH_CALLBACK_PORT} is ready (reusing existing server)` });
                    // Continue without starting a new server
                } else if (portStatus.inUse && portStatus.type === 'rclone-server') {
                    // Rclone's server is using the port - wait for it to become available
                    console.log(`[OAUTH] ⏳ Detected Rclone's OAuth webserver on port ${OAUTH_CALLBACK_PORT}`);
                    statusMessages.push({ step: 'detected-rclone', message: `Detected Rclone's OAuth webserver on port ${OAUTH_CALLBACK_PORT}` });
                    console.log(`[OAUTH] ⏳ Waiting for Rclone to release the port...`);
                    statusMessages.push({ step: 'waiting-for-port', message: `Waiting for Rclone to release port ${OAUTH_CALLBACK_PORT}...` });
                    
                    const waitResult = await waitForPort53682(30); // Max 30 seconds
                    
                    if (!waitResult.available) {
                        throw new Error(`Port ${OAUTH_CALLBACK_PORT} is still in use by Rclone RCD after waiting ${waitResult.waited} seconds. Please wait a bit longer and try again, or restart Rclone RCD if the issue persists.`);
                    }
                    
                    // Port is now available - start our server
                    console.log(`[OAUTH] ✅ Port ${OAUTH_CALLBACK_PORT} is now available, starting our callback server...`);
                    statusMessages.push({ step: 'starting-server', message: `Port ${OAUTH_CALLBACK_PORT} is now available, starting callback server...` });
                    await startOAuthCallbackServer(getServerById, getDefaultServer, axiosInstance);
                    console.log(`[OAUTH] ✅ OAuth callback server ready on port ${OAUTH_CALLBACK_PORT}`);
                    statusMessages.push({ step: 'server-ready', message: `OAuth callback server ready on port ${OAUTH_CALLBACK_PORT}` });
                } else if (portStatus.inUse) {
                    // Port is in use by unknown application
                    console.warn(`[OAUTH] ⚠️  Port ${OAUTH_CALLBACK_PORT} is in use by: ${portStatus.details}`);
                    statusMessages.push({ step: 'port-conflict', message: `Port ${OAUTH_CALLBACK_PORT} is in use by: ${portStatus.details}` });
                    throw new Error(`Port ${OAUTH_CALLBACK_PORT} is in use by another application: ${portStatus.details}. Please stop the application using this port and try again.`);
                } else {
                    // Port is free - start our server
                    console.log(`[OAUTH] ✅ Port ${OAUTH_CALLBACK_PORT} is free, starting our callback server...`);
                    statusMessages.push({ step: 'port-free', message: `Port ${OAUTH_CALLBACK_PORT} is free, starting callback server...` });
                    await startOAuthCallbackServer(getServerById, getDefaultServer, axiosInstance);
                    console.log(`[OAUTH] ✅ OAuth callback server ready on port ${OAUTH_CALLBACK_PORT}`);
                    statusMessages.push({ step: 'server-ready', message: `OAuth callback server ready on port ${OAUTH_CALLBACK_PORT}` });
                }
            } catch (error) {
                // If detection fails, fall back to old behavior
                if (error.message.includes('Port') && error.message.includes('in use')) {
                    // Include status messages in error response
                    return res.status(500).json({
                        error: 'OAuth authorization failed',
                        details: error.message,
                        status_messages: statusMessages
                    });
                }
                
                console.warn(`[OAUTH] ⚠️  Port detection failed, falling back to direct start: ${error.message}`);
                statusMessages.push({ step: 'fallback', message: `Port detection failed, trying direct start...` });
                try {
                    await startOAuthCallbackServer(getServerById, getDefaultServer, axiosInstance);
                    console.log(`[OAUTH] ✅ OAuth callback server started (fallback method)`);
                    statusMessages.push({ step: 'server-ready', message: `OAuth callback server started` });
                } catch (startError) {
                    if (startError.message.includes('already in use') || startError.message.includes('EADDRINUSE')) {
                        return res.status(500).json({
                            error: 'OAuth authorization failed',
                            details: `Port ${OAUTH_CALLBACK_PORT} is in use. Please wait a few seconds and try again, or restart Rclone RCD if the issue persists.`,
                            status_messages: statusMessages
                        });
                    }
                    throw startError;
                }
            }
        } else {
            console.log(`[OAUTH] Using Director callback endpoint: ${effectiveRedirectUri}`);
        }
        
        // Generate authorization URL
        const authURL = provider.getAuthURL(effectiveRedirectUri, state, {
            clientId: clientId,
            clientSecret: clientSecret
        });
        console.log(`[OAUTH] Generated auth URL for ${type}, state in URL: ${authURL.includes(state) ? 'present' : 'missing'}`);
        console.log(`[OAUTH] Auth URL preview: ${authURL.substring(0, 200)}...`);
        
        // Note: Server and password were already retrieved above for the config check
        
        // Store state for callback
        // Note: We store the decrypted password here for use in callback
        // This is safe because state is random and expires after 1 hour
        // Also store the effective redirect_uri so callback can use the same one
        oauthStateStore.set(state, {
            remoteName: name,
            remoteType: type,
            serverId: serverId || null,
            password: password, // Store decrypted password for callback
            parameters: parameters || {},
            redirectUri: effectiveRedirectUri, // Store the redirect_uri actually used
            createdAt: Date.now()
        });
        
        // Cleanup old state
        cleanupOldState();
        
        console.log(`[OAUTH] Started OAuth flow for ${type} remote "${name}"`);
        
        // Generate callback token for RcloneAuthApp
        const callbackToken = generateCallbackToken();
        
        return res.json({
            success: true,
            auth_url: authURL,
            remote_name: name,
            remote_type: type,
            state: state,
            callback_token: callbackToken, // Token for RcloneAuthApp to authenticate callback
            status: 'ready', // Status: 'ready', 'checking-port', 'waiting-for-port', 'starting-server'
            status_messages: statusMessages || [] // Array of status messages for frontend display
        });
        
    } catch (error) {
        console.error('[OAUTH] Authorization error:', error);
        return res.status(500).json({
            error: 'OAuth authorization failed',
            details: error.message,
            status_messages: statusMessages || []
        });
    }
}

/**
 * Handle OAuth callback
 * 
 * Receives OAuth callbacks from providers
 * Exchanges code for token and creates Rclone remote config
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} getServerById - Function to get server by ID
 * @param {Function} getDefaultServer - Function to get default server
 * @param {Object} axiosInstance - Axios instance for Rclone API calls
 */
async function handleCallback(req, res, getServerById, getDefaultServer, axiosInstance) {
    // Declare state outside try block so it's accessible in catch block
    let state = null;
    
    try {
        // Parse callback parameters
        const parsed = utils.parseCallbackParams(req);
        const { code, error: oauthError, error_description } = parsed;
        state = parsed.state; // Extract state separately so it's accessible in catch block
        
        console.log(`[OAUTH] Callback received - state length: ${state ? state.length : 0}, state preview: ${state ? state.substring(0, 20) + '...' : 'null'}`);
        console.log(`[OAUTH] Callback received - code: ${code ? 'present' : 'missing'}, error: ${oauthError || 'none'}`);
        
        // Check for OAuth errors from provider
        if (oauthError) {
            console.error(`[OAUTH] Provider returned error: ${oauthError} - ${error_description}`);
            // Escape HTML to prevent XSS
            const escapeHtml = (str) => {
                if (!str) return '';
                return String(str)
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#039;');
            };
            const safeError = escapeHtml(oauthError);
            const safeDescription = escapeHtml(error_description);
            return res.status(400).send(`
                <!DOCTYPE html>
                <html>
                <head><title>OAuth Error</title></head>
                <body>
                    <h1>OAuth Error</h1>
                    <p>Error: ${safeError}</p>
                    ${safeDescription ? `<p>Description: ${safeDescription}</p>` : ''}
                    <script>
                        if (window.opener) {
                            window.opener.postMessage('oauth-error', '*');
                        }
                    </script>
                </body>
                </html>
            `);
        }
        
        if (!code || !state) {
            return res.status(400).send(`
                <!DOCTYPE html>
                <html>
                <head><title>OAuth Error</title></head>
                <body>
                    <h1>OAuth Error</h1>
                    <p>Missing required OAuth parameters: code or state</p>
                    <script>
                        if (window.opener) {
                            window.opener.postMessage('oauth-error', '*');
                        }
                    </script>
                </body>
                </html>
            `);
        }
        
        // Retrieve stored OAuth state
        const oauthInfo = oauthStateStore.get(state);
        if (!oauthInfo) {
            console.error(`[OAUTH] Invalid or expired state: ${state}`);
            return res.status(400).send(`
                <!DOCTYPE html>
                <html>
                <head><title>OAuth Error</title></head>
                <body>
                    <h1>OAuth Error</h1>
                    <p>Invalid or expired OAuth state. Please try again.</p>
                    <script>
                        if (window.opener) {
                            window.opener.postMessage('oauth-error', '*');
                        }
                    </script>
                </body>
                </html>
            `);
        }
        
        const { remoteName, remoteType, serverId, password, parameters, redirectUri: storedRedirectUri } = oauthInfo;
        
        // Get provider implementation
        const ProviderClass = providers[remoteType];
        if (!ProviderClass) {
            throw new Error(`Provider not found: ${remoteType}`);
        }
        
        const provider = new ProviderClass();
        
        // Use the redirect_uri that was actually used in the authorize step
        // This is critical because some providers (like Dropbox) override the redirect_uri
        // and require the exact same redirect_uri in the token exchange
        let redirectUri = storedRedirectUri;
        if (!redirectUri) {
            // Fallback: build redirect URI from request (for backwards compatibility)
            const host = req.get('host');
            if (!host) {
                oauthStateStore.delete(state); // Clean up state before error
                return res.status(400).send(`
                    <!DOCTYPE html>
                    <html>
                    <head><title>OAuth Error</title></head>
                    <body>
                        <h1>OAuth Error</h1>
                        <p>Missing Host header</p>
                        <script>
                            if (window.opener) {
                                window.opener.postMessage('oauth-error', '*');
                            }
                        </script>
                    </body>
                    </html>
                `);
            }
            redirectUri = `${req.protocol}://${host}/director/oauth/callback`;
        }
        
        console.log(`[OAUTH] Using redirect_uri: ${redirectUri}`);
        
        // Get client credentials (normalize empty strings)
        const clientId = parameters?.client_id && parameters.client_id.trim() !== '' 
            ? parameters.client_id.trim() 
            : null;
        const clientSecret = parameters?.client_secret && parameters.client_secret.trim() !== '' 
            ? parameters.client_secret.trim() 
            : null;
        
        // Exchange code for token
        console.log(`[OAUTH] Exchanging code for token for ${remoteType} remote "${remoteName}"`);
        let tokenResponse;
        try {
            tokenResponse = await provider.exchangeToken(code, redirectUri, {
                clientId: clientId,
                clientSecret: clientSecret
            });
            console.log(`[OAUTH] Token exchange successful`);
        } catch (tokenError) {
            console.error(`[OAUTH] Token exchange failed:`, tokenError);
            const errorDetails = tokenError.response?.data || tokenError.message;
            const errorStr = typeof errorDetails === 'string' ? errorDetails : JSON.stringify(errorDetails);
            
            // Check if it's a redirect_uri mismatch error
            if (errorStr.includes('redirect_uri') || errorStr.includes('redirect uri') || errorStr.includes('invalid redirect')) {
                throw new Error(`Invalid redirect_uri. The redirect_uri "${redirectUri}" must be registered in your Dropbox app settings. ` +
                    `Options: 1) Create your own Dropbox app at https://www.dropbox.com/developers/apps and register this redirect_uri, ` +
                    `or 2) Add this redirect_uri to Rclone's Dropbox app (if Dropbox allows multiple redirect URIs). ` +
                    `Original error: ${errorStr}`);
            }
            
            throw new Error(`Token exchange failed: ${errorStr}`);
        }
        
        // Format token for Rclone
        let tokenString;
        try {
            tokenString = provider.formatTokenForRclone(tokenResponse);
            console.log(`[OAUTH] Token formatted successfully (length: ${tokenString.length})`);
        } catch (formatError) {
            console.error(`[OAUTH] Token formatting failed:`, formatError);
            throw new Error(`Token formatting failed: ${formatError.message}`);
        }
        
        // For OneDrive, we need to fetch drive_id and drive_type
        // These are required by Rclone but not provided by OAuth flow
        let additionalParameters = {};
        if (remoteType === 'onedrive') {
            console.log(`[OAUTH] OneDrive detected - fetching drive info...`);
            try {
                const accessToken = tokenResponse.access_token;
                const refreshToken = tokenResponse.refresh_token;
                const region = parameters?.region || 'global';
                
                const driveInfo = await provider.getDriveInfo(accessToken, refreshToken, {
                    clientId: clientId,
                    clientSecret: clientSecret,
                    region: region
                });
                
                additionalParameters.drive_id = driveInfo.drive_id;
                additionalParameters.drive_type = driveInfo.drive_type;
                
                console.log(`[OAUTH] OneDrive drive info obtained:`, {
                    drive_id: driveInfo.drive_id,
                    drive_type: driveInfo.drive_type
                });
                
                // If token was refreshed, update tokenString
                if (driveInfo.newToken) {
                    console.log(`[OAUTH] Token was refreshed during drive info fetch, updating...`);
                    tokenString = provider.formatTokenForRclone(driveInfo.newToken);
                }
            } catch (driveError) {
                console.error(`[OAUTH] Failed to get OneDrive drive info:`, driveError);
                throw new Error(`Failed to get OneDrive drive information: ${driveError.message}. This is required for OneDrive configuration.`);
            }
        }
        
        // Get server configuration
        const server = serverId ? await getServerById(serverId) : await getDefaultServer();
        if (!server) {
            throw new Error('Rclone server not found');
        }
        
        // Use stored password (already decrypted when stored in authorize step)
        if (!password) {
            throw new Error('Server password not available');
        }
        
        // Create Rclone remote config with token
        // Build config parameters - include original client_id/client_secret if provided
        // Also include additional parameters (e.g., OneDrive drive_id/drive_type)
        const configParameters = {
            ...parameters,
            ...additionalParameters, // Add OneDrive drive_id/drive_type if fetched
            token: tokenString
        };
        
        // Add client_id and client_secret back if they were provided
        if (clientId) {
            configParameters.client_id = clientId;
        }
        if (clientSecret) {
            configParameters.client_secret = clientSecret;
        }
        
        console.log(`[OAUTH] Creating Rclone config for ${remoteType} remote "${remoteName}"`);
        console.log(`[OAUTH] Config parameters keys: ${Object.keys(configParameters).join(', ')}`);
        console.log(`[OAUTH] Token length: ${tokenString.length}, Token preview: ${tokenString.substring(0, 50)}...`);
        
        // CRITICAL: Stop our temporary callback server BEFORE Rclone tries to use port 53682
        // Rclone's config/create tries to start its own OAuth webserver on port 53682
        // (even though we've already handled OAuth - Rclone does this for token refresh/validation)
        // We must stop our server so Rclone can bind to the port
        console.log(`[OAUTH] Stopping our callback server so Rclone can use port 53682 for config/create...`);
        await stopOAuthCallbackServer();
        
        // Wait for port to be released (Rclone needs it)
        // Also wait a bit longer to ensure any lingering connections are closed
        console.log(`[OAUTH] Waiting for port 53682 to be released...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Check if config already exists - if so, delete it first to avoid token refresh issues
        // Rclone's config/update tries to refresh tokens, which can hang or fail
        // By deleting and recreating, we avoid the refresh logic
        let configExists = false;
        try {
            const existingConfig = await axiosInstance.post(
                `${server.url}/config/get`,
                { name: remoteName },
                {
                    auth: { username: server.username, password: password },
                    timeout: 5000
                }
            );
            configExists = existingConfig.data && Object.keys(existingConfig.data).length > 0;
            if (configExists) {
                console.log(`[OAUTH] Config exists, deleting it first to avoid token refresh issues...`);
                try {
                    await axiosInstance.post(
                        `${server.url}/config/delete`,
                        { name: remoteName },
                        {
                            auth: { username: server.username, password: password },
                            timeout: 10000
                        }
                    );
                    console.log(`[OAUTH] Existing config deleted successfully`);
                    // Wait a moment for Rclone to fully process the deletion
                    await new Promise(resolve => setTimeout(resolve, 500));
                } catch (deleteError) {
                    console.warn(`[OAUTH] Failed to delete existing config (may not exist): ${deleteError.message}`);
                    // Continue anyway - config/create will overwrite
                }
            }
        } catch (error) {
            // Config doesn't exist or error checking - assume it doesn't exist
            configExists = false;
            console.log(`[OAUTH] Config does not exist (or error checking), will create`);
        }
        
        // CRITICAL: Rclone's config/create initializes the remote backend and validates tokens
        // For OAuth remotes, Rclone might return a 500 error during token validation, but still create the config
        // We need to wait for config/create to complete, then verify the config exists
        console.log(`[OAUTH] Creating config with config/create endpoint...`);
        
        let configCreated = false;
        try {
            // Wait for config/create to complete (with timeout)
            await axiosInstance.post(
                `${server.url}/config/create`,
                {
                    name: remoteName,
                    type: remoteType,
                    parameters: configParameters
                },
                {
                    auth: { username: server.username, password: password },
                    timeout: 30000 // 30 seconds timeout
                }
            );
            console.log(`[OAUTH] Config creation completed successfully`);
            configCreated = true;
        } catch (configError) {
            // For OAuth remotes, Rclone might return 500 during token validation but still create the config
            // This is expected behavior - we'll verify the config exists below
            console.log(`[OAUTH] Config create returned error (may be expected for OAuth remotes), verifying...`);
            const errorDetails = configError.response?.data || configError.message;
            const errorMsg = typeof errorDetails === 'string' ? errorDetails : JSON.stringify(errorDetails);
            console.log(`[OAUTH] Config create error: ${errorMsg}`);
            console.log(`[OAUTH] Config create error status: ${configError.response?.status || 'N/A'}`);
            console.log(`[OAUTH] Config create error response:`, JSON.stringify(configError.response?.data || {}, null, 2));
        }
        
        // Verify config was written and has token
        // Retry a few times in case Rclone is still writing the config
        let verifyConfig = null;
        let retries = 5;
        while (retries > 0 && !verifyConfig) {
            try {
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second between retries
                const verifyResponse = await axiosInstance.post(
                    `${server.url}/config/get`,
                    { name: remoteName },
                    {
                        auth: { username: server.username, password: password },
                        timeout: 5000
                    }
                );
                if (verifyResponse.data && Object.keys(verifyResponse.data).length > 0) {
                    verifyConfig = verifyResponse.data;
                    console.log(`[OAUTH] ✅ Config verified - remote "${remoteName}" exists`);
                    console.log(`[OAUTH] Config structure:`, {
                        hasToken: !!verifyConfig.token,
                        tokenLength: verifyConfig.token?.length || 0,
                        hasParameters: !!verifyConfig.parameters,
                        parametersKeys: verifyConfig.parameters ? Object.keys(verifyConfig.parameters) : [],
                        parametersTokenLength: verifyConfig.parameters?.token?.length || 0
                    });
                    
                    // Check if token is actually present
                    const hasToken = (verifyConfig.token && verifyConfig.token.length > 0) ||
                                   (verifyConfig.parameters && verifyConfig.parameters.token && verifyConfig.parameters.token.length > 0);
                    if (!hasToken) {
                        console.error(`[OAUTH] ❌ Config exists but token is empty!`);
                        console.error(`[OAUTH] Full config response:`, JSON.stringify(verifyConfig, null, 2));
                        console.error(`[OAUTH] Token we tried to save (first 100 chars):`, tokenString.substring(0, 100) + '...');
                        
                        // Try using config/update instead - Rclone's config/create might be rejecting/clearing the token
                        console.log(`[OAUTH] Attempting to use config/update to set token...`);
                        try {
                            // Build update payload - try both root level and parameters
                            let updatePayload;
                            if (verifyConfig.parameters && Object.keys(verifyConfig.parameters).length > 0) {
                                // Config uses parameters object
                                updatePayload = {
                                    name: remoteName,
                                    parameters: {
                                        ...verifyConfig.parameters,
                                        token: tokenString
                                    }
                                };
                            } else {
                                // Config is stored at root level (like OneDrive)
                                updatePayload = {
                                    name: remoteName,
                                    parameters: {
                                        ...verifyConfig,
                                        token: tokenString
                                    }
                                };
                            }
                            
                            await axiosInstance.post(
                                `${server.url}/config/update`,
                                updatePayload,
                                {
                                    auth: { username: server.username, password: password },
                                    timeout: 10000
                                }
                            );
                            
                            // Verify token was saved
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            const recheckResponse = await axiosInstance.post(
                                `${server.url}/config/get`,
                                { name: remoteName },
                                {
                                    auth: { username: server.username, password: password },
                                    timeout: 5000
                                }
                            );
                            
                            const recheckConfig = recheckResponse.data;
                            const recheckHasToken = (recheckConfig.token && recheckConfig.token.length > 0) ||
                                                  (recheckConfig.parameters && recheckConfig.parameters.token && recheckConfig.parameters.token.length > 0);
                            
                            if (recheckHasToken) {
                                console.log(`[OAUTH] ✅ Token saved successfully using config/update`);
                                verifyConfig = recheckConfig; // Update for later use
                            } else {
                                throw new Error('config/update also failed to save token');
                            }
                        } catch (updateError) {
                            console.error(`[OAUTH] ❌ config/update also failed:`, updateError.message);
                            console.error(`[OAUTH] Update error details:`, updateError.response?.data || updateError.message);
                            throw new Error('Config was created but token is empty. Rclone rejected the token format. Please try authenticating again.');
                        }
                    }
                    console.log(`[OAUTH] ✅ Token verified in config`);
                    break;
                }
            } catch (verifyError) {
                retries--;
                if (retries === 0) {
                    console.error(`[OAUTH] ❌ Could not verify config after retries: ${verifyError.message}`);
                    throw new Error(`Failed to verify config creation: ${verifyError.message}`);
                }
                console.log(`[OAUTH] Config not yet written, retrying... (${retries} retries left)`);
            }
        }
        
        if (!verifyConfig) {
            throw new Error('Config creation failed - config was not created after retries');
        }
        
        console.log(`[OAUTH] Successfully created remote config for "${remoteName}"`);
        
        // Clean up state on success
        oauthStateStore.delete(state);
        
        // Note: Our callback server was stopped before config/create (so Rclone could use port 53682)
        // Rclone's OAuth webserver should have finished by now, but we'll start our server again
        // when the next OAuth flow begins (in handleAuthorize)
        
        // Return success page
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>OAuth Success</title></head>
            <body>
                <h1>OAuth Success</h1>
                <p>Authentication successful! You can close this window.</p>
                <script>
                    if (window.opener) {
                        window.opener.postMessage('oauth-success', '*');
                    }
                    setTimeout(function() {
                        window.close();
                    }, 2000);
                </script>
            </body>
            </html>
        `);
        
    } catch (error) {
        console.error('[OAUTH] Callback error:', error);
        
        // Clean up state on error (if state was retrieved)
        if (state && oauthStateStore.has(state)) {
            oauthStateStore.delete(state);
        }
        
        // Stop temporary callback server on error (with delay to ensure error response is sent)
        setTimeout(async () => {
            await stopOAuthCallbackServer();
        }, 2000);
        
        // Escape error message to prevent XSS
        const escapeHtml = (str) => {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        };
        const safeMessage = escapeHtml(error.message);
        
        return res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head><title>OAuth Error</title></head>
            <body>
                <h1>OAuth Error</h1>
                <p>Failed to complete OAuth flow: ${safeMessage}</p>
                <script>
                    if (window.opener) {
                        window.opener.postMessage('oauth-error', '*');
                    }
                </script>
            </body>
            </html>
        `);
    }
}

/**
 * Handle OAuth check request
 * 
 * Polls Rclone to check if the remote config was created with OAuth tokens
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} getServerById - Function to get server by ID
 * @param {Function} getDefaultServer - Function to get default server
 * @param {Object} axiosInstance - Axios instance for Rclone API calls
 */
async function handleCheck(req, res, getServerById, getDefaultServer, axiosInstance) {
    try {
        const { name, serverId } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Missing required field: name' });
        }
        
        // Get server configuration
        const server = serverId ? await getServerById(serverId) : await getDefaultServer();
        if (!server) {
            return res.status(404).json({ error: 'No rclone server configured' });
        }
        
        // Decrypt password
        let password = server.password;
        if (server.encryptedPassword) {
            try {
                const auth = require('../auth');
                password = auth.decryptPassword(server.encryptedPassword, req.adminPassword);
            } catch (error) {
                return res.status(401).json({ error: 'Failed to decrypt server credentials' });
            }
        }
        
        // Check if remote config exists and has tokens
        let configResponse;
        try {
            configResponse = await axiosInstance.post(
                `${server.url}/config/get`,
                { name: name },
                {
                    auth: { username: server.username, password: password },
                    timeout: 10000
                }
            );
        } catch (configError) {
            // If config/get fails, it might be because:
            // 1. Config doesn't exist (404) - not authenticated
            // 2. RCD error (500) - might be invalid config, but we can't tell
            // 3. Network error - can't determine status
            console.error('[OAUTH] Error getting config:', configError.response?.status, configError.message);
            
            if (configError.response?.status === 404) {
                // Config doesn't exist - definitely not authenticated
                return res.json({
                    success: true,
                    authenticated: false,
                    message: 'Remote config not found'
                });
            } else {
                // Other error (500, network, etc.) - can't determine status
                // Return authenticated: false but with error info
                return res.json({
                    success: false,
                    authenticated: false,
                    message: 'Unable to check authentication status',
                    error: configError.response?.data?.error || configError.message,
                    rcdError: configError.response?.status === 500 ? 'Rclone RCD returned an error. Remote config may be invalid or token expired.' : null
                });
            }
        }
        
        if (configResponse.data && Object.keys(configResponse.data).length > 0) {
            const config = configResponse.data;
            
            // Check for token in various locations
            // Check for non-empty strings (empty string is falsy but we want to detect actual tokens)
            const hasToken = (config.token && config.token.length > 0) ||
                           (config.access_token && config.access_token.length > 0) ||
                           (config.refresh_token && config.refresh_token.length > 0) ||
                           (config.parameters && (
                               (config.parameters.token && config.parameters.token.length > 0) ||
                               (config.parameters.access_token && config.parameters.access_token.length > 0) ||
                               (config.parameters.refresh_token && config.parameters.refresh_token.length > 0)
                           ));
            
            // IMPORTANT: Don't send full config with token to frontend for security
            // Only send a sanitized version
            const sanitizedConfig = {
                type: config.type,
                token: config.token ? (config.token.length > 0 ? '[REDACTED]' : '') : ''
            };
            
            return res.json({
                success: true,
                authenticated: !!hasToken,
                message: hasToken ? 'Remote authenticated' : 'Remote exists but no token found',
                config: sanitizedConfig
            });
        }
        
        return res.json({
            success: true,
            authenticated: false,
            message: 'Remote config not found'
        });
        
    } catch (error) {
        console.error('[OAUTH] Check error:', error);
        return res.status(500).json({
            error: 'OAuth check failed',
            details: error.message
        });
    }
}

/**
 * Handle OAuth account info request
 * 
 * Fetches account information (email, name) from the OAuth provider using the stored token
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} getServerById - Function to get server by ID
 * @param {Function} getDefaultServer - Function to get default server
 * @param {Object} axiosInstance - Axios instance for Rclone API calls
 */
async function handleAccountInfo(req, res, getServerById, getDefaultServer, axiosInstance) {
    try {
        const { name, serverId } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Missing required field: name' });
        }
        
        // Get server configuration
        const server = serverId ? await getServerById(serverId) : await getDefaultServer();
        if (!server) {
            return res.status(404).json({ error: 'No rclone server configured' });
        }
        
        // Decrypt password
        let password = server.password;
        if (server.encryptedPassword) {
            try {
                const auth = require('../auth');
                password = auth.decryptPassword(server.encryptedPassword, req.adminPassword);
            } catch (error) {
                return res.status(401).json({ error: 'Failed to decrypt server credentials' });
            }
        }
        
        // Get config to find remote type and token
        const configResponse = await axiosInstance.post(
            `${server.url}/config/get`,
            { name: name },
            {
                auth: { username: server.username, password: password },
                timeout: 10000
            }
        );
        
        if (!configResponse.data || Object.keys(configResponse.data).length === 0) {
            return res.status(404).json({ error: 'Config not found' });
        }
        
        const config = configResponse.data;
        const remoteType = config.type || configResponse.data.type;
        
        // Get provider implementation
        const ProviderClass = providers[remoteType];
        if (!ProviderClass) {
            return res.status(400).json({ error: `OAuth not implemented for provider: ${remoteType}` });
        }
        
        const provider = new ProviderClass();
        
        // Extract token from config
        // OneDrive stores config in root, not parameters - check both locations
        let tokenJson = null;
        let tokenString = null;
        
        if (config.parameters && config.parameters.token) {
            tokenString = config.parameters.token;
        } else if (config.token) {
            tokenString = config.token;
        }
        
        if (!tokenString || tokenString.length === 0) {
            return res.status(400).json({ error: 'No OAuth token found in config' });
        }
        
        try {
            tokenJson = JSON.parse(tokenString);
        } catch (parseError) {
            console.error(`[OAUTH] Failed to parse token JSON for ${remoteType} remote "${name}":`, parseError);
            return res.status(400).json({ 
                error: 'Invalid token format in config',
                details: parseError.message 
            });
        }
        
        if (!tokenJson || !tokenJson.access_token) {
            console.error(`[OAUTH] Token missing access_token for ${remoteType} remote "${name}"`);
            return res.status(400).json({ error: 'Token missing access_token field' });
        }
        
        // Get client credentials for token refresh if needed
        // OneDrive stores client_id/client_secret in root, not parameters
        const clientId = config.parameters?.client_id || config.client_id || provider.config.clientId;
        const clientSecret = config.parameters?.client_secret || config.client_secret || provider.config.clientSecret;
        
        console.log(`[OAUTH] Client credentials for ${remoteType} remote "${name}":`, {
            hasClientId: !!clientId,
            hasClientSecret: !!clientSecret,
            clientIdSource: config.parameters?.client_id ? 'parameters' : config.client_id ? 'root' : 'provider.config',
            clientSecretSource: config.parameters?.client_secret ? 'parameters' : config.client_secret ? 'root' : 'provider.config'
        });
        
        // Extract provider-specific options (e.g., region for OneDrive)
        const providerOptions = {};
        if (remoteType === 'onedrive') {
            // OneDrive requires region parameter for correct endpoint
            // Check both parameters.region and config.region (Rclone stores it in root for some versions)
            providerOptions.region = config.parameters?.region || config.region || 'global';
            console.log(`[OAUTH] OneDrive account info for "${name}" - using region: ${providerOptions.region}`);
            console.log(`[OAUTH] OneDrive config keys:`, Object.keys(config));
            console.log(`[OAUTH] OneDrive parameters:`, config.parameters ? Object.keys(config.parameters) : 'none');
            
            // Check if OneDrive remote is missing drive_id and drive_type (required by Rclone)
            // This can happen for remotes created before we started fetching these during OAuth
            const hasDriveId = config.drive_id || config.parameters?.drive_id;
            const hasDriveType = config.drive_type || config.parameters?.drive_type;
            
            if (!hasDriveId || !hasDriveType) {
                console.log(`[OAUTH] OneDrive remote "${name}" is missing drive_id or drive_type, fetching...`);
                try {
                    const driveInfo = await provider.getDriveInfo(
                        tokenJson.access_token,
                        tokenJson.refresh_token || null,
                        {
                            clientId: clientId,
                            clientSecret: clientSecret,
                            region: providerOptions.region
                        }
                    );
                    
                    // Update config with drive_id and drive_type
                    // OneDrive stores config in root, not parameters
                    let updatePayload;
                    if (config.parameters && Object.keys(config.parameters).length > 0) {
                        updatePayload = {
                            name: name,
                            parameters: {
                                ...config.parameters,
                                drive_id: driveInfo.drive_id,
                                drive_type: driveInfo.drive_type
                            }
                        };
                    } else {
                        const rootFields = { ...config };
                        rootFields.drive_id = driveInfo.drive_id;
                        rootFields.drive_type = driveInfo.drive_type;
                        updatePayload = {
                            name: name,
                            parameters: rootFields
                        };
                    }
                    
                    await axiosInstance.post(
                        `${server.url}/config/update`,
                        updatePayload,
                        {
                            auth: { username: server.username, password: password },
                            timeout: 10000
                        }
                    );
                    
                    console.log(`[OAUTH] OneDrive remote "${name}" updated with drive_id and drive_type`);
                    
                    // Update token if it was refreshed during drive info fetch
                    if (driveInfo.newToken) {
                        const utils = require('./utils');
                        const tokenToFormat = {
                            ...driveInfo.newToken,
                            refresh_token: driveInfo.newToken.refresh_token || tokenJson.refresh_token || null
                        };
                        const newTokenString = utils.formatTokenForRclone(tokenToFormat);
                        
                        if (config.parameters && Object.keys(config.parameters).length > 0) {
                            updatePayload.parameters.token = newTokenString;
                        } else {
                            updatePayload.parameters.token = newTokenString;
                        }
                        
                        await axiosInstance.post(
                            `${server.url}/config/update`,
                            updatePayload,
                            {
                                auth: { username: server.username, password: password },
                                timeout: 10000
                            }
                        );
                        
                        // Update tokenJson for account info call
                        tokenJson = driveInfo.newToken;
                    }
                    
                    // Reload config to get updated values
                    const updatedConfigResponse = await axiosInstance.post(
                        `${server.url}/config/get`,
                        { name: name },
                        {
                            auth: { username: server.username, password: password },
                            timeout: 10000
                        }
                    );
                    Object.assign(config, updatedConfigResponse.data);
                } catch (driveError) {
                    console.error(`[OAUTH] Failed to fetch drive info for existing OneDrive remote:`, driveError);
                    // Don't fail the account info request - just log the error
                    // User can manually fix by re-authenticating
                }
            }
        }
        
        // Fetch account info from provider
        // Note: RCD automatically refreshes tokens for RCD API calls, but we're calling
        // the provider's API directly (e.g., Microsoft Graph), so we handle refresh here.
        // getAccountInfo may return a new token if refresh occurred (reactive refresh on 401).
        let result;
        try {
            result = await provider.getAccountInfo(
                tokenJson.access_token,
                tokenJson.refresh_token || null,
                {
                    clientId: clientId,
                    clientSecret: clientSecret,
                    remoteName: name, // Pass remote name for token update
                    server: server, // Pass server for config update
                    password: password, // Pass password for config update
                    axiosInstance: axiosInstance, // Pass axios instance for config update
                    ...providerOptions // Spread provider-specific options
                }
            );
        } catch (accountInfoError) {
            console.error(`[OAUTH] Error fetching account info for ${remoteType} remote "${name}":`, accountInfoError);
            console.error(`[OAUTH] Error details:`, {
                message: accountInfoError.message,
                status: accountInfoError.response?.status,
                statusText: accountInfoError.response?.statusText,
                data: accountInfoError.response?.data,
                stack: accountInfoError.stack
            });
            
            const errorMessage = accountInfoError.response?.data?.error?.message || 
                               accountInfoError.response?.data?.error_description ||
                               accountInfoError.response?.data?.error ||
                               accountInfoError.message ||
                               'Unknown error';
            
            return res.status(500).json({
                error: `Failed to fetch account information`,
                details: errorMessage,
                provider: remoteType
            });
        }
        
        // result can be { accountInfo, newToken } if refresh occurred, or just accountInfo
        const accountInfo = result.accountInfo || result;
        const newToken = result.newToken;
        
        // If token was refreshed, update Rclone config
        if (newToken) {
            console.log('[OAUTH] Token was refreshed, updating Rclone config...');
            try {
                // Format new token for Rclone
                // Preserve refresh_token if new token doesn't have one (Dropbox refresh may not return new refresh_token)
                const utils = require('./utils');
                const tokenToFormat = {
                    ...newToken,
                    // Preserve old refresh_token if new token doesn't include one
                    refresh_token: newToken.refresh_token || tokenJson.refresh_token || null
                };
                const newTokenString = utils.formatTokenForRclone(tokenToFormat);
                
                // Update config with new token
                // OneDrive stores config in root, not parameters - handle both cases
                let updatePayload;
                if (config.parameters && Object.keys(config.parameters).length > 0) {
                    // Remote uses parameters object (e.g., Dropbox)
                    updatePayload = {
                        name: name,
                        parameters: {
                            ...config.parameters,
                            token: newTokenString
                        }
                    };
                } else {
                    // Remote stores config in root (e.g., OneDrive)
                    // Build update payload with all root-level fields, updating token
                    const rootFields = { ...config };
                    rootFields.token = newTokenString; // Update token
                    
                    updatePayload = {
                        name: name,
                        parameters: rootFields // Rclone's config/update expects parameters even for root-level configs
                    };
                }
                
                await axiosInstance.post(
                    `${server.url}/config/update`,
                    updatePayload,
                    {
                        auth: { username: server.username, password: password },
                        timeout: 10000
                    }
                );
                
                console.log('[OAUTH] Config updated with refreshed token');
            } catch (updateError) {
                console.error('[OAUTH] Failed to update config with refreshed token:', updateError);
                // Don't fail the request - account info was retrieved successfully
            }
        }
        
        return res.json({
            success: true,
            account: accountInfo
        });
        } catch (error) {
            console.error('[OAUTH] Account info error:', error);
            console.error('[OAUTH] Error stack:', error.stack);
            console.error('[OAUTH] Error response:', error.response?.data);
            console.error('[OAUTH] Error status:', error.response?.status);
            console.error('[OAUTH] Error config:', {
                remoteName: name,
                remoteType: remoteType,
                hasToken: !!tokenJson,
                hasAccessToken: !!(tokenJson?.access_token),
                hasRefreshToken: !!(tokenJson?.refresh_token),
                hasClientId: !!clientId,
                hasClientSecret: !!clientSecret,
                providerOptions: providerOptions
            });
            
            // Provide more detailed error information
            let errorMessage = error.message || 'Unknown error';
            let errorDetails = null;
            
            if (error.response?.data) {
                errorDetails = error.response.data;
                if (typeof errorDetails === 'object') {
                    // Microsoft Graph API errors
                    if (errorDetails.error) {
                        errorMessage = errorDetails.error.message || errorDetails.error.description || errorMessage;
                    } else {
                        errorMessage = errorDetails.message || errorDetails.error_description || errorMessage;
                    }
                } else if (typeof errorDetails === 'string') {
                    errorMessage = errorDetails;
                }
            }
            
            return res.status(500).json({
                error: 'Failed to get account info',
                details: errorMessage,
                provider: remoteType || 'unknown',
                ...(errorDetails && typeof errorDetails === 'object' ? errorDetails : {})
            });
        }
}

/**
 * Handle OAuth revoke request
 * 
 * Deletes the remote config to revoke authentication
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} getServerById - Function to get server by ID
 * @param {Function} getDefaultServer - Function to get default server
 * @param {Object} axiosInstance - Axios instance for Rclone API calls
 */
async function handleRevoke(req, res, getServerById, getDefaultServer, axiosInstance) {
    try {
        const { name, serverId } = req.body;
        
        if (!name) {
            return res.status(400).json({ error: 'Missing required field: name' });
        }
        
        // Get server configuration
        const server = serverId ? await getServerById(serverId) : await getDefaultServer();
        if (!server) {
            return res.status(404).json({ error: 'No rclone server configured' });
        }
        
        // Decrypt password
        let password = server.password;
        if (server.encryptedPassword) {
            try {
                const auth = require('../auth');
                password = auth.decryptPassword(server.encryptedPassword, req.adminPassword);
            } catch (error) {
                return res.status(401).json({ error: 'Failed to decrypt server credentials' });
            }
        }
        
        // Delete the config
        await axiosInstance.post(
            `${server.url}/config/delete`,
            { name: name },
            {
                auth: { username: server.username, password: password },
                timeout: 10000
            }
        );
        
        return res.json({
            success: true,
            message: 'Authentication revoked successfully'
        });
    } catch (error) {
        console.error('[OAUTH] Revoke error:', error);
        // If config doesn't exist, that's fine - consider it revoked
        if (error.response?.status === 404 || error.response?.status === 400) {
            return res.json({
                success: true,
                message: 'Config not found (already revoked)'
            });
        }
        return res.status(500).json({
            error: 'Failed to revoke authentication',
            details: error.message
        });
    }
}

/**
 * Detect what's using port 53682
 * Returns: { inUse: boolean, type: 'our-server' | 'rclone-server' | 'unknown' | 'free', details: string }
 */
async function detectPort53682Status() {
    console.log(`[OAUTH] 🔍 Detecting port ${OAUTH_CALLBACK_PORT} status...`);
    
    // Check if our server is running
    if (oauthCallbackServer) {
        console.log(`[OAUTH] ✅ Port ${OAUTH_CALLBACK_PORT} is in use by our callback server`);
        return {
            inUse: true,
            type: 'our-server',
            details: 'Rclone Director OAuth callback server'
        };
    }
    
    // Try to bind to the port to check if it's available
    try {
        const testServer = http.createServer();
        await new Promise((resolve, reject) => {
            testServer.listen(OAUTH_CALLBACK_PORT, '127.0.0.1', () => {
                testServer.close(() => resolve());
            });
            testServer.on('error', (error) => {
                testServer.close();
                if (error.code === 'EADDRINUSE') {
                    reject(new Error('EADDRINUSE'));
                } else {
                    reject(error);
                }
            });
        });
        
        // Port is free
        console.log(`[OAUTH] ✅ Port ${OAUTH_CALLBACK_PORT} is free`);
        return {
            inUse: false,
            type: 'free',
            details: 'Port is available'
        };
    } catch (error) {
        if (error.message === 'EADDRINUSE' || error.code === 'EADDRINUSE') {
            // Port is in use - try to identify what's using it
            console.log(`[OAUTH] ⚠️  Port ${OAUTH_CALLBACK_PORT} is in use, identifying the application...`);
            
            // Try to probe the port with HTTP request
            try {
                const axios = require('axios');
                const response = await axios.get(`http://127.0.0.1:${OAUTH_CALLBACK_PORT}/`, {
                    timeout: 2000,
                    validateStatus: () => true // Accept any status code
                });
                
                // Check response to identify the server
                const responseText = response.data?.toString() || '';
                
                if (responseText.includes('Failure!') || responseText.includes('Auth Error') || responseText.includes('No code returned')) {
                    console.log(`[OAUTH] 🔍 Detected Rclone's OAuth webserver on port ${OAUTH_CALLBACK_PORT}`);
                    return {
                        inUse: true,
                        type: 'rclone-server',
                        details: 'Rclone RCD OAuth webserver (likely from a previous config/create operation)'
                    };
                } else if (responseText.includes('OAuth Callback Endpoint') || responseText.includes('Rclone Director')) {
                    console.log(`[OAUTH] 🔍 Detected our callback server on port ${OAUTH_CALLBACK_PORT}`);
                    return {
                        inUse: true,
                        type: 'our-server',
                        details: 'Rclone Director OAuth callback server'
                    };
                } else {
                    console.log(`[OAUTH] ⚠️  Port ${OAUTH_CALLBACK_PORT} is in use by unknown application`);
                    return {
                        inUse: true,
                        type: 'unknown',
                        details: 'Unknown application (HTTP response received)'
                    };
                }
            } catch (probeError) {
                // Port is in use but doesn't respond to HTTP - might be a different service
                console.log(`[OAUTH] ⚠️  Port ${OAUTH_CALLBACK_PORT} is in use but doesn't respond to HTTP requests`);
                return {
                    inUse: true,
                    type: 'unknown',
                    details: 'Port is in use but not responding to HTTP (may be a non-HTTP service)'
                };
            }
        } else {
            throw error;
        }
    }
}

/**
 * Wait for port 53682 to become available
 * Polls every 2 seconds, max 30 seconds
 * Returns: { available: boolean, waited: number (seconds) }
 */
async function waitForPort53682(maxWaitSeconds = 30) {
    const pollInterval = 2000; // 2 seconds
    const maxPolls = Math.floor(maxWaitSeconds * 1000 / pollInterval);
    let polls = 0;
    
    console.log(`[OAUTH] ⏳ Waiting for port ${OAUTH_CALLBACK_PORT} to become available (max ${maxWaitSeconds} seconds)...`);
    
    while (polls < maxPolls) {
        const status = await detectPort53682Status();
        
        if (!status.inUse || status.type === 'our-server') {
            const waitedSeconds = (polls * pollInterval) / 1000;
            console.log(`[OAUTH] ✅ Port ${OAUTH_CALLBACK_PORT} is now available (waited ${waitedSeconds.toFixed(1)} seconds)`);
            return { available: true, waited: waitedSeconds };
        }
        
        if (status.type === 'rclone-server') {
            console.log(`[OAUTH] ⏳ Port ${OAUTH_CALLBACK_PORT} still in use by Rclone (waiting ${pollInterval/1000}s, attempt ${polls + 1}/${maxPolls})...`);
        } else {
            console.log(`[OAUTH] ⏳ Port ${OAUTH_CALLBACK_PORT} still in use (waiting ${pollInterval/1000}s, attempt ${polls + 1}/${maxPolls})...`);
        }
        
        polls++;
        await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
    
    const waitedSeconds = (polls * pollInterval) / 1000;
    console.log(`[OAUTH] ❌ Port ${OAUTH_CALLBACK_PORT} did not become available after ${waitedSeconds} seconds`);
    return { available: false, waited: waitedSeconds };
}

/**
 * Start temporary OAuth callback server on port 53682
 * This catches callbacks from providers that use Rclone's registered redirect_uri
 * 
 * Note: This server is temporary - started when OAuth begins, stopped after completion.
 * This matches Rclone's behavior (it only starts the server during config).
 * 
 * @param {Function} getServerById - Function to get server by ID
 * @param {Function} getDefaultServer - Function to get default server
 * @param {Object} axiosInstance - Axios instance for Rclone API calls
 */
async function startOAuthCallbackServer(getServerById, getDefaultServer, axiosInstance) {
    // If server is already running, reuse it (might be from a previous OAuth attempt)
    // This is fine - one server can handle multiple OAuth callbacks
    if (oauthCallbackServer) {
        console.log(`[OAUTH] Callback server already running on port ${OAUTH_CALLBACK_PORT} (reusing for new OAuth flow)`);
        // Clear any existing timeout since we're reusing the server
        if (oauthCallbackServerTimeout) {
            clearTimeout(oauthCallbackServerTimeout);
            oauthCallbackServerTimeout = null;
        }
        // Set a new timeout for this OAuth flow
        oauthCallbackServerTimeout = setTimeout(async () => {
            console.log(`[OAUTH] ⚠️  OAuth callback server timeout (${OAUTH_CALLBACK_TIMEOUT / 1000 / 60} minutes) - stopping server`);
            await stopOAuthCallbackServer();
        }, OAUTH_CALLBACK_TIMEOUT);
        return;
    }
    
    // Check if port is available
    try {
        const testServer = http.createServer();
        await new Promise((resolve, reject) => {
            testServer.listen(OAUTH_CALLBACK_PORT, '127.0.0.1', () => {
                testServer.close(() => resolve());
            });
            testServer.on('error', (error) => {
                if (error.code === 'EADDRINUSE') {
                    // Port is in use - check if it's Rclone's OAuth webserver
                    // If so, wait a bit and try to stop it, or wait for it to finish
                    console.warn(`[OAUTH] Port ${OAUTH_CALLBACK_PORT} is in use - may be Rclone's OAuth webserver`);
                    console.warn(`[OAUTH] Waiting 3 seconds for Rclone to release the port...`);
                    testServer.close();
                    reject(new Error(`Port ${OAUTH_CALLBACK_PORT} is already in use. This may be Rclone's OAuth webserver. Please wait a moment and try again.`));
                } else {
                    reject(error);
                }
            });
        });
    } catch (error) {
        if (error.message.includes('already in use')) {
            // Port is in use - wait a bit and retry once
            console.log(`[OAUTH] Port ${OAUTH_CALLBACK_PORT} is in use, waiting 3 seconds and retrying...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Try again
            try {
                const retryServer = http.createServer();
                await new Promise((resolve, reject) => {
                    retryServer.listen(OAUTH_CALLBACK_PORT, '127.0.0.1', () => {
                        retryServer.close(() => resolve());
                    });
                    retryServer.on('error', (error) => {
                        retryServer.close();
                        if (error.code === 'EADDRINUSE') {
                            reject(new Error(`Port ${OAUTH_CALLBACK_PORT} is still in use after waiting. Please stop Rclone RCD or any other service using this port.`));
                        } else {
                            reject(error);
                        }
                    });
                });
                console.log(`[OAUTH] Port ${OAUTH_CALLBACK_PORT} is now available after waiting`);
            } catch (retryError) {
                throw retryError;
            }
        } else {
            throw new Error(`Failed to start OAuth callback server: ${error.message}`);
        }
    }
    
    // Create Express app for callback server
    const callbackApp = express();
    callbackApp.use(express.urlencoded({ extended: false }));
    callbackApp.use(express.json());
    
    // Handle all requests - forward to our main callback handler
    callbackApp.all('*', async (req, res) => {
        // Log callback receipt but sanitize URL to avoid exposing OAuth codes/tokens
        console.log(`[OAUTH-CALLBACK-SERVER] Received callback on port ${OAUTH_CALLBACK_PORT}: ${req.method} ${sanitizeUrlForLog(req.url)}`);
        
        // Check if this is a direct browser access (no OAuth parameters)
        const hasCode = req.query.code || (req.body && req.body.code);
        const hasState = req.query.state || (req.body && req.body.state);
        
        if (!hasCode && !hasState) {
            // Direct browser access - show friendly message
            return res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>OAuth Callback Endpoint</title>
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                        .info { background: #e3f2fd; border: 1px solid #2196f3; border-radius: 5px; padding: 20px; max-width: 600px; margin: 0 auto; }
                    </style>
                </head>
                <body>
                    <div class="info">
                        <h1>OAuth Callback Endpoint</h1>
                        <p>This endpoint is used for OAuth authentication callbacks.</p>
                        <p>It should not be accessed directly in a browser.</p>
                        <p><small>Port: ${OAUTH_CALLBACK_PORT} | Status: Active</small></p>
                    </div>
                </body>
                </html>
            `);
        }
        
        // Set protocol for the request
        req.protocol = 'http';
        
        // Forward to our main callback handler
        try {
            await handleCallback(req, res, getServerById, getDefaultServer, axiosInstance);
        } catch (error) {
            console.error('[OAUTH-CALLBACK-SERVER] Error handling callback:', error);
            res.status(500).send(`
                <!DOCTYPE html>
                <html>
                <head><title>OAuth Error</title></head>
                <body>
                    <h1>OAuth Callback Error</h1>
                    <p>Failed to process OAuth callback: ${error.message}</p>
                    <script>
                        if (window.opener) {
                            window.opener.postMessage('oauth-error', '*');
                        }
                    </script>
                </body>
                </html>
            `);
        }
    });
    
    // Start the temporary server on 127.0.0.1 (matching Rclone's bindAddress)
    // This ensures exact redirect_uri match for providers like Box that are strict about it
    // Note: The server listens on 127.0.0.1, but accepts connections from both 127.0.0.1 and localhost
    // (they resolve to the same IP, so both redirect URIs work)
    return new Promise((resolve, reject) => {
        oauthCallbackServer = callbackApp.listen(OAUTH_CALLBACK_PORT, '127.0.0.1', () => {
            console.log(`[OAUTH] ✅ Temporary OAuth callback server started on http://127.0.0.1:${OAUTH_CALLBACK_PORT}/`);
            console.log(`[OAUTH] This will catch OAuth callbacks from providers using Rclone's registered redirect_uri`);
            console.log(`[OAUTH] Server will stop automatically after OAuth completes or after ${OAUTH_CALLBACK_TIMEOUT / 1000 / 60} minutes (timeout)`);
            
            // Set timeout to auto-stop server if OAuth never completes
            // This prevents the port from being held indefinitely if user abandons OAuth flow
            oauthCallbackServerTimeout = setTimeout(async () => {
                console.log(`[OAUTH] ⚠️  OAuth callback server timeout (${OAUTH_CALLBACK_TIMEOUT / 1000 / 60} minutes) - stopping server`);
                await stopOAuthCallbackServer();
            }, OAUTH_CALLBACK_TIMEOUT);
            
            resolve();
        });
        
        oauthCallbackServer.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`[OAUTH] ❌ Port ${OAUTH_CALLBACK_PORT} is already in use`);
                console.error(`[OAUTH] Please stop Rclone RCD or any other service using this port`);
                reject(new Error(`Port ${OAUTH_CALLBACK_PORT} is already in use`));
            } else {
                console.error(`[OAUTH] ❌ Failed to start callback server:`, error.message);
                reject(error);
            }
        });
    });
}

/**
 * Stop temporary OAuth callback server
 * Returns a Promise that resolves when the server is stopped
 */
function stopOAuthCallbackServer() {
    // Clear timeout if it exists
    if (oauthCallbackServerTimeout) {
        clearTimeout(oauthCallbackServerTimeout);
        oauthCallbackServerTimeout = null;
    }
    
    if (oauthCallbackServer) {
        return new Promise((resolve) => {
            oauthCallbackServer.close(() => {
                console.log(`[OAUTH] ✅ Temporary callback server stopped on port ${OAUTH_CALLBACK_PORT}`);
                oauthCallbackServer = null;
                resolve();
            });
            
            // Force close after 2 seconds if graceful close doesn't work
            setTimeout(() => {
                if (oauthCallbackServer) {
                    console.warn(`[OAUTH] Force closing callback server (graceful close timed out)`);
                    oauthCallbackServer.close();
                    oauthCallbackServer = null;
                }
                resolve();
            }, 2000);
        });
    }
    
    return Promise.resolve();
}

/**
 * Get OAuth state by state parameter
 * Used to check if a state belongs to the new OAuth implementation
 * @param {string} state - OAuth state parameter
 * @returns {object|undefined} State info or undefined if not found
 */
function getOAuthState(state) {
    return oauthStateStore.get(state);
}

module.exports = {
    handleAuthorize,
    handleCallback,
    handleCheck,
    handleAccountInfo,
    handleRevoke,
    validateCallbackToken,
    getOAuthState,
    oauthStateStore,
    providers,
    startOAuthCallbackServer,
    stopOAuthCallbackServer
};

