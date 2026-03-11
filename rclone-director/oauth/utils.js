/**
 * OAuth Utility Functions
 * 
 * Shared utilities for OAuth flow:
 * - State generation and validation
 * - Token formatting for Rclone
 * - URL manipulation
 * - Error handling
 */

const crypto = require('crypto');

/**
 * Generate a random state string for OAuth (128 characters, like Rclone)
 * @returns {string} Random state string
 */
function generateState() {
    return crypto.randomBytes(64).toString('hex'); // 128 hex characters
}

/**
 * Format OAuth token response for Rclone config
 * Rclone expects tokens as JSON string with structure:
 * {
 *   "access_token": "...",
 *   "refresh_token": "...",
 *   "token_type": "bearer",
 *   "expiry": "2024-01-01T00:00:00Z"
 * }
 * 
 * @param {Object} tokenResponse - Token response from OAuth provider
 * @returns {string} JSON string formatted for Rclone
 */
function formatTokenForRclone(tokenResponse) {
    if (!tokenResponse || !tokenResponse.access_token) {
        throw new Error('Invalid token response: missing access_token');
    }
    
    const token = {
        access_token: tokenResponse.access_token,
        token_type: tokenResponse.token_type || 'bearer'
    };
    
    // Calculate expiry - handle edge cases
    if (tokenResponse.expires_in) {
        const expiresIn = parseInt(tokenResponse.expires_in, 10);
        if (expiresIn > 0) {
            token.expiry = new Date(Date.now() + expiresIn * 1000).toISOString();
        } else {
            // If expires_in is 0 or negative, use default 1 hour
            token.expiry = new Date(Date.now() + 3600000).toISOString();
        }
    } else if (tokenResponse.expiry) {
        // Use provided expiry if available
        token.expiry = tokenResponse.expiry;
    } else {
        // Default to 1 hour if no expiry info
        token.expiry = new Date(Date.now() + 3600000).toISOString();
    }
    
    // Add refresh_token if present
    if (tokenResponse.refresh_token) {
        token.refresh_token = tokenResponse.refresh_token;
    }
    
    return JSON.stringify(token);
}

/**
 * Parse OAuth callback URL parameters
 * Handles both GET (query) and POST (body) callbacks
 * 
 * @param {Object} req - Express request object
 * @returns {Object} { code, state, error }
 */
function parseCallbackParams(req) {
    if (req.method === 'POST') {
        // For POST, state might be URL-encoded in the body
        const state = req.body?.state;
        return {
            code: req.body?.code,
            state: typeof state === 'string' ? decodeURIComponent(state) : state,
            error: req.body?.error,
            error_description: req.body?.error_description
        };
    } else {
        // For GET, Express automatically decodes query parameters, but ensure it's decoded
        const state = req.query?.state;
        return {
            code: req.query?.code,
            state: typeof state === 'string' ? decodeURIComponent(state) : state,
            error: req.query?.error,
            error_description: req.query?.error_description
        };
    }
}

/**
 * Build OAuth authorization URL
 * 
 * @param {Object} config - Provider OAuth config
 * @param {string} redirectUri - Callback redirect URI
 * @param {string} state - OAuth state parameter
 * @param {string} clientId - OAuth client ID (overrides config default)
 * @returns {string} Authorization URL
 */
function buildAuthURL(config, redirectUri, state, clientId = null) {
    const url = new URL(config.authURL);
    const params = new URLSearchParams();
    
    params.set('client_id', clientId || config.clientId);
    params.set('redirect_uri', redirectUri);
    params.set('response_type', 'code');
    params.set('state', state);
    
    // Add scopes
    if (config.scopes && config.scopes.length > 0) {
        params.set('scope', config.scopes.join(' '));
    }
    
    // Add additional parameters (e.g., token_access_type for Dropbox)
    if (config.additionalParams) {
        Object.entries(config.additionalParams).forEach(([key, value]) => {
            params.set(key, value);
        });
    }
    
    url.search = params.toString();
    return url.toString();
}

/**
 * Exchange authorization code for access token
 * 
 * @param {Object} config - Provider OAuth config
 * @param {string} code - Authorization code from callback
 * @param {string} redirectUri - Callback redirect URI (must match auth request)
 * @param {string} clientId - OAuth client ID
 * @param {string} clientSecret - OAuth client secret
 * @returns {Promise<Object>} Token response
 */
async function exchangeCodeForToken(config, code, redirectUri, clientId, clientSecret) {
    const axios = require('axios');
    
    const params = new URLSearchParams();
    params.set('grant_type', 'authorization_code');
    params.set('code', code);
    params.set('redirect_uri', redirectUri);
    params.set('client_id', clientId);
    params.set('client_secret', clientSecret);
    
    console.log(`[OAUTH-UTILS] Exchanging token at ${config.tokenURL}`);
    console.log(`[OAUTH-UTILS] Client ID: ${clientId ? clientId.substring(0, 10) + '...' : 'null'}`);
    console.log(`[OAUTH-UTILS] Client Secret: ${clientSecret ? '***' + clientSecret.substring(clientSecret.length - 4) : 'null'}`);
    console.log(`[OAUTH-UTILS] Redirect URI: ${redirectUri}`);
    
    try {
        // Increase timeout and add better error handling
        const response = await axios.post(config.tokenURL, params.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'rclone-director/1.0'
            },
            timeout: 60000, // Increase to 60 seconds
            validateStatus: function (status) {
                return status >= 200 && status < 500; // Accept all status codes < 500 to get error details
            },
            maxRedirects: 0, // Don't follow redirects
            // Add connection timeout
            httpAgent: new (require('http').Agent)({
                keepAlive: false,
                timeout: 10000 // 10 second connection timeout
            }),
            httpsAgent: new (require('https').Agent)({
                keepAlive: false,
                timeout: 10000, // 10 second connection timeout
                rejectUnauthorized: true
            })
        });
        
        // Check if we got an error response
        if (response.status >= 400) {
            const errorData = response.data || {};
            console.error(`[OAUTH-UTILS] Dropbox API returned error: ${response.status}`, errorData);
            throw new Error(`Token exchange failed: ${response.status} - ${JSON.stringify(errorData)}`);
        }
        
        console.log(`[OAUTH-UTILS] Token exchange successful`);
        return response.data;
    } catch (error) {
        console.error(`[OAUTH-UTILS] Token exchange error:`, error.message);
        console.error(`[OAUTH-UTILS] Error code:`, error.code);
        console.error(`[OAUTH-UTILS] Error response:`, error.response?.data);
        console.error(`[OAUTH-UTILS] Error status:`, error.response?.status);
        console.error(`[OAUTH-UTILS] Full error:`, error);
        
        // Re-throw with more context
        if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
            throw new Error(`Token exchange timed out. Check network connectivity to ${config.tokenURL}. Error: ${error.message}`);
        } else if (error.response) {
            // HTTP error response
            const errorData = error.response.data || {};
            throw new Error(`Token exchange failed: ${error.response.status} - ${JSON.stringify(errorData)}`);
        } else {
            throw new Error(`Token exchange failed: ${error.message} (code: ${error.code || 'unknown'})`);
        }
    }
}

module.exports = {
    generateState,
    formatTokenForRclone,
    parseCallbackParams,
    buildAuthURL,
    exchangeCodeForToken
};

