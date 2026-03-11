/**
 * Google Photos OAuth Provider
 * 
 * Implements Google Photos-specific OAuth flow
 * Based on Rclone's googlephotos.go implementation
 */

const BaseProvider = require('./base');
const axios = require('axios');

class GPhotosProvider extends BaseProvider {
    constructor() {
        super('gphotos');
    }
    
    /**
     * Get authorization URL for Google Photos OAuth
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
     * Exchange authorization code for Google Photos access token
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
     * Format Google Photos token for Rclone config
     * Google Photos returns standard OAuth2 token format
     * 
     * @param {Object} tokenResponse - Token response from Google Photos
     * @returns {string} JSON string formatted for Rclone
     */
    formatTokenForRclone(tokenResponse) {
        return super.formatTokenForRclone(tokenResponse);
    }
    
    /**
     * Refresh Google Photos access token using refresh token
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
            console.error('[Google Photos] Error refreshing token:', error.response?.data || error.message);
            throw new Error(`Failed to refresh Google Photos token: ${error.response?.data?.error_description || error.message}`);
        }
    }
    
    /**
     * Get Google Photos account information
     * 
     * Uses Google OAuth userinfo endpoint
     * 
     * @param {string} accessToken - OAuth access token
     * @param {string} refreshToken - OAuth refresh token (optional, for auto-refresh)
     * @param {Object} options - Additional options (clientId, clientSecret for refresh, remoteName, server, password, axiosInstance for config update)
     * @returns {Promise<Object>} Account info with email and name
     */
    async getAccountInfo(accessToken, refreshToken = null, options = {}) {
        try {
            // Google OAuth userinfo endpoint
            const response = await axios.get(
                'https://www.googleapis.com/oauth2/v2/userinfo',
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );
            
            return {
                email: response.data.email,
                name: response.data.name || response.data.email,
                account_id: response.data.id
            };
        } catch (error) {
            // Check if token expired and we have refresh token
            if (error.response?.status === 401 && refreshToken && options.clientId && options.clientSecret) {
                console.log('[Google Photos] Access token expired, refreshing...');
                try {
                    const newToken = await this.refreshToken(refreshToken, options.clientId, options.clientSecret);
                    
                    // Retry with new token
                    const retryResponse = await axios.get(
                        'https://www.googleapis.com/oauth2/v2/userinfo',
                        {
                            headers: {
                                'Authorization': `Bearer ${newToken.access_token}`,
                                'Content-Type': 'application/json'
                            },
                            timeout: 10000
                        }
                    );
                    
                    const accountInfo = {
                        email: retryResponse.data.email,
                        name: retryResponse.data.name || retryResponse.data.email,
                        account_id: retryResponse.data.id
                    };
                    
                    // Return both account info and new token so caller can update config
                    return {
                        accountInfo: accountInfo,
                        newToken: newToken
                    };
                } catch (refreshError) {
                    console.error('[Google Photos] Error refreshing token:', refreshError.response?.data || refreshError.message);
                    throw new Error(`Failed to refresh expired token: ${refreshError.response?.data?.error_description || refreshError.message}`);
                }
            }
            
            console.error('[Google Photos] Error fetching account info:', error.response?.data || error.message);
            throw new Error(`Failed to get Google Photos account info: ${error.response?.data?.error_description || error.message}`);
        }
    }
}

module.exports = GPhotosProvider;

