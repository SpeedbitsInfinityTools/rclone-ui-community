/**
 * OAuth Configuration for all Rclone backends
 * 
 * Extracted from Rclone Go source code
 * Each provider has:
 * - clientId: Default Rclone client ID (can be overridden by user)
 * - clientSecret: Default Rclone client secret (can be overridden by user)
 * - authURL: OAuth authorization endpoint
 * - tokenURL: OAuth token exchange endpoint
 * - scopes: Array of OAuth scopes to request
 * - additionalParams: Additional URL parameters for auth URL (optional)
 */

const obscure = require('./obscure');

// Rclone's obscured client secrets (from backend source code)
const DROPBOX_OBSCURED_SECRET = 'fRS5vVLr2v6FbyXYnIgjwBuUAt0osq_QZTXAEcmZ7g';
const DRIVE_OBSCURED_SECRET = 'eX8GpZTVx3vxMWVkuuBdDWmAUE6rGhTwVrvG9GhllYccSdj2-mvHVg';
const ONEDRIVE_OBSCURED_SECRET = '_JUdzh3LnKNqSPcf4Wu5fgMFIQOI8glZu_akYgR8yf6egowNBg-R';
const BOX_OBSCURED_SECRET = 'sYbJYm99WB8jzeaLPU0OPDMJKIkZvD2qOn3SyEMfiJr03RdtDt3xcZEIudRhbIDL';
const PCLOUD_OBSCURED_SECRET = 'ej1OIF39VOQQ0PXaSdK9ztkLw3tdLNscW2157TKNQdQKkICR4uU7aFg4eFM';
const YANDEX_OBSCURED_SECRET = 'EfyyNZ3YUEwXM5yAhi72G9YwKn2mkFrYwJNS7cY0TJAhFlX9K-uJFbGlpO-RYjrJ';
const HIDRIVE_OBSCURED_SECRET = 'GC7UDZ3Ra4jLcmfQSagKCDJ1JEy-mU6pBBhFrS3tDEHILrK7j3TQHUrglkO5SgZ_';
const JOTTACLOUD_LEGACY_OBSCURED_SECRET = 'Vp8eAv7eVElMnQwN-kgU9cbhgApNDaMqWdlDi5qFydlQoji4JBxrGMF2';
const GPHOTOS_OBSCURED_SECRET = 'kLJLretPefBgrDHosdml_nlF64HZ9mUcO85X5rdjYBPP8ChA-jr3Ow';
const GCS_OBSCURED_SECRET = 'Uj7C9jGfb9gmeaV70Lh058cNkWvepr-Es9sBm0zdgil7JaOWF1VySw';
const PREMIUMIZEME_OBSCURED_SECRET = 'B5YIvQoRIhcpAYs8HYeyjb9gK-ftmZEbqdh_gNfc4RgO9Q';
const PUTIO_OBSCURED_SECRET = 'cMwrjWVmrHZp3gf1ZpCrlyGAmPpB-YY5BbVnO1fj-G9evcd8';
const SHAREFILE_OBSCURED_SECRET = 'v7572bKhUindQL3yDnUAebmgP-QxiwT38JLxVPolcZBl6SSs329MtFzH73x7BeELmMVZtneUPvALSopUZ6VkhQ';
const ZOHO_OBSCURED_SECRET = 'U-2gxclZQBcOG9NPhjiXAhj-f0uQ137D0zar8YyNHXHkQZlTeSpIOQfmCb4oSpvosJp_SJLXmLLeUA';

