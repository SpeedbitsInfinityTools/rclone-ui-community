/**
 * OneDrive / SharePoint Discovery Routes
 *
 * Powers the SharePoint location picker in the wizard and Show Config:
 *   POST /discover-locations  - personal drive + first page of SharePoint sites
 *   POST /search-sites        - search-as-you-type
 *   POST /resolve-site-url    - look up a site by its sharepoint.com URL
 *                               (fallback for tenants without Sites.Read.All)
 *   POST /list-site-drives    - list document libraries inside a site
 *   POST /clone-remote        - create a new remote with the same OAuth token
 *                               but a different drive_id / drive_type
 *
 * All endpoints require an authenticated admin session and reuse the OneDrive
 * remote's stored OAuth token — no re-authentication is ever needed.
 */

const express = require('express');
const router = express.Router();

const auth = require('../auth');
const {
    loadOneDriveCredentials,
    persistRefreshedToken,
    resolveServer,
    rcConfigGet,
    rcConfigCreate,
    rcListRemotes
} = require('../services/onedrive.service');

/** Validation: a SharePoint site_id is a composite "host,guid,guid" string. */
const SITE_ID_RE = /^[A-Za-z0-9_.-]+(?:\.[A-Za-z0-9_.-]+)+,[0-9a-f-]+,[0-9a-f-]+$/i;

/**
 * Map a thrown error to an HTTP response. Errors raised by the service /
 * provider layers carry an optional `.status`. Otherwise we map common
 * connection problems to 503 and everything else to 500.
 */
function sendError(res, error, context) {
    const status = error.status || (
        ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'].includes(error.code) ? 503 : 500
    );
    const payload = {
        error: error.message || 'Internal Server Error',
        code: error.code || undefined,
        context
    };
    if (process.env.NODE_ENV === 'development' && error.graph) {
        payload.graph = error.graph;
    }
    console.error(`[ONEDRIVE] ${context || 'error'}:`, error.message);
    res.status(status).json(payload);
}

/**
 * POST /discover-locations
 * Body: { remote_name }
 * Returns { personal: { drives: [...] }, sites: [...], current: {...}, restricted }
 */
router.post('/discover-locations', auth.requireAdminAuth, async (req, res) => {
    try {
        const { remote_name } = req.body || {};
        const { server, password, remoteName, creds } = await loadOneDriveCredentials(req, remote_name);

        // Run the two Graph calls in parallel — they share the OAuth token but
        // each may independently trigger a refresh on 401.
        const [personalResult, sitesResult] = await Promise.allSettled([
            creds.provider.listPersonalDrives(creds.accessToken, creds.refreshToken, {
                clientId: creds.clientId, clientSecret: creds.clientSecret, region: creds.region
            }),
            creds.provider.searchSites(creds.accessToken, creds.refreshToken, {
                clientId: creds.clientId, clientSecret: creds.clientSecret, region: creds.region
            }, '*')
        ]);

        const personal = personalResult.status === 'fulfilled'
            ? personalResult.value
            : { drives: [], newToken: null, error: personalResult.reason?.message || 'Failed to list personal drives' };

        const sites = sitesResult.status === 'fulfilled'
            ? sitesResult.value
            : { sites: [], newToken: null, restricted: false, error: sitesResult.reason?.message || 'Failed to list sites' };

        // If either call refreshed the token, persist it once.
        const newToken = personal.newToken || sites.newToken;
        if (newToken) {
            await persistRefreshedToken(server, password, remoteName, creds.rawConfig, newToken);
        }

        res.json({
            success: true,
            personal: { drives: personal.drives || [], error: personal.error || null },
            sites: sites.sites || [],
            restricted: !!sites.restricted,
            sitesError: sites.error || null,
            current: { drive_id: creds.currentDriveId, drive_type: creds.currentDriveType }
        });
    } catch (error) {
        sendError(res, error, 'discover-locations');
    }
});

/**
 * POST /search-sites
 * Body: { remote_name, query }
 * Returns { sites: [...], restricted }
 */
router.post('/search-sites', auth.requireAdminAuth, async (req, res) => {
    try {
        const { remote_name, query } = req.body || {};
        const { server, password, remoteName, creds } = await loadOneDriveCredentials(req, remote_name);
        const result = await creds.provider.searchSites(
            creds.accessToken, creds.refreshToken,
            { clientId: creds.clientId, clientSecret: creds.clientSecret, region: creds.region },
            typeof query === 'string' ? query : '*'
        );
        if (result.newToken) {
            await persistRefreshedToken(server, password, remoteName, creds.rawConfig, result.newToken);
        }
        res.json({
            success: true,
            sites: result.sites,
            restricted: !!result.restricted
        });
    } catch (error) {
        sendError(res, error, 'search-sites');
    }
});

/**
 * POST /resolve-site-url
 * Body: { remote_name, url }
 * Returns { site: {...} }
 */
router.post('/resolve-site-url', auth.requireAdminAuth, async (req, res) => {
    try {
        const { remote_name, url } = req.body || {};
        const { server, password, remoteName, creds } = await loadOneDriveCredentials(req, remote_name);
        const result = await creds.provider.resolveSiteByUrl(
            creds.accessToken, creds.refreshToken,
            { clientId: creds.clientId, clientSecret: creds.clientSecret, region: creds.region },
            url
        );
        if (result.newToken) {
            await persistRefreshedToken(server, password, remoteName, creds.rawConfig, result.newToken);
        }
        res.json({ success: true, site: result.site });
    } catch (error) {
        sendError(res, error, 'resolve-site-url');
    }
});

