/**
 * Microsoft OneDrive OAuth Provider
 * 
 * Implements OneDrive-specific OAuth flow
 * Based on Rclone's onedrive.go implementation
 */

const BaseProvider = require('./base');
const utils = require('../utils');
const axios = require('axios');

class OneDriveProvider extends BaseProvider {
    constructor() {
        super('onedrive');
    }
    
    /**
     * Get authorization URL for OneDrive OAuth
     * 
     * @param {string} redirectUri - Callback redirect URI
     * @param {string} state - OAuth state parameter
     * @param {Object} options - Additional options (clientId override, region)
     * @returns {string} Authorization URL
     */
    getAuthURL(redirectUri, state, options = {}) {
        const clientId = options.clientId || this.config.clientId;
        // OneDrive supports multiple regions, but we use 'common' endpoint by default
        // Region can be specified in options.region (global, us, de, cn)
        const region = options.region || 'global';
        const authEndpoint = this.getAuthEndpoint(region);
        
        // Build auth URL with region-specific endpoint
        const config = {
            ...this.config,
            authURL: `${authEndpoint}/common/oauth2/v2.0/authorize`
        };
        
        return utils.buildAuthURL(config, redirectUri, state, clientId);
    }
    
    /**
     * Get auth endpoint for region
     * 
     * @param {string} region - Region (global, us, de, cn)
     * @returns {string} Auth endpoint URL
     */
    getAuthEndpoint(region = 'global') {
        const endpoints = {
            'global': 'https://login.microsoftonline.com',
            'us': 'https://login.microsoftonline.us',
            'de': 'https://login.microsoftonline.de',
            'cn': 'https://login.chinacloudapi.cn'
        };
        return endpoints[region] || endpoints['global'];
    }
    
    /**
     * Get token endpoint for region
     * 
     * @param {string} region - Region (global, us, de, cn)
     * @returns {string} Token endpoint URL
     */
    getTokenEndpoint(region = 'global') {
        return `${this.getAuthEndpoint(region)}/common/oauth2/v2.0/token`;
    }
    
    /**
     * Exchange authorization code for OneDrive access token
     * 
     * @param {string} code - Authorization code from callback
     * @param {string} redirectUri - Callback redirect URI
     * @param {Object} options - Additional options (region)
     * @returns {Promise<Object>} Token response
     */
    async exchangeToken(code, redirectUri, options = {}) {
        const clientId = options.clientId || this.config.clientId;
        const clientSecret = options.clientSecret || this.config.clientSecret;
        const region = options.region || 'global';
        
        if (!clientId) {
            throw new Error('Client ID is required for OneDrive OAuth');
        }
        if (!clientSecret) {
            throw new Error('Client Secret is required for OneDrive OAuth. Please provide client_id and client_secret in the wizard.');
        }
        
        // Use region-specific token endpoint
        const tokenURL = this.getTokenEndpoint(region);
        
        return await utils.exchangeCodeForToken(
            { ...this.config, tokenURL },
            code,
            redirectUri,
            clientId,
            clientSecret
        );
    }
    
    /**
     * Format OneDrive token for Rclone config
     * OneDrive returns standard OAuth2 token format
     * 
     * @param {Object} tokenResponse - Token response from Microsoft
     * @returns {string} JSON string formatted for Rclone
     */
    formatTokenForRclone(tokenResponse) {
        return super.formatTokenForRclone(tokenResponse);
    }
    