module.exports = {
    dropbox: {
        clientId: '5jcck7diasz0rqy',
        clientSecret: obscure.mustReveal(DROPBOX_OBSCURED_SECRET),
        authURL: 'https://www.dropbox.com/oauth2/authorize',
        tokenURL: 'https://api.dropboxapi.com/oauth2/token',
        scopes: [
            'files.metadata.write',
            'files.content.write',
            'files.content.read',
            'sharing.write',
            'account_info.read'
        ],
        additionalParams: {
            token_access_type: 'offline' // Request refresh token
        },
        accountInfoURL: 'https://api.dropboxapi.com/2/users/get_current_account',
        noOffline: true
    },
    
    drive: {
        clientId: '202264815644.apps.googleusercontent.com',
        clientSecret: obscure.mustReveal(DRIVE_OBSCURED_SECRET),
        authURL: 'https://accounts.google.com/o/oauth2/auth',
        tokenURL: 'https://oauth2.googleapis.com/token',
        scopes: [
            'https://www.googleapis.com/auth/drive'
        ],
        accountInfoURL: 'https://www.googleapis.com/drive/v3/about?fields=user',
        // Google OAuth uses standard OAuth2 flow
    },
    
    onedrive: {
        clientId: 'b15665d9-eda6-4092-8539-0eec376afd59',
        clientSecret: obscure.mustReveal(ONEDRIVE_OBSCURED_SECRET),
        // Base auth URL - provider will add /common/oauth2/v2.0/authorize based on region
        authURL: 'https://login.microsoftonline.com',
        tokenURL: 'https://login.microsoftonline.com/common/oauth2/v2.0/token', // Default to global
        scopes: [
            'Files.Read',
            'Files.ReadWrite',
            'Files.Read.All',
            'Files.ReadWrite.All',
            'Sites.Read.All',
            'offline_access'
        ],
        accountInfoURL: 'https://graph.microsoft.com/v1.0/me', // Base URL - provider will use region-specific endpoint
        // OneDrive supports multiple regions (global, us, de, cn)
        // Provider handles region-specific endpoints dynamically
    },
    
    box: {
        clientId: 'd0374ba6pgmaguie02ge15sv1mllndho',
        clientSecret: obscure.mustReveal(BOX_OBSCURED_SECRET),
        authURL: 'https://app.box.com/api/oauth2/authorize',
        tokenURL: 'https://api.box.com/api/oauth2/token',
        scopes: [], // Box doesn't require scopes in OAuth URL
        accountInfoURL: 'https://api.box.com/2.0/users/me',
        // Box uses standard OAuth2 flow
    },
    
    pcloud: {
        clientId: 'DnONSzyJXpm',
        clientSecret: obscure.mustReveal(PCLOUD_OBSCURED_SECRET),
        authURL: 'https://my.pcloud.com/oauth2/authorize',
        tokenURL: 'https://api.pcloud.com/oauth2_token',
        scopes: [], // pCloud doesn't require scopes
        accountInfoURL: 'https://api.pcloud.com/userinfo',
        // pCloud uses standard OAuth2 flow
        // Note: TokenURL is hostname-dependent, but we use default api.pcloud.com
    },
    
    yandex: {
        clientId: 'ac39b43b9eba4cae8ffb788c06d816a8',
        clientSecret: obscure.mustReveal(YANDEX_OBSCURED_SECRET),
        authURL: 'https://oauth.yandex.com/authorize',
        tokenURL: 'https://oauth.yandex.com/token',
        scopes: [], // Yandex doesn't require scopes in OAuth URL
        accountInfoURL: 'https://login.yandex.ru/info',
        // Yandex uses standard OAuth2 flow
        // Uses RedirectURL (127.0.0.1:53682)
    },
    
    hidrive: {
        clientId: '6b0258fdda630d34db68a3ce3cbf19ae',
        clientSecret: obscure.mustReveal(HIDRIVE_OBSCURED_SECRET),
        authURL: 'https://my.hidrive.com/client/authorize',
        tokenURL: 'https://my.hidrive.com/oauth2/token',
        scopes: [], // Scopes are dynamically generated based on scope_role and scope_access options
        // HiDrive uses TitleBarRedirectURL (urn:ietf:wg:oauth:2.0:oob) - manual code entry
        // Note: This requires special handling - user must manually copy code from browser title bar
        // For now, we'll use standard redirect URL and handle it if needed
    },
    
    jottacloud: {
        // Jottacloud uses OpenID Connect and supports multiple services
        // Default client ID for Jottacloud main service
        clientId: 'jottacli', // Can be overridden by user
        clientSecret: '', // Jottacloud uses device registration, no default secret
        // Auth URL and Token URL are determined dynamically based on service
        // Default to Jottacloud main service
        authURL: 'https://id.jottacloud.com/auth/realms/jottacloud/protocol/openid-connect/auth',
        tokenURL: 'https://id.jottacloud.com/auth/realms/jottacloud/protocol/openid-connect/token',
        scopes: ['openid', 'jotta-default', 'offline_access'],
        // Uses RedirectLocalhostURL (localhost:53682)
        // Note: Jottacloud requires device registration for new clients
        // Legacy OAuth is also supported with:
        //   legacyClientID: 'nibfk8biu12ju7hpqomr8b1e40'
        //   legacyEncryptedClientSecret: 'Vp8eAv7eVElMnQwN-kgU9cbhgApNDaMqWdlDi5qFydlQoji4JBxrGMF2'
    },
    
    mailru: {
        clientId: 'cloud-win',
        clientSecret: '', // Mail.ru doesn't use client secret in OAuth flow
        authURL: 'https://o2.mail.ru/token',
        tokenURL: 'https://o2.mail.ru/token',
        scopes: [], // Mail.ru doesn't require scopes
        // Mail.ru uses AuthStyleInParams (client_id and token in request body, not Basic Auth)
        // Note: Mail.ru OAuth is unusual - same URL for auth and token exchange
        // Uses username/password for initial auth, then OAuth token for API calls
    },
    
    gphotos: {
        clientId: '202264815644-rt1o1c9evjaotbpbab10m83i8cnjk077.apps.googleusercontent.com',
        clientSecret: obscure.mustReveal(GPHOTOS_OBSCURED_SECRET),
        authURL: 'https://accounts.google.com/o/oauth2/auth',
        tokenURL: 'https://oauth2.googleapis.com/token',
        scopes: [
            'openid',
            'profile',
            'https://www.googleapis.com/auth/photoslibrary.appendonly',
            'https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata',
            'https://www.googleapis.com/auth/photoslibrary.edit.appcreateddata'
        ],
        accountInfoURL: 'https://www.googleapis.com/oauth2/v2/userinfo',
        // Google Photos uses standard Google OAuth endpoints
        // Uses RedirectURL (127.0.0.1:53682)
    },
    
    gcs: {
        clientId: '202264815644.apps.googleusercontent.com',
        clientSecret: obscure.mustReveal(GCS_OBSCURED_SECRET),
        authURL: 'https://accounts.google.com/o/oauth2/auth',
        tokenURL: 'https://oauth2.googleapis.com/token',
        scopes: [
            'https://www.googleapis.com/auth/devstorage.read_write'
        ],
        accountInfoURL: 'https://www.googleapis.com/oauth2/v2/userinfo',
        // Google Cloud Storage uses standard Google OAuth endpoints
        // Uses RedirectURL (127.0.0.1:53682)
    },
    
    pikpak: {
        clientId: 'YUMx5nI8ZU8Ap8pm',
        clientSecret: '', // PikPak doesn't use client secret (uses username/password)
        authURL: 'https://user.mypikpak.com/v1/auth/signin',
        tokenURL: 'https://user.mypikpak.com/v1/auth/token',
        scopes: [], // PikPak doesn't require scopes
        // PikPak uses AuthStyleInParams (client_id in request body)
        // Note: PikPak uses username/password authentication, not standard authorization code flow
        // Uses RedirectURL (127.0.0.1:53682)
    },
    
    premiumizeme: {
        clientId: '658922194',
        clientSecret: obscure.mustReveal(PREMIUMIZEME_OBSCURED_SECRET),
        authURL: 'https://www.premiumize.me/authorize',
        tokenURL: 'https://www.premiumize.me/token',
        scopes: [], // premiumize.me doesn't require scopes
        accountInfoURL: 'https://www.premiumize.me/api/account/info',
        // premiumize.me uses standard OAuth2 flow
        // Uses RedirectURL (127.0.0.1:53682)
    },
    
    putio: {
        clientId: '4131',
        clientSecret: obscure.mustReveal(PUTIO_OBSCURED_SECRET),
        authURL: 'https://api.put.io/v2/oauth2/authenticate',
        tokenURL: 'https://api.put.io/v2/oauth2/access_token',
        scopes: [], // Put.io doesn't require scopes
        accountInfoURL: 'https://api.put.io/v2/account/info',
        // Put.io uses standard OAuth2 flow
        // Uses RedirectLocalhostURL (localhost:53682)
        // Note: Put.io uses NoOffline (no refresh token)
    },
    
    sharefile: {
        clientId: 'djQUPlHTUM9EvayYBWuKC5IrVIoQde46',
        clientSecret: obscure.mustReveal(SHAREFILE_OBSCURED_SECRET),
        authURL: 'https://secure.sharefile.com/oauth/authorize',
        tokenURL: '', // Token URL is dynamically determined based on subdomain/apicp from authorization response
        scopes: [], // ShareFile doesn't require scopes
        // ShareFile uses RedirectPublicSecureURL (https://oauth.rclone.org/) in Rclone
        // For web-based flow, we'll use standard redirect URI
        // Note: ShareFile requires CheckAuth callback to extract subdomain and apicp
        // The token URL is then: https://{subdomain}.{apicp}/oauth/token
    },
    
    zoho: {
        clientId: '1000.46MXF275FM2XV7QCHX5A7K3LGME66B',
        clientSecret: obscure.mustReveal(ZOHO_OBSCURED_SECRET),
        authURL: 'https://accounts.zoho.eu/oauth/v2/auth',
        tokenURL: 'https://accounts.zoho.eu/oauth/v2/token',
        scopes: [
            'aaaserver.profile.read',
            'WorkDrive.team.READ',
            'WorkDrive.workspace.READ',
            'WorkDrive.files.ALL',
            'ZohoFiles.files.ALL'
        ],
        // Zoho uses AuthStyleInParams (client_id and client_secret in request body)
        // Uses RedirectLocalhostURL (localhost:53682)
        // Note: Zoho requires ApprovalForce option to get refresh tokens
        // Token type must be "Zoho-oauthtoken" (not "Bearer")
    }
};