/**
 * POST /list-site-drives
 * Body: { remote_name, site_id }
 * Returns { drives: [...] }
 */
router.post('/list-site-drives', auth.requireAdminAuth, async (req, res) => {
    try {
        const { remote_name, site_id } = req.body || {};
        if (typeof site_id !== 'string' || !SITE_ID_RE.test(site_id)) {
            return res.status(400).json({
                error: 'site_id must be a Graph composite "hostname,site-collection-guid,site-guid"',
                code: 'BAD_SITE_ID'
            });
        }
        const { server, password, remoteName, creds } = await loadOneDriveCredentials(req, remote_name);
        const result = await creds.provider.listSiteDrives(
            creds.accessToken, creds.refreshToken,
            { clientId: creds.clientId, clientSecret: creds.clientSecret, region: creds.region },
            site_id
        );
        if (result.newToken) {
            await persistRefreshedToken(server, password, remoteName, creds.rawConfig, result.newToken);
        }
        res.json({ success: true, drives: result.drives });
    } catch (error) {
        sendError(res, error, 'list-site-drives');
    }
});

/**
 * POST /clone-remote
 * Body: { source_remote, new_name, drive_id, drive_type, site_label? }
 *
 * Creates a new rclone remote with the same OAuth credentials as `source_remote`
 * but pointing at a different SharePoint drive. No OAuth round-trip required.
 *
 * Refuses if `new_name` already exists, to avoid silently overwriting unrelated
 * configuration.
 */
router.post('/clone-remote', auth.requireAdminAuth, async (req, res) => {
    try {
        const { source_remote, new_name, drive_id, drive_type } = req.body || {};

        if (typeof new_name !== 'string' || !new_name.trim()) {
            return res.status(400).json({ error: 'new_name is required' });
        }
        const safeNewName = new_name.trim();
        if (!/^[A-Za-z0-9_][A-Za-z0-9_\-.]*$/.test(safeNewName)) {
            return res.status(400).json({
                error: `Invalid new_name "${new_name}" — letters, digits, _-., not starting with - or .`
            });
        }
        if (typeof drive_id !== 'string' || !drive_id.trim()) {
            return res.status(400).json({ error: 'drive_id is required' });
        }
        if (typeof drive_type !== 'string' || !drive_type.trim()) {
            return res.status(400).json({ error: 'drive_type is required' });
        }
        // Rclone only knows three drive types. SharePoint sometimes returns
        // sub-types like `mediaLibrary` for asset libraries — those still work
        // when treated as documentLibrary, so we normalize here rather than
        // rejecting them.
        const KNOWN_RCLONE_TYPES = ['personal', 'business', 'documentLibrary'];
        const normalizedDriveType = KNOWN_RCLONE_TYPES.includes(drive_type)
            ? drive_type
            : 'documentLibrary';

        // Load source credentials (also validates that source is OneDrive).
        const { server, password, remoteName: sourceName, creds } =
            await loadOneDriveCredentials(req, source_remote);

        // Refuse to overwrite an existing remote.
        const remotes = await rcListRemotes(server, password);
        if (remotes.includes(safeNewName)) {
            return res.status(409).json({
                error: `Remote "${safeNewName}" already exists`,
                code: 'NAME_COLLISION'
            });
        }
        if (sourceName === safeNewName) {
            return res.status(409).json({
                error: 'new_name must differ from source_remote',
                code: 'NAME_COLLISION'
            });
        }

        // Build the parameters block from the source remote's parameters,
        // replacing drive_id / drive_type. We keep token, region, client_id
        // and client_secret so the clone authenticates identically.
        const sourceParams = (creds.rawConfig.parameters && Object.keys(creds.rawConfig.parameters).length > 0)
            ? { ...creds.rawConfig.parameters }
            : { ...creds.rawConfig };
        // Strip fields that don't belong in `parameters` for config/create.
        delete sourceParams.name;
        delete sourceParams.type;

        const newParameters = {
            ...sourceParams,
            token: creds.tokenString,
            region: creds.region,
            client_id: creds.clientId || '',
            client_secret: creds.clientSecret || '',
            drive_id: drive_id.trim(),
            drive_type: normalizedDriveType
        };
        // Don't write empty client_id/secret (rclone uses bundled defaults when absent).
        if (!newParameters.client_id) delete newParameters.client_id;
        if (!newParameters.client_secret) delete newParameters.client_secret;

        await rcConfigCreate(server, password, {
            name: safeNewName,
            type: 'onedrive',
            parameters: newParameters
        });

        console.log(`[ONEDRIVE] Cloned remote "${sourceName}" → "${safeNewName}" with drive_id=${drive_id} drive_type=${normalizedDriveType}`);
        res.json({
            success: true,
            name: safeNewName,
            source_remote: sourceName,
            drive_id: drive_id,
            drive_type: normalizedDriveType
        });
    } catch (error) {
        sendError(res, error, 'clone-remote');
    }
});

module.exports = router;