    /**
     * Refresh OneDrive access token using refresh token
     * 
     * @param {string} refreshToken - OAuth refresh token
     * @param {string} clientId - OAuth client ID
     * @param {string} clientSecret - OAuth client secret
     * @param {string} region - Region (optional, defaults to global)
     * @returns {Promise<Object>} New token response
     */
    async refreshToken(refreshToken, clientId, clientSecret, region = 'global') {
        // OneDrive uses standard OAuth2 refresh token flow
        const tokenURL = this.getTokenEndpoint(region);
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
            console.error('[OneDrive] Error refreshing token:', error.response?.data || error.message);
            throw new Error(`Failed to refresh OneDrive token: ${error.response?.data?.error_description || error.message}`);
        }
    }
    
    /**
     * Get OneDrive drives (required for drive_id and drive_type)
     * 
     * Queries Microsoft Graph API to get available drives
     * This is required for OneDrive configuration
     * 
     * @param {string} accessToken - OAuth access token
     * @param {string} refreshToken - OAuth refresh token (optional, for auto-refresh)
     * @param {Object} options - Additional options (clientId, clientSecret for refresh, region)
     * @returns {Promise<Object>} Object with drive_id and drive_type, or { driveInfo, newToken } if refresh occurred
     */
    async getDriveInfo(accessToken, refreshToken = null, options = {}) {
        const region = options.region || 'global';
        const graphEndpoint = this.getGraphEndpoint(region);
        
        try {
            // Query /me/drives to get available drives
            console.log(`[OneDrive] Fetching drives from ${graphEndpoint}/v1.0/me/drives (region: ${region})`);
            const response = await axios.get(
                `${graphEndpoint}/v1.0/me/drives`,
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );
            
            console.log(`[OneDrive] Drives response:`, {
                status: response.status,
                hasData: !!response.data,
                hasDrives: !!response.data?.value,
                driveCount: response.data?.value?.length || 0
            });
            
            if (!response.data || !response.data.value || response.data.value.length === 0) {
                throw new Error('No drives found for this account');
            }
            
            // Select the first drive (usually the default OneDrive)
            const drive = response.data.value[0];
            const driveId = drive.id;
            const driveType = drive.driveType || 'personal'; // Default to 'personal' if not specified
            
            console.log(`[OneDrive] Selected drive:`, {
                id: driveId,
                type: driveType,
                name: drive.name
            });
            
            return {
                drive_id: driveId,
                drive_type: driveType
            };
        } catch (error) {
            // Check if token expired and we have refresh token
            if (error.response?.status === 401 && refreshToken && options.clientId && options.clientSecret) {
                console.log('[OneDrive] Access token expired, refreshing...');
                try {
                    const newToken = await this.refreshToken(refreshToken, options.clientId, options.clientSecret, region);
                    
                    // Retry with new token
                    const retryResponse = await axios.get(
                        `${graphEndpoint}/v1.0/me/drives`,
                        {
                            headers: {
                                'Authorization': `Bearer ${newToken.access_token}`,
                                'Content-Type': 'application/json'
                            },
                            timeout: 10000
                        }
                    );
                    
                    if (!retryResponse.data || !retryResponse.data.value || retryResponse.data.value.length === 0) {
                        throw new Error('No drives found for this account');
                    }
                    
                    const drive = retryResponse.data.value[0];
                    const driveId = drive.id;
                    const driveType = drive.driveType || 'personal';
                    
                    return {
                        drive_id: driveId,
                        drive_type: driveType,
                        newToken: newToken
                    };
                } catch (refreshError) {
                    console.error('[OneDrive] Error refreshing token for drive info:', refreshError);
                    throw new Error(`Failed to refresh token and get drives: ${refreshError.message}`);
                }
            }
            
            console.error('[OneDrive] Error getting drives:', error.response?.data || error.message);
            throw new Error(`Failed to get OneDrive drives: ${error.response?.data?.error?.message || error.message}`);
        }
    }
    
    /**
     * Get OneDrive account information
     * 
     * Uses Microsoft Graph API to get current user info
     * Automatically refreshes token if expired
     * 
     * @param {string} accessToken - OAuth access token
     * @param {string} refreshToken - OAuth refresh token (optional, for auto-refresh)
     * @param {Object} options - Additional options (clientId, clientSecret for refresh, region, remoteName, server, password, axiosInstance for config update)
     * @returns {Promise<Object>} Account info with email and name, or { accountInfo, newToken } if refresh occurred
     */
    async getAccountInfo(accessToken, refreshToken = null, options = {}) {
        const region = options.region || 'global';
        const graphEndpoint = this.getGraphEndpoint(region);
        
        // Note: RCD automatically refreshes tokens when making API calls through RCD.
        // However, we're calling Microsoft Graph API directly (not through RCD), so we need
        // to handle refresh here. We use reactive refresh (on 401) rather than proactive
        // refresh, as RCD handles token refresh for its own API calls automatically.
        
        try {
            // Use region-specific Graph endpoint (not from config.accountInfoURL)
            console.log(`[OneDrive] Fetching account info from ${graphEndpoint}/v1.0/me (region: ${region})`);
            return await this.fetchAccountInfoWithToken(accessToken, graphEndpoint);
        } catch (error) {
            // Check if token expired and we have refresh token
            if (error.response?.status === 401 && refreshToken && options.clientId && options.clientSecret) {
                console.log('[OneDrive] Access token expired (401), refreshing...');
                try {
                    const newToken = await this.refreshToken(refreshToken, options.clientId, options.clientSecret, region);
                    console.log('[OneDrive] Token refresh successful, retrying account info...');
                    
                    // Retry with new token using helper method
                    const accountInfo = await this.fetchAccountInfoWithToken(newToken.access_token, graphEndpoint);
                    
                    // Return both account info and new token so caller can update config
                    return {
                        accountInfo: accountInfo,
                        newToken: newToken
                    };
                } catch (refreshError) {
                    console.error('[OneDrive] Error refreshing token:', refreshError.response?.data || refreshError.message);
                    throw new Error(`Failed to refresh expired token: ${refreshError.response?.data?.error_description || refreshError.message}`);
                }
            }
            
            console.error('[OneDrive] Error fetching account info:', error.response?.data || error.message);
            throw new Error(`Failed to get OneDrive account info: ${error.response?.data?.error?.message || error.message}`);
        }
    }
    
    /**
     * Helper method to fetch account info with a given token
     * Used for both initial calls and retries after refresh
     */
    async fetchAccountInfoWithToken(accessToken, graphEndpoint) {
        const response = await axios.get(
            `${graphEndpoint}/v1.0/me`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );
        
        console.log(`[OneDrive] Account info response:`, {
            status: response.status,
            hasData: !!response.data,
            dataKeys: response.data ? Object.keys(response.data) : [],
            mail: response.data?.mail,
            userPrincipalName: response.data?.userPrincipalName,
            displayName: response.data?.displayName
        });
        
        if (!response.data) {
            throw new Error('Invalid response: no data received from Microsoft Graph API');
        }
        
        // Microsoft Graph API may return different fields depending on account type
        const email = response.data.mail || 
                     response.data.userPrincipalName || 
                     response.data.mailNickname ||
                     response.data.id;
        
        if (!email) {
            console.error('[OneDrive] Response data:', JSON.stringify(response.data, null, 2));
            throw new Error('Invalid response format: missing email, userPrincipalName, mailNickname, or id');
        }
        
        const name = response.data.displayName || 
                    response.data.givenName || 
                    response.data.surname ||
                    email;
        
        return {
            email: email,
            name: name
        };
    }
    
    
    /**
     * Get Graph API endpoint for region
     * 
     * @param {string} region - Region (global, us, de, cn)
     * @returns {string} Graph API endpoint URL
     */
    getGraphEndpoint(region = 'global') {
        const endpoints = {
            'global': 'https://graph.microsoft.com',
            'us': 'https://graph.microsoft.us',
            'de': 'https://graph.microsoft.de',
            'cn': 'https://microsoftgraph.chinacloudapi.cn'
        };
        return endpoints[region] || endpoints['global'];
    }

    /**
     * Generic Graph GET with automatic 401 → refresh-token retry.
     *
     * Returns { data, newToken? } so the caller can persist a refreshed token
     * back to rclone.conf via config/update if it wants to.
     *
     * `pathOrUrl` may be either:
     *   - an absolute https URL starting with `https://graph.microsoft.*`
     *     (used for `@odata.nextLink` pagination and the URL fallback)
     *   - a path beginning with `/v1.0/...` which is appended to the
     *     region-specific Graph endpoint.
     *
     * @private
     */
    async _graphGet(pathOrUrl, accessToken, refreshToken, options = {}) {
        const region = options.region || 'global';
        const graphEndpoint = this.getGraphEndpoint(region);
        const url = pathOrUrl.startsWith('http')
            ? pathOrUrl
            : `${graphEndpoint}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
        const timeoutMs = options.timeoutMs || 10000;

        const doGet = (token) => axios.get(url, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            timeout: timeoutMs,
            // Don't throw on 4xx so callers can introspect (404 / 403 are
            // expected in some flows like resolve-site-url and search-sites).
            validateStatus: (s) => s >= 200 && s < 500
        });

        let response = await doGet(accessToken);
        let newToken = null;

        if (response.status === 401 && refreshToken && options.clientId && options.clientSecret) {
            console.log(`[OneDrive] _graphGet 401, refreshing token and retrying ${url}`);
            try {
                newToken = await this.refreshToken(refreshToken, options.clientId, options.clientSecret, region);
                response = await doGet(newToken.access_token);
            } catch (refreshError) {
                console.error('[OneDrive] _graphGet refresh failed:', refreshError.message);
                throw new Error(`Token refresh failed: ${refreshError.message}`);
            }
        }

        if (response.status >= 400) {
            const err = new Error(
                response.data?.error?.message || `Microsoft Graph returned HTTP ${response.status}`
            );
            err.status = response.status;
            err.code = response.data?.error?.code || `HTTP_${response.status}`;
            err.graph = response.data?.error;
            throw err;
        }

        return { data: response.data, newToken };
    }

    /**
     * List the signed-in user's personal OneDrive(s).
     * Returns up to N drives shaped for the picker UI.
     *
     * @param {string} accessToken
     * @param {string|null} refreshToken
     * @param {Object} options - { clientId, clientSecret, region }
     * @returns {Promise<{ drives: Array, newToken?: Object }>}
     */
    async listPersonalDrives(accessToken, refreshToken = null, options = {}) {
        const { data, newToken } = await this._graphGet(
            '/v1.0/me/drives',
            accessToken,
            refreshToken,
            options
        );
        const drives = (data?.value || []).map(d => ({
            drive_id: d.id,
            drive_type: d.driveType || 'personal',
            name: d.name || 'OneDrive',
            webUrl: d.webUrl || null,
            owner: d.owner?.user?.displayName || d.owner?.user?.email || null
        }));
        return { drives, newToken };
    }

    /**
     * Search SharePoint sites visible to the signed-in user.
     *
     * `query` defaults to `*` which asks Graph for "any site the caller can
     * see". Tenants that haven't granted Sites.Read.All consent will return
     * 403 — caller should fall back to the resolve-by-URL path and surface a
     * helpful message.
     *
     * @param {string} accessToken
     * @param {string|null} refreshToken
     * @param {Object} options - { clientId, clientSecret, region }
     * @param {string} query
     * @returns {Promise<{ sites: Array, newToken?: Object, restricted?: boolean }>}
     */
    async searchSites(accessToken, refreshToken = null, options = {}, query = '*') {
        const safeQuery = (typeof query === 'string' && query.trim()) ? query.trim() : '*';
        const encoded = encodeURIComponent(safeQuery);
        const path = `/v1.0/sites?search=${encoded}&$top=50`;

        try {
            const { data, newToken } = await this._graphGet(path, accessToken, refreshToken, options);
            const sites = (data?.value || []).map(s => ({
                site_id: s.id,
                displayName: s.displayName || s.name || s.webUrl || '(unnamed site)',
                name: s.name || null,
                webUrl: s.webUrl || null,
                description: s.description || null
            }));
            return { sites, newToken, restricted: false };
        } catch (error) {
            if (error.status === 403 || error.code === 'accessDenied' || error.code === 'Forbidden') {
                console.log('[OneDrive] searchSites: access denied (no Sites.Read.All consent?) — caller should use resolve-by-URL fallback');
                return { sites: [], newToken: null, restricted: true };
            }
            throw error;
        }
    }

    /**
     * Resolve a SharePoint site by its web URL (fallback when ?search=* is
     * blocked by tenant policy). Accepts inputs like:
     *
     *   https://contoso.sharepoint.com/sites/Marketing
     *   https://contoso.sharepoint.com/sites/Marketing/Shared%20Documents
     *   contoso.sharepoint.com/sites/Marketing
     *   /sites/Marketing            (assumes the user's default hostname — rejected)
     *
     * Throws on malformed input or 404.
     */
    async resolveSiteByUrl(accessToken, refreshToken = null, options = {}, rawUrl = '') {
        if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
            throw Object.assign(new Error('A site URL is required'), { status: 400, code: 'badInput' });
        }
        let url = rawUrl.trim();
        if (!/^https?:\/\//i.test(url)) {
            url = `https://${url}`;
        }
        let parsed;
        try {
            parsed = new URL(url);
        } catch (e) {
            throw Object.assign(new Error(`Invalid URL: ${rawUrl}`), { status: 400, code: 'badInput' });
        }
        const hostname = parsed.hostname.toLowerCase();
        if (!hostname.endsWith('.sharepoint.com') && !hostname.endsWith('.sharepoint.us') &&
            !hostname.endsWith('.sharepoint.de') && !hostname.endsWith('.sharepoint.cn')) {
            throw Object.assign(
                new Error('URL must be a *.sharepoint.com (or regional) site URL'),
                { status: 400, code: 'badInput' }
            );
        }
        // Take the path up to (and including) /sites/<name> or /teams/<name>; strip query/hash and trailing parts.
        const segments = parsed.pathname.split('/').filter(Boolean);
        let sitePath = '';
        const sitesIdx = segments.findIndex(s => s.toLowerCase() === 'sites' || s.toLowerCase() === 'teams');
        if (sitesIdx >= 0 && segments[sitesIdx + 1]) {
            sitePath = `/${segments[sitesIdx]}/${segments[sitesIdx + 1]}`;
        } else if (segments.length === 0) {
            // root site
            sitePath = '';
        } else {
            // unknown URL shape — try whatever the user gave us
            sitePath = `/${segments.join('/')}`;
        }

        // Microsoft Graph syntax for "look up site by URL":
        //   GET /v1.0/sites/{hostname}:/{server-relative-path}
        // For the root site (no path): GET /v1.0/sites/{hostname}
        const graphPath = sitePath
            ? `/v1.0/sites/${encodeURIComponent(hostname)}:${sitePath}`
            : `/v1.0/sites/${encodeURIComponent(hostname)}`;

        const { data, newToken } = await this._graphGet(graphPath, accessToken, refreshToken, options);
        if (!data?.id) {
            throw Object.assign(
                new Error(`Could not resolve ${rawUrl} to a SharePoint site`),
                { status: 404, code: 'itemNotFound' }
            );
        }
        return {
            site: {
                site_id: data.id,
                displayName: data.displayName || data.name || rawUrl,
                name: data.name || null,
                webUrl: data.webUrl || null,
                description: data.description || null
            },
            newToken
        };
    }

    /**
     * List the document libraries (drives) of a SharePoint site.
     *
     * @param {string} accessToken
     * @param {string|null} refreshToken
     * @param {Object} options - { clientId, clientSecret, region }
     * @param {string} siteId - Microsoft Graph site identifier (composite "host,guid,guid")
     * @returns {Promise<{ drives: Array, newToken?: Object }>}
     */
    async listSiteDrives(accessToken, refreshToken = null, options = {}, siteId = '') {
        if (typeof siteId !== 'string' || !siteId.trim()) {
            throw Object.assign(new Error('site_id is required'), { status: 400, code: 'badInput' });
        }
        // siteId is the composite "host,guid,guid" string — Graph requires it
        // verbatim (commas and all). encodeURIComponent would escape the commas
        // and break the lookup, so we pass it through unchanged. The earlier
        // input validation in routes/onedrive.routes.js limits the allowed
        // character set so this is safe to interpolate.
        const path = `/v1.0/sites/${siteId}/drives`;
        const { data, newToken } = await this._graphGet(path, accessToken, refreshToken, options);
        const drives = (data?.value || []).map(d => ({
            drive_id: d.id,
            drive_type: d.driveType || 'documentLibrary',
            name: d.name || 'Documents',
            webUrl: d.webUrl || null,
            description: d.description || null
        }));
        return { drives, newToken };
    }
}

module.exports = OneDriveProvider;

