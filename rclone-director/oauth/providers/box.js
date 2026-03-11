/**
 * Box OAuth Provider
 * 
 * Implements Box-specific OAuth flow
 * Based on Rclone's box.go implementation
 */

const BaseProvider = require('./base');
const utils = require('../utils');
const axios = require('axios');

class BoxProvider extends BaseProvider {
    constructor() {
        super('box');
    }
    
    /**
     * Get authorization URL for Box OAuth
     * Box doesn't require scopes in the OAuth URL
     * 
     * @param {string} redirectUri - Callback redirect URI
     * @param {string} state - OAuth state parameter
     * @param {Object} options - Additional options (clientId override)
     * @returns {string} Authorization URL
     */
    getAuthURL(redirectUri, state, options = {}) {
        const clientId = options.clientId || this.config.clientId;
        return utils.buildAuthURL(this.config, redirectUri, state, clientId);
    }
    
    /**
     * Exchange authorization code for Box access token
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
     * Format Box token for Rclone config
     * Box returns standard OAuth2 token format
     * 
     * @param {Object} tokenResponse - Token response from Box
     * @returns {string} JSON string formatted for Rclone
     */
    formatTokenForRclone(tokenResponse) {
        return super.formatTokenForRclone(tokenResponse);
    }
    
    /**
     * Refresh Box access token using refresh token
     * 
     * @param {string} refreshToken - OAuth refresh token
     * @param {string} clientId - OAuth client ID
     * @param {string} clientSecret - OAuth client secret
     * @returns {Promise<Object>} New token response
     */
    async refreshToken(refreshToken, clientId, clientSecret) {
        // Box uses standard OAuth2 refresh token flow
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
            console.error('[Box] Error refreshing token:', error.response?.data || error.message);
            throw new Error(`Failed to refresh Box token: ${error.response?.data?.error_description || error.message}`);
        }
    }
    
    /**
     * Get Box account information
     * 
     * Uses Box API v2 to get current user info
     * Automatically refreshes token if expired
     * 
     * @param {string} accessToken - OAuth access token
     * @param {string} refreshToken - OAuth refresh token (optional, for auto-refresh)
     * @param {Object} options - Additional options (clientId, clientSecret for refresh, remoteName, server, password, axiosInstance for config update)
     * @returns {Promise<Object>} Account info with email and name, or { accountInfo, newToken } if refresh occurred
     */
    async getAccountInfo(accessToken, refreshToken = null, options = {}) {
        try {
            console.log(`[Box] Fetching account info from ${this.config.accountInfoURL}`);
            const response = await axios.get(
                this.config.accountInfoURL,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );
            
            console.log(`[Box] Account info response:`, {
                status: response.status,
                hasData: !!response.data,
                dataKeys: response.data ? Object.keys(response.data) : [],
                login: response.data?.login,
                name: response.data?.name
            });
            
            if (!response.data || !response.data.login) {
                console.error('[Box] Response data:', JSON.stringify(response.data, null, 2));
                throw new Error('Invalid response format: missing login');
            }
            
            return {
                email: response.data.login,
                name: response.data.name || response.data.login
            };
        } catch (error) {
            // Check if token expired and we have refresh token
            if (error.response?.status === 401 && refreshToken && options.clientId && options.clientSecret) {
                console.log('[Box] Access token expired, refreshing...');
                try {
                    const newToken = await this.refreshToken(refreshToken, options.clientId, options.clientSecret);
                    
                    // Retry with new token
                    const retryResponse = await axios.get(
                        this.config.accountInfoURL,
                        {
                            headers: {
                                'Authorization': `Bearer ${newToken.access_token}`,
                                'Content-Type': 'application/json'
                            },
                            timeout: 10000
                        }
                    );
                    
                    console.log(`[Box] Retry account info response:`, {
                        status: retryResponse.status,
                        hasData: !!retryResponse.data
                    });
                    
                    if (!retryResponse.data || !retryResponse.data.login) {
                        console.error('[Box] Retry response data:', JSON.stringify(retryResponse.data, null, 2));
                        throw new Error('Invalid response format: missing login');
                    }
                    
                    const accountInfo = {
                        email: retryResponse.data.login,
                        name: retryResponse.data.name || retryResponse.data.login
                    };
                    
                    // Return both account info and new token so caller can update config
                    return {
                        accountInfo: accountInfo,
                        newToken: newToken
                    };
                } catch (refreshError) {
                    console.error('[Box] Error refreshing token:', refreshError.response?.data || refreshError.message);
                    throw new Error(`Failed to refresh expired token: ${refreshError.response?.data?.error_description || refreshError.message}`);
                }
            }
            
            console.error('[Box] Error fetching account info:', error.response?.data || error.message);
            throw new Error(`Failed to get Box account info: ${error.response?.data?.error_description || error.message}`);
        }
    }
}

module.exports = BoxProvider;

