/**
 * premiumize.me OAuth Provider
 * 
 * Implements premiumize.me-specific OAuth flow
 * Based on Rclone's premiumizeme.go implementation
 */

const BaseProvider = require('./base');
const axios = require('axios');

class PremiumizemeProvider extends BaseProvider {
    constructor() {
        super('premiumizeme');
    }
    
    /**
     * Get authorization URL for premiumize.me OAuth
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
     * Exchange authorization code for premiumize.me access token
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
     * Format premiumize.me token for Rclone config
     * premiumize.me returns standard OAuth2 token format
     * 
     * @param {Object} tokenResponse - Token response from premiumize.me
     * @returns {string} JSON string formatted for Rclone
     */
    formatTokenForRclone(tokenResponse) {
        return super.formatTokenForRclone(tokenResponse);
    }
    
    /**
     * Refresh premiumize.me access token using refresh token
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
            console.error('[premiumize.me] Error refreshing token:', error.response?.data || error.message);
            throw new Error(`Failed to refresh premiumize.me token: ${error.response?.data?.error_description || error.message}`);
        }
    }
    
    /**
     * Get premiumize.me account information
     * 
     * Uses premiumize.me API to get user info
     * 
     * @param {string} accessToken - OAuth access token
     * @param {string} refreshToken - OAuth refresh token (optional, for auto-refresh)
     * @param {Object} options - Additional options (clientId, clientSecret for refresh, remoteName, server, password, axiosInstance for config update)
     * @returns {Promise<Object>} Account info with email and name
     */
    async getAccountInfo(accessToken, refreshToken = null, options = {}) {
        try {
            // premiumize.me API endpoint for account info
            const response = await axios.get(
                'https://www.premiumize.me/api/account/info',
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );
            
            // premiumize.me returns: { customer_id, email, ... }
            const email = response.data.email || response.data.customer_id;
            const name = response.data.name || email;
            
            return {
                email: email,
                name: name,
                account_id: response.data.customer_id
            };
        } catch (error) {
            // Check if token expired and we have refresh token
            if (error.response?.status === 401 && refreshToken && options.clientId && options.clientSecret) {
                console.log('[premiumize.me] Access token expired, refreshing...');
                try {
                    const newToken = await this.refreshToken(refreshToken, options.clientId, options.clientSecret);
                    
                    // Retry with new token
                    const retryResponse = await axios.get(
                        'https://www.premiumize.me/api/account/info',
                        {
                            headers: {
                                'Authorization': `Bearer ${newToken.access_token}`,
                                'Content-Type': 'application/json'
                            },
                            timeout: 10000
                        }
                    );
                    
                    const email = retryResponse.data.email || retryResponse.data.customer_id;
                    const name = retryResponse.data.name || email;
                    
                    const accountInfo = {
                        email: email,
                        name: name,
                        account_id: retryResponse.data.customer_id
                    };
                    
                    // Return both account info and new token so caller can update config
                    return {
                        accountInfo: accountInfo,
                        newToken: newToken
                    };
                } catch (refreshError) {
                    console.error('[premiumize.me] Error refreshing token:', refreshError.response?.data || refreshError.message);
                    throw new Error(`Failed to refresh expired token: ${refreshError.response?.data?.error_description || refreshError.message}`);
                }
            }
            
            console.error('[premiumize.me] Error fetching account info:', error.response?.data || error.message);
            throw new Error(`Failed to get premiumize.me account info: ${error.response?.data?.error_description || error.message}`);
        }
    }
}

module.exports = PremiumizemeProvider;

