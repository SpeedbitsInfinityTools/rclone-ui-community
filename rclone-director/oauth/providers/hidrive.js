/**
 * HiDrive OAuth Provider
 * 
 * Implements HiDrive-specific OAuth flow
 * Based on Rclone's hidrive.go implementation
 * 
 * Note: HiDrive uses TitleBarRedirectURL (urn:ietf:wg:oauth:2.0:oob) in Rclone
 * This means the auth code appears in the browser title bar and must be manually copied
 * For our web-based flow, we'll use standard redirect URL instead
 */

const BaseProvider = require('./base');
const axios = require('axios');

class HiDriveProvider extends BaseProvider {
    constructor() {
        super('hidrive');
    }
    
    /**
     * Get authorization URL for HiDrive OAuth
     * 
     * @param {string} redirectUri - Callback redirect URI
     * @param {string} state - OAuth state parameter
     * @param {Object} options - Additional options (clientId override, scopeRole, scopeAccess)
     * @returns {string} Authorization URL
     */
    getAuthURL(redirectUri, state, options = {}) {
        // HiDrive scopes are dynamically generated based on scope_role and scope_access
        // Default: scope_role=user, scope_access=rw
        const scopeRole = options.scopeRole || 'user';
        const scopeAccess = options.scopeAccess || 'rw';
        
        // Build scope string: e.g., "user rw"
        const scopes = [scopeRole, scopeAccess];
        
        // Temporarily override scopes for this request
        const originalScopes = this.config.scopes;
        this.config.scopes = scopes;
        
        try {
            return super.getAuthURL(redirectUri, state, options);
        } finally {
            // Restore original scopes
            this.config.scopes = originalScopes;
        }
    }
    
    /**
     * Exchange authorization code for HiDrive access token
     * 
     * @param {string} code - Authorization code from callback
     * @param {string} redirectUri - Callback redirect URI
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Token response
     */
    async exchangeToken(code, redirectUri, options = {}) {
        return await super.exchangeToken(code, redirectUri, options);
    }
    
    /**
     * Format HiDrive token for Rclone config
     * HiDrive returns standard OAuth2 token format
     * 
     * @param {Object} tokenResponse - Token response from HiDrive
     * @returns {string} JSON string formatted for Rclone
     */
    formatTokenForRclone(tokenResponse) {
        return super.formatTokenForRclone(tokenResponse);
    }
    
    /**
     * Refresh HiDrive access token using refresh token
     * 
     * @param {string} refreshToken - OAuth refresh token
     * @param {string} clientId - OAuth client ID
     * @param {string} clientSecret - OAuth client secret
     * @returns {Promise<Object>} New token response
     */
    async refreshToken(refreshToken, clientId, clientSecret) {
        const params = new URLSearchParams();
        params.append('grant_type', 'refresh_token');
        params.append('refresh_token', refreshToken);
        params.append('client_id', clientId);
        params.append('client_secret', clientSecret);
        
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
            console.error('[HiDrive] Error refreshing token:', error.response?.data || error.message);
            throw new Error(`Failed to refresh HiDrive token: ${error.response?.data?.error_description || error.message}`);
        }
    }
    
    /**
     * Get HiDrive account information
     * 
     * Uses HiDrive API to get user info
     * 
     * @param {string} accessToken - OAuth access token
     * @param {string} refreshToken - OAuth refresh token (optional, for auto-refresh)
     * @param {Object} options - Additional options (clientId, clientSecret for refresh, remoteName, server, password, axiosInstance for config update)
     * @returns {Promise<Object>} Account info with email and name
     */
    async getAccountInfo(accessToken, refreshToken = null, options = {}) {
        try {
            // HiDrive API endpoint for user info
            // Default endpoint: https://api.hidrive.strato.com/2.1
            const endpoint = options.endpoint || 'https://api.hidrive.strato.com/2.1';
            const response = await axios.get(
                `${endpoint}/account`,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );
            
            // HiDrive returns: { account: { email, display_name, ... }, ... }
            const account = response.data.account || response.data;
            const email = account.email || account.username;
            const name = account.display_name || account.name || account.username || email;
            
            return {
                email: email,
                name: name,
                account_id: account.id || account.username
            };
        } catch (error) {
            // Check if token expired and we have refresh token
            if (error.response?.status === 401 && refreshToken && options.clientId && options.clientSecret) {
                console.log('[HiDrive] Access token expired, refreshing...');
                try {
                    const newToken = await this.refreshToken(refreshToken, options.clientId, options.clientSecret);
                    
                    // Retry with new token
                    const endpoint = options.endpoint || 'https://api.hidrive.strato.com/2.1';
                    const retryResponse = await axios.get(
                        `${endpoint}/account`,
                        {
                            headers: {
                                'Authorization': `Bearer ${newToken.access_token}`,
                                'Content-Type': 'application/json'
                            },
                            timeout: 10000
                        }
                    );
                    
                    const account = retryResponse.data.account || retryResponse.data;
                    const email = account.email || account.username;
                    const name = account.display_name || account.name || account.username || email;
                    
                    const accountInfo = {
                        email: email,
                        name: name,
                        account_id: account.id || account.username
                    };
                    
                    // Return both account info and new token so caller can update config
                    return {
                        accountInfo: accountInfo,
                        newToken: newToken
                    };
                } catch (refreshError) {
                    console.error('[HiDrive] Error refreshing token:', refreshError.response?.data || refreshError.message);
                    throw new Error(`Failed to refresh expired token: ${refreshError.response?.data?.error_description || refreshError.message}`);
                }
            }
            
            console.error('[HiDrive] Error fetching account info:', error.response?.data || error.message);
            throw new Error(`Failed to get HiDrive account info: ${error.response?.data?.error_description || error.message}`);
        }
    }
}

module.exports = HiDriveProvider;

