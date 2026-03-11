/**
 * Yandex Disk OAuth Provider
 * 
 * Implements Yandex Disk-specific OAuth flow
 * Based on Rclone's yandex.go implementation
 */

const BaseProvider = require('./base');
const axios = require('axios');

class YandexProvider extends BaseProvider {
    constructor() {
        super('yandex');
    }
    
    /**
     * Get authorization URL for Yandex Disk OAuth
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
     * Exchange authorization code for Yandex Disk access token
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
     * Format Yandex Disk token for Rclone config
     * Yandex returns standard OAuth2 token format
     * 
     * @param {Object} tokenResponse - Token response from Yandex
     * @returns {string} JSON string formatted for Rclone
     */
    formatTokenForRclone(tokenResponse) {
        return super.formatTokenForRclone(tokenResponse);
    }
    
    /**
     * Refresh Yandex Disk access token using refresh token
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
            console.error('[Yandex] Error refreshing token:', error.response?.data || error.message);
            throw new Error(`Failed to refresh Yandex token: ${error.response?.data?.error_description || error.message}`);
        }
    }
    
    /**
     * Get Yandex Disk account information
     * 
     * Uses Yandex Passport API to get user info
     * 
     * @param {string} accessToken - OAuth access token
     * @param {string} refreshToken - OAuth refresh token (optional, for auto-refresh)
     * @param {Object} options - Additional options (clientId, clientSecret for refresh, remoteName, server, password, axiosInstance for config update)
     * @returns {Promise<Object>} Account info with email and name
     */
    async getAccountInfo(accessToken, refreshToken = null, options = {}) {
        try {
            // Yandex Passport API endpoint for user info
            const response = await axios.get(
                'https://login.yandex.ru/info',
                {
                    headers: {
                        'Authorization': `OAuth ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );
            
            // Yandex returns: { id, login, first_name, last_name, display_name, emails, ... }
            const email = response.data.default_email || (response.data.emails && response.data.emails[0]) || response.data.login;
            const name = response.data.display_name || 
                        (response.data.first_name && response.data.last_name ? `${response.data.first_name} ${response.data.last_name}` : null) ||
                        response.data.first_name ||
                        response.data.login ||
                        email;
            
            return {
                email: email,
                name: name,
                account_id: response.data.id
            };
        } catch (error) {
            // Check if token expired and we have refresh token
            if (error.response?.status === 401 && refreshToken && options.clientId && options.clientSecret) {
                console.log('[Yandex] Access token expired, refreshing...');
                try {
                    const newToken = await this.refreshToken(refreshToken, options.clientId, options.clientSecret);
                    
                    // Retry with new token
                    const retryResponse = await axios.get(
                        'https://login.yandex.ru/info',
                        {
                            headers: {
                                'Authorization': `OAuth ${newToken.access_token}`,
                                'Content-Type': 'application/json'
                            },
                            timeout: 10000
                        }
                    );
                    
                    const email = retryResponse.data.default_email || (retryResponse.data.emails && retryResponse.data.emails[0]) || retryResponse.data.login;
                    const name = retryResponse.data.display_name || 
                                (retryResponse.data.first_name && retryResponse.data.last_name ? `${retryResponse.data.first_name} ${retryResponse.data.last_name}` : null) ||
                                retryResponse.data.first_name ||
                                retryResponse.data.login ||
                                email;
                    
                    const accountInfo = {
                        email: email,
                        name: name,
                        account_id: retryResponse.data.id
                    };
                    
                    // Return both account info and new token so caller can update config
                    return {
                        accountInfo: accountInfo,
                        newToken: newToken
                    };
                } catch (refreshError) {
                    console.error('[Yandex] Error refreshing token:', refreshError.response?.data || refreshError.message);
                    throw new Error(`Failed to refresh expired token: ${refreshError.response?.data?.error_description || refreshError.message}`);
                }
            }
            
            console.error('[Yandex] Error fetching account info:', error.response?.data || error.message);
            throw new Error(`Failed to get Yandex account info: ${error.response?.data?.error_description || error.message}`);
        }
    }
}

module.exports = YandexProvider;

