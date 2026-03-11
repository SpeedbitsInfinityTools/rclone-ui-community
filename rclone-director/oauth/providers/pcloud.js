/**
 * pCloud OAuth Provider
 * 
 * Implements pCloud-specific OAuth flow
 * Based on Rclone's pcloud.go implementation
 */

const BaseProvider = require('./base');
const utils = require('../utils');
const axios = require('axios');

class PCloudProvider extends BaseProvider {
    constructor() {
        super('pcloud');
    }
    
    /**
     * Get authorization URL for pCloud OAuth
     * pCloud doesn't require scopes in the OAuth URL
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
     * Exchange authorization code for pCloud access token
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
     * Format pCloud token for Rclone config
     * pCloud returns standard OAuth2 token format
     * 
     * @param {Object} tokenResponse - Token response from pCloud
     * @returns {string} JSON string formatted for Rclone
     */
    formatTokenForRclone(tokenResponse) {
        return super.formatTokenForRclone(tokenResponse);
    }
    
    /**
     * Refresh pCloud access token using refresh token
     * 
     * @param {string} refreshToken - OAuth refresh token
     * @param {string} clientId - OAuth client ID
     * @param {string} clientSecret - OAuth client secret
     * @returns {Promise<Object>} New token response
     */
    async refreshToken(refreshToken, clientId, clientSecret) {
        // pCloud uses standard OAuth2 refresh token flow
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
            console.error('[pCloud] Error refreshing token:', error.response?.data || error.message);
            throw new Error(`Failed to refresh pCloud token: ${error.response?.data?.error_description || error.message}`);
        }
    }
    
    /**
     * Get pCloud account information
     * 
     * Uses pCloud API to get current user info
     * Automatically refreshes token if expired
     * 
     * @param {string} accessToken - OAuth access token
     * @param {string} refreshToken - OAuth refresh token (optional, for auto-refresh)
     * @param {Object} options - Additional options (clientId, clientSecret for refresh, remoteName, server, password, axiosInstance for config update)
     * @returns {Promise<Object>} Account info with email and name, or { accountInfo, newToken } if refresh occurred
     */
    async getAccountInfo(accessToken, refreshToken = null, options = {}) {
        try {
            // pCloud API uses POST for /userinfo endpoint (as per Rclone Go code)
            console.log(`[pCloud] Fetching account info from ${this.config.accountInfoURL}`);
            const response = await axios.post(
                this.config.accountInfoURL,
                null, // POST body is empty
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );
            
            console.log(`[pCloud] Account info response:`, {
                status: response.status,
                hasData: !!response.data,
                dataKeys: response.data ? Object.keys(response.data) : [],
                email: response.data?.email,
                userid: response.data?.userid
            });
            
            // pCloud API returns userinfo directly in response.data
            // Check for pCloud error structure first
            if (response.data && response.data.error) {
                throw new Error(`pCloud API error: ${response.data.error}`);
            }
            
            if (!response.data || !response.data.email) {
                console.error('[pCloud] Response data:', JSON.stringify(response.data, null, 2));
                throw new Error('Invalid response format: missing email');
            }
            
            return {
                email: response.data.email,
                name: response.data.email || (response.data.userid ? response.data.userid.toString() : 'Unknown')
            };
        } catch (error) {
            // Check if token expired and we have refresh token
            if (error.response?.status === 401 && refreshToken && options.clientId && options.clientSecret) {
                console.log('[pCloud] Access token expired, refreshing...');
                try {
                    const newToken = await this.refreshToken(refreshToken, options.clientId, options.clientSecret);
                    
                    // Retry with new token (pCloud uses POST)
                    const retryResponse = await axios.post(
                        this.config.accountInfoURL,
                        null,
                        {
                            headers: {
                                'Authorization': `Bearer ${newToken.access_token}`,
                                'Content-Type': 'application/json'
                            },
                            timeout: 10000
                        }
                    );
                    
                    console.log(`[pCloud] Retry account info response:`, {
                        status: retryResponse.status,
                        hasData: !!retryResponse.data
                    });
                    
                    if (retryResponse.data && retryResponse.data.error) {
                        throw new Error(`pCloud API error: ${retryResponse.data.error}`);
                    }
                    
                    if (!retryResponse.data || !retryResponse.data.email) {
                        console.error('[pCloud] Retry response data:', JSON.stringify(retryResponse.data, null, 2));
                        throw new Error('Invalid response format: missing email');
                    }
                    
                    const accountInfo = {
                        email: retryResponse.data.email,
                        name: retryResponse.data.email || (retryResponse.data.userid ? retryResponse.data.userid.toString() : 'Unknown')
                    };
                    
                    // Return both account info and new token so caller can update config
                    return {
                        accountInfo: accountInfo,
                        newToken: newToken
                    };
                } catch (refreshError) {
                    console.error('[pCloud] Error refreshing token:', refreshError.response?.data || refreshError.message);
                    throw new Error(`Failed to refresh expired token: ${refreshError.response?.data?.error_description || refreshError.message}`);
                }
            }
            
            console.error('[pCloud] Error fetching account info:', error.response?.data || error.message);
            throw new Error(`Failed to get pCloud account info: ${error.response?.data?.error_description || error.message}`);
        }
    }
}

module.exports = PCloudProvider;

