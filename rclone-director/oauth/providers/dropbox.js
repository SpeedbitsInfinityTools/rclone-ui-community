/**
 * Dropbox OAuth Provider
 * 
 * Implements Dropbox-specific OAuth flow
 * Based on Rclone's dropbox.go implementation
 */

const BaseProvider = require('./base');
const utils = require('../utils');
const axios = require('axios');

class DropboxProvider extends BaseProvider {
    constructor() {
        super('dropbox');
    }
    
    /**
     * Get authorization URL for Dropbox OAuth
     * Dropbox requires token_access_type=offline parameter
     * 
     * @param {string} redirectUri - Callback redirect URI (may be Rclone's localhost:53682 or Director's endpoint)
     * @param {string} state - OAuth state parameter
     * @param {Object} options - Additional options (clientId override)
     * @returns {string} Authorization URL
     */
    getAuthURL(redirectUri, state, options = {}) {
        const clientId = options.clientId || this.config.clientId;
        
        // Use the provided redirectUri (which will be Rclone's localhost:53682 when using Rclone's client ID)
        // Dropbox always needs token_access_type=offline for refresh tokens
        // This is handled in config.js via additionalParams
        return utils.buildAuthURL(this.config, redirectUri, state, clientId);
    }
    
    /**
     * Exchange authorization code for Dropbox access token
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
     * Format Dropbox token for Rclone config
     * Dropbox returns standard OAuth2 token format
     * 
     * @param {Object} tokenResponse - Token response from Dropbox
     * @returns {string} JSON string formatted for Rclone
     */
    formatTokenForRclone(tokenResponse) {
        return super.formatTokenForRclone(tokenResponse);
    }
    
    /**
     * Refresh Dropbox access token using refresh token
     * 
     * @param {string} refreshToken - OAuth refresh token
     * @param {string} clientId - OAuth client ID
     * @param {string} clientSecret - OAuth client secret
     * @returns {Promise<Object>} New token response
     */
    async refreshToken(refreshToken, clientId, clientSecret) {
        // Dropbox uses form-encoded body (same as token exchange), not Basic Auth
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
            console.error('[Dropbox] Error refreshing token:', error.response?.data || error.message);
            throw new Error(`Failed to refresh Dropbox token: ${error.response?.data?.error_summary || error.message}`);
        }
    }
    
    /**
     * Get Dropbox account information
     * 
     * Uses Dropbox API v2 to get current account info
     * Automatically refreshes token if expired
     * 
     * @param {string} accessToken - OAuth access token
     * @param {string} refreshToken - OAuth refresh token (optional, for auto-refresh)
     * @param {Object} options - Additional options (clientId, clientSecret for refresh, remoteName, server, password, axiosInstance for config update)
     * @returns {Promise<Object>} Account info with email and name, or { accountInfo, newToken } if refresh occurred
     */
    async getAccountInfo(accessToken, refreshToken = null, options = {}) {
        try {
            const response = await axios.post(
                'https://api.dropboxapi.com/2/users/get_current_account',
                null,
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
                name: response.data.name?.display_name || response.data.name?.given_name || response.data.email,
                account_id: response.data.account_id
            };
        } catch (error) {
            // Check if token expired and we have refresh token
            if (error.response?.data?.error?.['.tag'] === 'expired_access_token' && refreshToken && options.clientId && options.clientSecret) {
                console.log('[Dropbox] Access token expired, refreshing...');
                try {
                    const newToken = await this.refreshToken(refreshToken, options.clientId, options.clientSecret);
                    
                    // Retry with new token
                    const retryResponse = await axios.post(
                        'https://api.dropboxapi.com/2/users/get_current_account',
                        null,
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
                        name: retryResponse.data.name?.display_name || retryResponse.data.name?.given_name || retryResponse.data.email,
                        account_id: retryResponse.data.account_id
                    };
                    
                    // Return both account info and new token so caller can update config
                    return {
                        accountInfo: accountInfo,
                        newToken: newToken
                    };
                } catch (refreshError) {
                    console.error('[Dropbox] Error refreshing token:', refreshError.response?.data || refreshError.message);
                    throw new Error(`Failed to refresh expired token: ${refreshError.response?.data?.error_summary || refreshError.message}`);
                }
            }
            
            console.error('[Dropbox] Error fetching account info:', error.response?.data || error.message);
            throw new Error(`Failed to get Dropbox account info: ${error.response?.data?.error_summary || error.message}`);
        }
    }
}

module.exports = DropboxProvider;

