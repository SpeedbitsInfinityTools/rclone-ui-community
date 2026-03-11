/**
 * Citrix ShareFile OAuth Provider
 * 
 * Implements Citrix ShareFile-specific OAuth flow
 * Based on Rclone's sharefile.go implementation
 * 
 * Note: ShareFile requires CheckAuth callback to extract subdomain and apicp from authorization response
 * The token URL is dynamically determined based on these values
 */

const BaseProvider = require('./base');
const axios = require('axios');

class SharefileProvider extends BaseProvider {
    constructor() {
        super('sharefile');
    }
    
    /**
     * Get authorization URL for Citrix ShareFile OAuth
     * 
     * @param {string} redirectUri - Callback redirect URI
     * @param {string} state - OAuth state parameter
     * @param {Object} options - Additional options (clientId override, endpoint)
     * @returns {string} Authorization URL
     */
    getAuthURL(redirectUri, state, options = {}) {
        return super.getAuthURL(redirectUri, state, options);
    }
    
    /**
     * Exchange authorization code for Citrix ShareFile access token
     * 
     * Note: ShareFile token URL is dynamically determined based on subdomain/apicp
     * If endpoint is provided in options, use it; otherwise use default
     * 
     * @param {string} code - Authorization code from callback
     * @param {string} redirectUri - Callback redirect URI
     * @param {Object} options - Additional options (endpoint, subdomain, apicp)
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
        
        // Determine token URL from endpoint, subdomain/apicp, or use default
        // ShareFile token URL is dynamically determined from authorization response
        let tokenURL = this.config.tokenURL;
        if (options.endpoint) {
            tokenURL = `${options.endpoint}/oauth/token`;
        } else if (options.subdomain && options.apicp) {
            const endpoint = `https://${options.subdomain}.${options.apicp}`;
            tokenURL = `${endpoint}/oauth/token`;
        } else if (!tokenURL || tokenURL.trim() === '') {
            // ShareFile requires endpoint/subdomain/apicp from authorization response
            throw new Error('ShareFile requires endpoint or subdomain/apicp from authorization response. Please ensure CheckAuth callback extracted these values.');
        }
        
        const params = new URLSearchParams();
        params.append('grant_type', 'authorization_code');
        params.append('code', code);
        params.append('redirect_uri', redirectUri);
        params.append('client_id', clientId);
        params.append('client_secret', clientSecret);
        
        try {
            const response = await axios.post(
                tokenURL,
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
            console.error('[ShareFile] Error exchanging token:', error.response?.data || error.message);
            throw new Error(`Failed to get ShareFile token: ${error.response?.data?.error_description || error.response?.data?.error || error.message}`);
        }
    }
    
    /**
     * Format Citrix ShareFile token for Rclone config
     * ShareFile returns standard OAuth2 token format
     * 
     * @param {Object} tokenResponse - Token response from ShareFile
     * @returns {string} JSON string formatted for Rclone
     */
    formatTokenForRclone(tokenResponse) {
        return super.formatTokenForRclone(tokenResponse);
    }
    
    /**
     * Refresh Citrix ShareFile access token using refresh token
     * 
     * @param {string} refreshToken - OAuth refresh token
     * @param {string} clientId - OAuth client ID
     * @param {string} clientSecret - OAuth client secret
     * @param {Object} options - Additional options (endpoint, subdomain, apicp)
     * @returns {Promise<Object>} New token response
     */
    async refreshToken(refreshToken, clientId, clientSecret, options = {}) {
        // Determine token URL from endpoint, subdomain/apicp, or use default
        let tokenURL = this.config.tokenURL;
        if (options?.endpoint) {
            tokenURL = `${options.endpoint}/oauth/token`;
        } else if (options?.subdomain && options?.apicp) {
            const endpoint = `https://${options.subdomain}.${options.apicp}`;
            tokenURL = `${endpoint}/oauth/token`;
        }
        
        const params = new URLSearchParams();
        params.append('grant_type', 'refresh_token');
        params.append('refresh_token', refreshToken);
        params.append('client_id', clientId);
        params.append('client_secret', clientSecret);
        
        try {
            const response = await axios.post(
                tokenURL,
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
            console.error('[ShareFile] Error refreshing token:', error.response?.data || error.message);
            throw new Error(`Failed to refresh ShareFile token: ${error.response?.data?.error_description || error.response?.data?.error || error.message}`);
        }
    }
    
    /**
     * Get Citrix ShareFile account information
     * 
     * Uses ShareFile API to get user info
     * 
     * @param {string} accessToken - OAuth access token
     * @param {string} refreshToken - OAuth refresh token (optional, for auto-refresh)
     * @param {Object} options - Additional options (clientId, clientSecret for refresh, endpoint, subdomain, apicp)
     * @returns {Promise<Object>} Account info with email and name
     */
    async getAccountInfo(accessToken, refreshToken = null, options = {}) {
        // Determine API endpoint from options
        let apiURL = options.endpoint || 'https://secure.sharefile.com';
        if (options.subdomain && options.apicp) {
            apiURL = `https://${options.subdomain}.${options.apicp}`;
        }
        
        try {
            // ShareFile API endpoint for user info
            const response = await axios.get(
                `${apiURL}/sf/v3/Users/OData`,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );
            
            // ShareFile OData returns: { value: [{ Email, FirstName, LastName, ... }] }
            const users = response.data.value || [];
            if (users.length === 0) {
                throw new Error('No user data found in response');
            }
            
            const user = users[0];
            const email = user.Email;
            const name = user.FirstName && user.LastName 
                ? `${user.FirstName} ${user.LastName}` 
                : user.FirstName || user.LastName || user.DisplayName || email;
            
            return {
                email: email,
                name: name,
                account_id: user.Id || user.Email
            };
        } catch (error) {
            // Check if token expired and we have refresh token
            if (error.response?.status === 401 && refreshToken && options.clientId && options.clientSecret) {
                console.log('[ShareFile] Access token expired, refreshing...');
                try {
                    const newToken = await this.refreshToken(refreshToken, options.clientId, options.clientSecret, options);
                    
                    // Retry with new token
                    const retryResponse = await axios.get(
                        `${apiURL}/sf/v3/Users/OData`,
                        {
                            headers: {
                                'Authorization': `Bearer ${newToken.access_token}`,
                                'Content-Type': 'application/json'
                            },
                            timeout: 10000
                        }
                    );
                    
                    const users = retryResponse.data.value || [];
                    if (users.length === 0) {
                        throw new Error('No user data found in response');
                    }
                    
                    const user = users[0];
                    const email = user.Email;
                    const name = user.FirstName && user.LastName 
                        ? `${user.FirstName} ${user.LastName}` 
                        : user.FirstName || user.LastName || user.DisplayName || email;
                    
                    const accountInfo = {
                        email: email,
                        name: name,
                        account_id: user.Id || user.Email
                    };
                    
                    // Return both account info and new token so caller can update config
                    return {
                        accountInfo: accountInfo,
                        newToken: newToken
                    };
                } catch (refreshError) {
                    console.error('[ShareFile] Error refreshing token:', refreshError.response?.data || refreshError.message);
                    throw new Error(`Failed to refresh expired token: ${refreshError.response?.data?.error_description || refreshError.response?.data?.error || refreshError.message}`);
                }
            }
            
            console.error('[ShareFile] Error fetching account info:', error.response?.data || error.message);
            throw new Error(`Failed to get ShareFile account info: ${error.response?.data?.error_description || error.response?.data?.error || error.message}`);
        }
    }
}

module.exports = SharefileProvider;

