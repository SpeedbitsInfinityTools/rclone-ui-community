/**
 * Zoho OAuth Provider
 * 
 * Implements Zoho-specific OAuth flow
 * Based on Rclone's zoho.go implementation
 * 
 * Note: Zoho requires ApprovalForce option to get refresh tokens
 */

const BaseProvider = require('./base');
const axios = require('axios');

class ZohoProvider extends BaseProvider {
    constructor() {
        super('zoho');
    }
    
    /**
     * Get authorization URL for Zoho OAuth
     * 
     * Zoho requires ApprovalForce option to get refresh tokens
     * 
     * @param {string} redirectUri - Callback redirect URI
     * @param {string} state - OAuth state parameter
     * @param {Object} options - Additional options (clientId override)
     * @returns {string} Authorization URL
     */
    getAuthURL(redirectUri, state, options = {}) {
        const clientId = options.clientId || this.config.clientId;
        if (!clientId || clientId.trim() === '') {
            throw new Error(`Client ID is required for ${this.providerName} OAuth`);
        }
        
        // Build auth URL with ApprovalForce parameter
        const utils = require('../utils');
        const authURL = utils.buildAuthURL(this.config, redirectUri, state, clientId);
        
        // Add ApprovalForce parameter (required for refresh tokens)
        const url = new URL(authURL);
        url.searchParams.append('approval_prompt', 'force');
        
        return url.toString();
    }
    
    /**
     * Exchange authorization code for Zoho access token
     * 
     * @param {string} code - Authorization code from callback
     * @param {string} redirectUri - Callback redirect URI
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Token response
     */
    async exchangeToken(code, redirectUri, options = {}) {
        const clientId = options.clientId || this.config.clientId;
        const clientSecret = options.clientSecret || this.config.clientSecret;
        
        if (!clientId) {
            throw new Error(`Client ID is required for ${this.providerName} OAuth`);
        }
        if (!clientSecret) {
            throw new Error(`Client Secret is required for ${this.providerName} OAuth. Please provide client_id and client_secret in the wizard.`);
        }
        
        // Zoho uses AuthStyleInParams - client_id and client_secret in request body
        const params = new URLSearchParams();
        params.append('grant_type', 'authorization_code');
        params.append('code', code);
        params.append('redirect_uri', redirectUri);
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
            
            // Zoho requires token_type to be "Zoho-oauthtoken" (not "Bearer")
            const tokenData = response.data;
            if (tokenData.token_type && tokenData.token_type !== 'Zoho-oauthtoken') {
                tokenData.token_type = 'Zoho-oauthtoken';
            }
            
            return tokenData;
        } catch (error) {
            console.error('[Zoho] Error exchanging token:', error.response?.data || error.message);
            throw new Error(`Failed to get Zoho token: ${error.response?.data?.error_description || error.response?.data?.error || error.message}`);
        }
    }
    
    /**
     * Format Zoho token for Rclone config
     * Zoho requires token_type to be "Zoho-oauthtoken"
     * 
     * @param {Object} tokenResponse - Token response from Zoho
     * @returns {string} JSON string formatted for Rclone
     */
    formatTokenForRclone(tokenResponse) {
        // Ensure token_type is "Zoho-oauthtoken"
        const formattedToken = {
            ...tokenResponse,
            token_type: 'Zoho-oauthtoken'
        };
        return super.formatTokenForRclone(formattedToken);
    }
    
    /**
     * Refresh Zoho access token using refresh token
     * 
     * @param {string} refreshToken - OAuth refresh token
     * @param {string} clientId - OAuth client ID
     * @param {string} clientSecret - OAuth client secret
     * @returns {Promise<Object>} New token response
     */
    async refreshToken(refreshToken, clientId, clientSecret) {
        // Zoho uses AuthStyleInParams - client_id and client_secret in request body
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
            
            // Zoho requires token_type to be "Zoho-oauthtoken"
            const tokenData = response.data;
            if (tokenData.token_type && tokenData.token_type !== 'Zoho-oauthtoken') {
                tokenData.token_type = 'Zoho-oauthtoken';
            }
            
            return tokenData;
        } catch (error) {
            console.error('[Zoho] Error refreshing token:', error.response?.data || error.message);
            throw new Error(`Failed to refresh Zoho token: ${error.response?.data?.error_description || error.response?.data?.error || error.message}`);
        }
    }
    
    /**
     * Get Zoho account information
     * 
     * Uses Zoho WorkDrive API to get user info
     * 
     * @param {string} accessToken - OAuth access token
     * @param {string} refreshToken - OAuth refresh token (optional, for auto-refresh)
     * @param {Object} options - Additional options (clientId, clientSecret for refresh, remoteName, server, password, axiosInstance for config update)
     * @returns {Promise<Object>} Account info with email and name
     */
    async getAccountInfo(accessToken, refreshToken = null, options = {}) {
        try {
            // Zoho WorkDrive API endpoint for user info
            // Default to EU region (accounts.zoho.eu)
            const apiURL = options.apiURL || 'https://workdrive.zoho.eu/api/v1';
            const response = await axios.get(
                `${apiURL}/users/me`,
                {
                    headers: {
                        'Authorization': `Zoho-oauthtoken ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );
            
            // Zoho returns: { data: { attributes: { email, name, ... }, ... }, ... }
            const data = response.data.data || response.data;
            const attributes = data.attributes || data;
            const email = attributes.email || attributes.login_id;
            const name = attributes.name || attributes.display_name || email;
            
            return {
                email: email,
                name: name,
                account_id: data.id || attributes.id
            };
        } catch (error) {
            // Check if token expired and we have refresh token
            if (error.response?.status === 401 && refreshToken && options.clientId && options.clientSecret) {
                console.log('[Zoho] Access token expired, refreshing...');
                try {
                    const newToken = await this.refreshToken(refreshToken, options.clientId, options.clientSecret);
                    
                    // Retry with new token
                    const apiURL = options.apiURL || 'https://workdrive.zoho.eu/api/v1';
                    const retryResponse = await axios.get(
                        `${apiURL}/users/me`,
                        {
                            headers: {
                                'Authorization': `Zoho-oauthtoken ${newToken.access_token}`,
                                'Content-Type': 'application/json'
                            },
                            timeout: 10000
                        }
                    );
                    
                    const data = retryResponse.data.data || retryResponse.data;
                    const attributes = data.attributes || data;
                    const email = attributes.email || attributes.login_id;
                    const name = attributes.name || attributes.display_name || email;
                    
                    const accountInfo = {
                        email: email,
                        name: name,
                        account_id: data.id || attributes.id
                    };
                    
                    // Return both account info and new token so caller can update config
                    return {
                        accountInfo: accountInfo,
                        newToken: newToken
                    };
                } catch (refreshError) {
                    console.error('[Zoho] Error refreshing token:', refreshError.response?.data || refreshError.message);
                    throw new Error(`Failed to refresh expired token: ${refreshError.response?.data?.error_description || refreshError.response?.data?.error || refreshError.message}`);
                }
            }
            
            console.error('[Zoho] Error fetching account info:', error.response?.data || error.message);
            throw new Error(`Failed to get Zoho account info: ${error.response?.data?.error_description || error.response?.data?.error || error.message}`);
        }
    }
}

module.exports = ZohoProvider;

