/**
 * Base OAuth Provider Class
 * 
 * Provides common OAuth functionality that all providers can extend
 */

const utils = require('../utils');
const config = require('../oauth-config');

class BaseProvider {
    constructor(providerName) {
        this.providerName = providerName;
        this.config = config[providerName];
        
        if (!this.config) {
            throw new Error(`No OAuth config found for provider: ${providerName}`);
        }
    }
    
    /**
     * Get authorization URL for OAuth flow
     * 
     * @param {string} redirectUri - Callback redirect URI
     * @param {string} state - OAuth state parameter
     * @param {Object} options - Additional options (clientId override, etc.)
     * @returns {string} Authorization URL
     */
    getAuthURL(redirectUri, state, options = {}) {
        const clientId = options.clientId || this.config.clientId;
        if (!clientId || clientId.trim() === '') {
            throw new Error(`Client ID is required for ${this.providerName} OAuth`);
        }
        return utils.buildAuthURL(this.config, redirectUri, state, clientId);
    }
    
    /**
     * Exchange authorization code for access token
     * 
     * @param {string} code - Authorization code from callback
     * @param {string} redirectUri - Callback redirect URI
     * @param {Object} options - Additional options (clientId, clientSecret overrides)
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
        
        return await utils.exchangeCodeForToken(
            this.config,
            code,
            redirectUri,
            clientId,
            clientSecret
        );
    }
    
    /**
     * Format token for Rclone config
     * 
     * @param {Object} tokenResponse - Token response from provider
     * @returns {string} JSON string formatted for Rclone
     */
    formatTokenForRclone(tokenResponse) {
        return utils.formatTokenForRclone(tokenResponse);
    }
    
    /**
     * Get default scopes for this provider
     * 
     * @returns {Array<string>} Array of scope strings
     */
    getScopes() {
        return this.config.scopes || [];
    }
    
    /**
     * Get account information from OAuth provider
     * 
     * Override this method in provider-specific implementations
     * 
     * @param {string} accessToken - OAuth access token
     * @returns {Promise<Object>} Account info (email, name, etc.)
     */
    async getAccountInfo(accessToken) {
        throw new Error(`getAccountInfo not implemented for provider: ${this.providerName}`);
    }
}

module.exports = BaseProvider;

