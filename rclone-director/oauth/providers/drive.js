/**
 * Google Drive OAuth Provider
 * 
 * Implements Google Drive-specific OAuth flow
 * Based on Rclone's drive.go implementation
 */

const BaseProvider = require('./base');
const utils = require('../utils');
const axios = require('axios');

class DriveProvider extends BaseProvider {
    constructor() {
        super('drive');
    }
    
    /**
     * Get authorization URL for Google Drive OAuth
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
     * Exchange authorization code for Google Drive access token
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
     * Format Google Drive token for Rclone config
     * Google returns standard OAuth2 token format
     * 
     * @param {Object} tokenResponse - Token response from Google
     * @returns {string} JSON string formatted for Rclone
     */
    formatTokenForRclone(tokenResponse) {
        return super.formatTokenForRclone(tokenResponse);
    }
    
    /**
     * Refresh Google Drive access token using refresh token
     * 
     * @param {string} refreshToken - OAuth refresh token
     * @param {string} clientId - OAuth client ID
     * @param {string} clientSecret - OAuth client secret
     * @returns {Promise<Object>} New token response
     */
    async refreshToken(refreshToken, clientId, clientSecret) {
        // Google uses standard OAuth2 refresh token flow
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
            console.error('[Drive] Error refreshing token:', error.response?.data || error.message);
            throw new Error(`Failed to refresh Google Drive token: ${error.response?.data?.error || error.message}`);
        }
    }
    
    /**
     * Get Google Drive account information
     * 
     * Uses Google Drive API v3 about endpoint to get current user info
     * Automatically refreshes token if expired
     * 
     * @param {string} accessToken - OAuth access token
     * @param {string} refreshToken - OAuth refresh token (optional, for auto-refresh)
     * @param {Object} options - Additional options (clientId, clientSecret for refresh, remoteName, server, password, axiosInstance for config update)
     * @returns {Promise<Object>} Account info with email and name, or { accountInfo, newToken } if refresh occurred
     */
    async getAccountInfo(accessToken, refreshToken = null, options = {}) {
        try {
            // Google Drive API /about endpoint returns user info in response.data.user
            console.log(`[Drive] Fetching account info from ${this.config.accountInfoURL}`);
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
            
            console.log(`[Drive] Account info response:`, {
                status: response.status,
                hasData: !!response.data,
                hasUser: !!response.data?.user,
                userKeys: response.data?.user ? Object.keys(response.data.user) : []
            });
            
            // Google Drive API returns { user: { emailAddress, displayName, photoLink } }
            const user = response.data?.user;
            if (!user) {
                console.error('[Drive] Response data:', JSON.stringify(response.data, null, 2));
                throw new Error('Invalid response format: missing user object');
            }
            
            if (!user.emailAddress) {
                console.error('[Drive] User object:', JSON.stringify(user, null, 2));
                throw new Error('Invalid response format: missing emailAddress in user object');
            }
            
            return {
                email: user.emailAddress,
                name: user.displayName || user.emailAddress,
                photoLink: user.photoLink
            };
        } catch (error) {
            // Check if token expired and we have refresh token
            if (error.response?.status === 401 && refreshToken && options.clientId && options.clientSecret) {
                console.log('[Drive] Access token expired, refreshing...');
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
                    
                    console.log(`[Drive] Retry account info response:`, {
                        status: retryResponse.status,
                        hasUser: !!retryResponse.data?.user
                    });
                    
                    const user = retryResponse.data?.user;
                    if (!user) {
                        console.error('[Drive] Retry response data:', JSON.stringify(retryResponse.data, null, 2));
                        throw new Error('Invalid response format: missing user object');
                    }
                    
                    if (!user.emailAddress) {
                        console.error('[Drive] Retry user object:', JSON.stringify(user, null, 2));
                        throw new Error('Invalid response format: missing emailAddress in user object');
                    }
                    
                    const accountInfo = {
                        email: user.emailAddress,
                        name: user.displayName || user.emailAddress,
                        photoLink: user.photoLink
                    };
                    
                    // Return both account info and new token so caller can update config
                    return {
                        accountInfo: accountInfo,
                        newToken: newToken
                    };
                } catch (refreshError) {
                    console.error('[Drive] Error refreshing token:', refreshError.response?.data || refreshError.message);
                    throw new Error(`Failed to refresh expired token: ${refreshError.response?.data?.error || refreshError.message}`);
                }
            }
            
            console.error('[Drive] Error fetching account info:', error.response?.data || error.message);
            throw new Error(`Failed to get Google Drive account info: ${error.response?.data?.error?.message || error.message}`);
        }
    }
}

module.exports = DriveProvider;

