/**
 * Mail.ru Cloud OAuth Provider
 * 
 * Implements Mail.ru Cloud-specific OAuth flow
 * Based on Rclone's mailru.go implementation
 * 
 * Note: Mail.ru has an unusual OAuth flow:
 * - Uses AuthStyleInParams (client_id and token in request body, not Basic Auth)
 * - Same URL for auth and token exchange (https://o2.mail.ru/token)
 * - Requires username/password for initial auth, then OAuth token for API calls
 */

const BaseProvider = require('./base');
const axios = require('axios');

class MailruProvider extends BaseProvider {
    constructor() {
        super('mailru');
    }
    
    /**
     * Get authorization URL for Mail.ru OAuth
     * 
     * Note: Mail.ru's OAuth flow is unusual - it uses the token endpoint for authorization
     * The actual auth happens via username/password, then OAuth token is obtained
     * 
     * @param {string} redirectUri - Callback redirect URI (not used for Mail.ru)
     * @param {string} state - OAuth state parameter
     * @param {Object} options - Additional options (clientId override, username, password)
     * @returns {string} Authorization URL
     */
    getAuthURL(redirectUri, state, options = {}) {
        // Mail.ru doesn't use standard OAuth authorization URL
        // Instead, it uses username/password to get token
        // For our web-based flow, we'll need to handle this differently
        // For now, return the token URL as auth URL (unusual but matches Mail.ru's flow)
        const clientId = options.clientId || this.config.clientId;
        const params = new URLSearchParams();
        params.append('client_id', clientId);
        params.append('response_type', 'token'); // Mail.ru uses implicit flow
        if (state) {
            params.append('state', state);
        }
        
        return `${this.config.authURL}?${params.toString()}`;
    }
    
    /**
     * Exchange authorization code for Mail.ru access token
     * 
     * Note: Mail.ru uses username/password authentication, not authorization code flow
     * This method may not be used in the standard OAuth flow
     * 
     * @param {string} code - Authorization code from callback (or username/password token)
     * @param {string} redirectUri - Callback redirect URI
     * @param {Object} options - Additional options (username, password)
     * @returns {Promise<Object>} Token response
     */
    async exchangeToken(code, redirectUri, options = {}) {
        // Mail.ru uses username/password to get token, not authorization code
        // This is handled differently - see Mail.ru's API documentation
        const clientId = options.clientId || this.config.clientId;
        const username = options.username;
        const password = options.password;
        
        if (!username || !password) {
            throw new Error('Mail.ru requires username and password for authentication');
        }
        
        // Mail.ru uses AuthStyleInParams - client_id in request body
        const params = new URLSearchParams();
        params.append('grant_type', 'password');
        params.append('username', username);
        params.append('password', password);
        params.append('client_id', clientId);
        
        try {
            const response = await axios.post(
                this.config.tokenURL,
                params.toString(),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': 'rclone-director/1.0'
                    },
                    timeout: 10000
                }
            );
            
            return response.data;
        } catch (error) {
            console.error('[Mail.ru] Error exchanging token:', error.response?.data || error.message);
            throw new Error(`Failed to get Mail.ru token: ${error.response?.data?.error_description || error.message}`);
        }
    }
    
    /**
     * Format Mail.ru token for Rclone config
     * Mail.ru returns standard OAuth2 token format
     * 
     * @param {Object} tokenResponse - Token response from Mail.ru
     * @returns {string} JSON string formatted for Rclone
     */
    formatTokenForRclone(tokenResponse) {
        return super.formatTokenForRclone(tokenResponse);
    }
    
    /**
     * Refresh Mail.ru access token using refresh token
     * 
     * @param {string} refreshToken - OAuth refresh token
     * @param {string} clientId - OAuth client ID
     * @param {string} clientSecret - OAuth client secret (not used for Mail.ru)
     * @returns {Promise<Object>} New token response
     */
    async refreshToken(refreshToken, clientId, clientSecret) {
        const params = new URLSearchParams();
        params.append('grant_type', 'refresh_token');
        params.append('refresh_token', refreshToken);
        params.append('client_id', clientId);
        
        try {
            const response = await axios.post(
                this.config.tokenURL,
                params.toString(),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': 'rclone-director/1.0'
                    },
                    timeout: 10000
                }
            );
            
            return response.data;
        } catch (error) {
            console.error('[Mail.ru] Error refreshing token:', error.response?.data || error.message);
            throw new Error(`Failed to refresh Mail.ru token: ${error.response?.data?.error_description || error.message}`);
        }
    }
    
    /**
     * Get Mail.ru account information
     * 
     * Uses Mail.ru API to get user info
     * 
     * @param {string} accessToken - OAuth access token
     * @param {string} refreshToken - OAuth refresh token (optional, for auto-refresh)
     * @param {Object} options - Additional options (clientId for refresh, remoteName, server, password, axiosInstance for config update)
     * @returns {Promise<Object>} Account info with email and name
     */
    async getAccountInfo(accessToken, refreshToken = null, options = {}) {
        try {
            // Mail.ru API endpoint for user info
            // Note: Mail.ru API requires client_id in request body (AuthStyleInParams)
            const response = await axios.post(
                'https://cloud.mail.ru/api/v2/user',
                {
                    client_id: options.clientId || this.config.clientId,
                    token: accessToken
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'rclone-director/1.0'
                    },
                    timeout: 10000
                }
            );
            
            // Mail.ru returns: { body: { email, name, ... }, ... }
            const body = response.data.body || response.data;
            const email = body.email || body.login;
            const name = body.name || body.display_name || body.login || email;
            
            return {
                email: email,
                name: name,
                account_id: body.account_id || body.login
            };
        } catch (error) {
            // Check if token expired and we have refresh token
            if (error.response?.status === 401 && refreshToken && options.clientId) {
                console.log('[Mail.ru] Access token expired, refreshing...');
                try {
                    const newToken = await this.refreshToken(refreshToken, options.clientId, '');
                    
                    // Retry with new token
                    const retryResponse = await axios.post(
                        'https://cloud.mail.ru/api/v2/user',
                        {
                            client_id: options.clientId || this.config.clientId,
                            token: newToken.access_token
                        },
                        {
                            headers: {
                                'Content-Type': 'application/json',
                                'User-Agent': 'rclone-director/1.0'
                            },
                            timeout: 10000
                        }
                    );
                    
                    const body = retryResponse.data.body || retryResponse.data;
                    const email = body.email || body.login;
                    const name = body.name || body.display_name || body.login || email;
                    
                    const accountInfo = {
                        email: email,
                        name: name,
                        account_id: body.account_id || body.login
                    };
                    
                    // Return both account info and new token so caller can update config
                    return {
                        accountInfo: accountInfo,
                        newToken: newToken
                    };
                } catch (refreshError) {
                    console.error('[Mail.ru] Error refreshing token:', refreshError.response?.data || refreshError.message);
                    throw new Error(`Failed to refresh expired token: ${refreshError.response?.data?.error_description || refreshError.message}`);
                }
            }
            
            console.error('[Mail.ru] Error fetching account info:', error.response?.data || error.message);
            throw new Error(`Failed to get Mail.ru account info: ${error.response?.data?.error_description || error.message}`);
        }
    }
}

module.exports = MailruProvider;

