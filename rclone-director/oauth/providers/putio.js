/**
 * Put.io OAuth Provider
 * 
 * Implements Put.io-specific OAuth flow
 * Based on Rclone's putio.go implementation
 * 
 * Note: Put.io uses NoOffline (no refresh token)
 */

const BaseProvider = require('./base');
const axios = require('axios');

class PutioProvider extends BaseProvider {
    constructor() {
        super('putio');
    }
    
    /**
     * Get authorization URL for Put.io OAuth
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
     * Exchange authorization code for Put.io access token
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
     * Format Put.io token for Rclone config
     * Put.io returns standard OAuth2 token format
     * 
     * @param {Object} tokenResponse - Token response from Put.io
     * @returns {string} JSON string formatted for Rclone
     */
    formatTokenForRclone(tokenResponse) {
        return super.formatTokenForRclone(tokenResponse);
    }
    
    /**
     * Refresh Put.io access token using refresh token
     * 
     * Note: Put.io doesn't provide refresh tokens (NoOffline: true)
     * This method should not be called for Put.io
     * 
     * @param {string} refreshToken - OAuth refresh token (not available for Put.io)
     * @param {string} clientId - OAuth client ID
     * @param {string} clientSecret - OAuth client secret
     * @returns {Promise<Object>} New token response
     */
    async refreshToken(refreshToken, clientId, clientSecret) {
        throw new Error('Put.io does not support token refresh (NoOffline: true)');
    }
    
    /**
     * Get Put.io account information
     * 
     * Uses Put.io API to get user info
     * 
     * @param {string} accessToken - OAuth access token
     * @param {string} refreshToken - OAuth refresh token (not available for Put.io)
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Account info with email and name
     */
    async getAccountInfo(accessToken, refreshToken = null, options = {}) {
        try {
            // Put.io API endpoint for account info
            const response = await axios.get(
                'https://api.put.io/v2/account/info',
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );
            
            // Put.io returns: { username, email, ... }
            const email = response.data.email || response.data.username;
            const name = response.data.username || email;
            
            return {
                email: email,
                name: name,
                account_id: response.data.user_id?.toString() || response.data.username
            };
        } catch (error) {
            // Put.io doesn't support refresh tokens, so we can't refresh on 401
            console.error('[Put.io] Error fetching account info:', error.response?.data || error.message);
            throw new Error(`Failed to get Put.io account info: ${error.response?.data?.error_description || error.message}`);
        }
    }
}

module.exports = PutioProvider;

