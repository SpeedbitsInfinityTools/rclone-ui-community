/**
 * Jottacloud OAuth Provider
 * 
 * Implements Jottacloud-specific OAuth flow
 * Based on Rclone's jottacloud.go implementation
 * 
 * Note: Jottacloud uses OpenID Connect and supports multiple services
 * Default service is Jottacloud main service
 */

const BaseProvider = require('./base');
const axios = require('axios');

class JottacloudProvider extends BaseProvider {
    constructor() {
        super('jottacloud');
    }
    
    /**
     * Get authorization URL for Jottacloud OAuth
     * 
     * @param {string} redirectUri - Callback redirect URI
     * @param {string} state - OAuth state parameter
     * @param {Object} options - Additional options (clientId override)
     * @returns {string} Authorization URL
     */
    getAuthURL(redirectUri, state, options = {}) {
        return super.getAuthURL(redirectUri, state, options);
    }
    
    /**
     * Exchange authorization code for Jottacloud access token
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
     * Format Jottacloud token for Rclone config
     * Jottacloud returns standard OAuth2/OpenID Connect token format
     * 
     * @param {Object} tokenResponse - Token response from Jottacloud
     * @returns {string} JSON string formatted for Rclone
     */
    formatTokenForRclone(tokenResponse) {
        return super.formatTokenForRclone(tokenResponse);
    }
    
    /**
     * Refresh Jottacloud access token using refresh token
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
        if (clientSecret) {
            params.append('client_secret', clientSecret);
        }
        
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
            console.error('[Jottacloud] Error refreshing token:', error.response?.data || error.message);
            throw new Error(`Failed to refresh Jottacloud token: ${error.response?.data?.error_description || error.message}`);
        }
    }
    
    /**
     * Get Jottacloud account information
     * 
     * Uses Jottacloud API to get user info
     * 
     * @param {string} accessToken - OAuth access token
     * @param {string} refreshToken - OAuth refresh token (optional, for auto-refresh)
     * @param {Object} options - Additional options (clientId, clientSecret for refresh, remoteName, server, password, axiosInstance for config update)
     * @returns {Promise<Object>} Account info with email and name
     */
    async getAccountInfo(accessToken, refreshToken = null, options = {}) {
        try {
            // Jottacloud API endpoint for user info
            const response = await axios.get(
                'https://api.jottacloud.com/v1/users/me',
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );
            
            // Jottacloud returns: { username, email, ... }
            const email = response.data.email || response.data.username;
            const name = response.data.display_name || response.data.username || email;
            
            return {
                email: email,
                name: name,
                account_id: response.data.username
            };
        } catch (error) {
            // Check if token expired and we have refresh token
            if (error.response?.status === 401 && refreshToken && options.clientId) {
                console.log('[Jottacloud] Access token expired, refreshing...');
                try {
                    const newToken = await this.refreshToken(refreshToken, options.clientId, options.clientSecret || '');
                    
                    // Retry with new token
                    const retryResponse = await axios.get(
                        'https://api.jottacloud.com/v1/users/me',
                        {
                            headers: {
                                'Authorization': `Bearer ${newToken.access_token}`,
                                'Content-Type': 'application/json'
                            },
                            timeout: 10000
                        }
                    );
                    
                    const email = retryResponse.data.email || retryResponse.data.username;
                    const name = retryResponse.data.display_name || retryResponse.data.username || email;
                    
                    const accountInfo = {
                        email: email,
                        name: name,
                        account_id: retryResponse.data.username
                    };
                    
                    // Return both account info and new token so caller can update config
                    return {
                        accountInfo: accountInfo,
                        newToken: newToken
                    };
                } catch (refreshError) {
                    console.error('[Jottacloud] Error refreshing token:', refreshError.response?.data || refreshError.message);
                    throw new Error(`Failed to refresh expired token: ${refreshError.response?.data?.error_description || refreshError.message}`);
                }
            }
            
            console.error('[Jottacloud] Error fetching account info:', error.response?.data || error.message);
            throw new Error(`Failed to get Jottacloud account info: ${error.response?.data?.error_description || error.message}`);
        }
    }
}

module.exports = JottacloudProvider;

