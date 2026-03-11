/**
 * PikPak OAuth Provider
 * 
 * Implements PikPak-specific OAuth flow
 * Based on Rclone's pikpak.go implementation
 * 
 * Note: PikPak uses username/password authentication, not standard authorization code flow
 * Similar to Mail.ru, but uses AuthStyleInParams
 */

const BaseProvider = require('./base');
const axios = require('axios');

class PikpakProvider extends BaseProvider {
    constructor() {
        super('pikpak');
    }
    
    /**
     * Get authorization URL for PikPak OAuth
     * 
     * Note: PikPak uses username/password authentication, not standard OAuth authorization URL
     * 
     * @param {string} redirectUri - Callback redirect URI (not used for PikPak)
     * @param {string} state - OAuth state parameter
     * @param {Object} options - Additional options (clientId override, username, password)
     * @returns {string} Authorization URL (returns signin URL for PikPak)
     */
    getAuthURL(redirectUri, state, options = {}) {
        // PikPak doesn't use standard OAuth authorization URL
        // It uses username/password to get token
        // Return the signin URL (which is the auth URL)
        return this.config.authURL;
    }
    
    /**
     * Exchange authorization code for PikPak access token
     * 
     * Note: PikPak uses username/password authentication, not authorization code flow
     * 
     * @param {string} code - Not used (PikPak uses username/password)
     * @param {string} redirectUri - Callback redirect URI (not used)
     * @param {Object} options - Additional options (username, password, deviceId)
     * @returns {Promise<Object>} Token response
     */
    async exchangeToken(code, redirectUri, options = {}) {
        // PikPak uses username/password to get token, not authorization code
        const clientId = options.clientId || this.config.clientId;
        const username = options.username;
        const password = options.password;
        const deviceId = options.deviceId || this.generateDeviceId();
        
        if (!username || !password) {
            throw new Error('PikPak requires username and password for authentication');
        }
        
        // PikPak uses AuthStyleInParams - client_id in request body
        const requestBody = {
            username: username,
            password: password,
            client_id: clientId
        };
        
        try {
            const response = await axios.post(
                this.config.authURL, // Signin URL
                requestBody,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'rclone-director/1.0'
                    },
                    timeout: 10000
                }
            );
            
            // PikPak returns: { access_token, refresh_token, token_type, expires_in }
            return {
                access_token: response.data.access_token,
                refresh_token: response.data.refresh_token,
                token_type: response.data.token_type || 'Bearer',
                expires_in: response.data.expires_in
            };
        } catch (error) {
            console.error('[PikPak] Error exchanging token:', error.response?.data || error.message);
            throw new Error(`Failed to get PikPak token: ${error.response?.data?.error_description || error.response?.data?.error || error.message}`);
        }
    }
    
    /**
     * Generate a device ID for PikPak (32 characters)
     * 
     * @returns {string} Device ID
     */
    generateDeviceId() {
        const chars = '0123456789abcdef';
        let deviceId = '';
        for (let i = 0; i < 32; i++) {
            deviceId += chars[Math.floor(Math.random() * chars.length)];
        }
        return deviceId;
    }
    
    /**
     * Format PikPak token for Rclone config
     * PikPak returns standard OAuth2 token format
     * 
     * @param {Object} tokenResponse - Token response from PikPak
     * @returns {string} JSON string formatted for Rclone
     */
    formatTokenForRclone(tokenResponse) {
        return super.formatTokenForRclone(tokenResponse);
    }
    
    /**
     * Refresh PikPak access token using refresh token
     * 
     * @param {string} refreshToken - OAuth refresh token
     * @param {string} clientId - OAuth client ID
     * @param {string} clientSecret - OAuth client secret (not used for PikPak)
     * @returns {Promise<Object>} New token response
     */
    async refreshToken(refreshToken, clientId, clientSecret) {
        const requestBody = {
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId
        };
        
        try {
            const response = await axios.post(
                this.config.tokenURL,
                requestBody,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'rclone-director/1.0'
                    },
                    timeout: 10000
                }
            );
            
            return response.data;
        } catch (error) {
            console.error('[PikPak] Error refreshing token:', error.response?.data || error.message);
            throw new Error(`Failed to refresh PikPak token: ${error.response?.data?.error_description || error.response?.data?.error || error.message}`);
        }
    }
    
    /**
     * Get PikPak account information
     * 
     * Uses PikPak API to get user info
     * 
     * @param {string} accessToken - OAuth access token
     * @param {string} refreshToken - OAuth refresh token (optional, for auto-refresh)
     * @param {Object} options - Additional options (clientId for refresh, remoteName, server, password, axiosInstance for config update)
     * @returns {Promise<Object>} Account info with email and name
     */
    async getAccountInfo(accessToken, refreshToken = null, options = {}) {
        try {
            // PikPak API endpoint for user info
            const response = await axios.get(
                'https://api-drive.mypikpak.com/v1/user',
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );
            
            // PikPak returns: { username, email, ... }
            const email = response.data.email || response.data.username;
            const name = response.data.name || response.data.username || email;
            
            return {
                email: email,
                name: name,
                account_id: response.data.user_id || response.data.username
            };
        } catch (error) {
            // Check if token expired and we have refresh token
            if (error.response?.status === 401 && refreshToken && options.clientId) {
                console.log('[PikPak] Access token expired, refreshing...');
                try {
                    const newToken = await this.refreshToken(refreshToken, options.clientId, '');
                    
                    // Retry with new token
                    const retryResponse = await axios.get(
                        'https://api-drive.mypikpak.com/v1/user',
                        {
                            headers: {
                                'Authorization': `Bearer ${newToken.access_token}`,
                                'Content-Type': 'application/json'
                            },
                            timeout: 10000
                        }
                    );
                    
                    const email = retryResponse.data.email || retryResponse.data.username;
                    const name = retryResponse.data.name || retryResponse.data.username || email;
                    
                    const accountInfo = {
                        email: email,
                        name: name,
                        account_id: retryResponse.data.user_id || retryResponse.data.username
                    };
                    
                    // Return both account info and new token so caller can update config
                    return {
                        accountInfo: accountInfo,
                        newToken: newToken
                    };
                } catch (refreshError) {
                    console.error('[PikPak] Error refreshing token:', refreshError.response?.data || refreshError.message);
                    throw new Error(`Failed to refresh expired token: ${refreshError.response?.data?.error_description || refreshError.response?.data?.error || refreshError.message}`);
                }
            }
            
            console.error('[PikPak] Error fetching account info:', error.response?.data || error.message);
            throw new Error(`Failed to get PikPak account info: ${error.response?.data?.error_description || error.response?.data?.error || error.message}`);
        }
    }
}

module.exports = PikpakProvider;

