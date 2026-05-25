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
 *
 * When the underlying error came from rclone-rcd (an axios error), we lift
 * the RCD response body up into our own message so the UI shows a useful
 * reason instead of the bare "Request failed with status code 500".
 */
function sendError(res, error, context) {
    let status = error.status || (
        ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'].includes(error.code) ? 503 : 500
    );

    // If this is an axios error from a downstream call (rclone-rcd or Graph),
    // pull the real message out of error.response.data so we don't show the
    // generic "Request failed with status code 500" wrapper.
    let message = error.message || 'Internal Server Error';
    let rcdStatus = null;
    let rcdBody = null;
    if (error.response) {
        rcdStatus = error.response.status;
        rcdBody = error.response.data;
        const detail =
            (rcdBody && (rcdBody.error || rcdBody.message || rcdBody.error_description)) ||
            (typeof rcdBody === 'string' ? rcdBody : null);
        if (detail) {
            message = `rclone backend (HTTP ${rcdStatus}): ${detail}`;
        } else if (rcdStatus) {
            message = `rclone backend returned HTTP ${rcdStatus}`;
        }
        // For 409-ish conflicts surface them as 409, not 500.
        if (!error.status && rcdStatus >= 400 && rcdStatus < 500) {
            status = rcdStatus;
        }
    }

    const payload = {
        error: message,
        code: error.code || undefined,
        context
    };
    if (rcdBody && process.env.NODE_ENV !== 'production') {
        payload.rclone = rcdBody;
    }
    if (process.env.NODE_ENV === 'development' && error.graph) {
        payload.graph = error.graph;
    }
    console.error(`[ONEDRIVE] ${context || 'error'}: ${message}`,
        rcdBody ? ` | rcd body: ${JSON.stringify(rcdBody).slice(0, 500)}` : '');
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

        // Run three Graph calls in parallel: personal drives, sites, account.
        // They share the OAuth token; any may independently trigger a refresh
        // on 401. We surface the account info so the picker can show *whose*
        // token will be reused — critical when the user has multiple OneDrive
        // remotes for different accounts and shouldn't have to guess.
        const [personalResult, sitesResult, accountResult] = await Promise.allSettled([
            creds.provider.listPersonalDrives(creds.accessToken, creds.refreshToken, {
                clientId: creds.clientId, clientSecret: creds.clientSecret, region: creds.region
            }),
            creds.provider.searchSites(creds.accessToken, creds.refreshToken, {
                clientId: creds.clientId, clientSecret: creds.clientSecret, region: creds.region
            }, '*'),
            creds.provider.getAccountInfo(creds.accessToken, creds.refreshToken, {
                clientId: creds.clientId, clientSecret: creds.clientSecret, region: creds.region
            })
        ]);

        const personal = personalResult.status === 'fulfilled'
            ? personalResult.value
            : { drives: [], newToken: null, error: personalResult.reason?.message || 'Failed to list personal drives' };

        const sites = sitesResult.status === 'fulfilled'
            ? sitesResult.value
            : { sites: [], newToken: null, restricted: false, error: sitesResult.reason?.message || 'Failed to list sites' };

        let account = null;
        let accountNewToken = null;
        if (accountResult.status === 'fulfilled') {
            const v = accountResult.value;
            account = v?.accountInfo || v || null;
            accountNewToken = v?.newToken || null;
        }

        // If any call refreshed the token, persist it once.
        const newToken = personal.newToken || sites.newToken || accountNewToken;
        if (newToken) {
            await persistRefreshedToken(server, password, remoteName, creds.rawConfig, newToken);
        }

        res.json({
            success: true,
            personal: { drives: personal.drives || [], error: personal.error || null },
            sites: sites.sites || [],
            restricted: !!sites.restricted,
            sitesError: sites.error || null,
            current: { drive_id: creds.currentDriveId, drive_type: creds.currentDriveType },
            account
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

        // Build the parameters block for the new remote.
        //
        // We DO NOT spread the entire source config — that risks copying
        // internal/computed rclone fields (or unexpected types) that
        // config/create will reject with an opaque 500. Instead, copy only an
        // explicit allowlist of OneDrive-relevant settings, then stamp the
        // token + the new drive_id / drive_type on top.
        const COPY_KEYS = [
            'auth_url', 'token_url', 'tenant',
            'chunk_size', 'upload_cutoff',
            'expose_onenote_files', 'server_side_across_configs',
            'no_versions', 'link_scope', 'link_type', 'link_password',
            'list_chunk', 'hash_type', 'av_override',
            'access_scopes', 'disable_site_permission',
            'root_folder_id', 'metadata_permissions',
            'delta', 'hard_delete'
        ];
        const src = (creds.rawConfig.parameters && Object.keys(creds.rawConfig.parameters).length > 0)
            ? creds.rawConfig.parameters
            : creds.rawConfig;

        const newParameters = {};
        for (const key of COPY_KEYS) {
            const v = src && src[key];
            // Only copy primitive, non-empty values — rclone rejects objects
            // and is happier with absent keys than with empty strings.
            if (v === undefined || v === null || v === '') continue;
            if (typeof v === 'object') continue;
            newParameters[key] = typeof v === 'string' ? v : String(v);
        }

        // Required OAuth + drive identification fields, always stamped fresh.
        newParameters.token = creds.tokenString;
        if (creds.region) newParameters.region = creds.region;
        if (creds.clientId) newParameters.client_id = creds.clientId;
        if (creds.clientSecret) newParameters.client_secret = creds.clientSecret;
        newParameters.drive_id = drive_id.trim();
        newParameters.drive_type = normalizedDriveType;

        console.log(`[ONEDRIVE] Cloning "${sourceName}" → "${safeNewName}"`,
            `keys=${Object.keys(newParameters).join(',')}`,
            `drive_type=${normalizedDriveType}`);

        // rclone-rcd's config/create is known to write the on-disk config and
        // THEN attempt a token-validation round-trip; that validation can fail
        // for OneDrive (e.g. an expired access_token, or Graph being briefly
        // unreachable) and bubble up as an HTTP 500 even though the new remote
        // is already saved. So we don't trust the HTTP status alone — after
        // any failure, we re-list remotes and treat "the new name is now
        // present" as success.
        let createDidThrow = null;
        try {
            await rcConfigCreate(server, password, {
                name: safeNewName,
                type: 'onedrive',
                parameters: newParameters
            });
        } catch (createErr) {
            createDidThrow = createErr;
        }

        if (createDidThrow) {
            console.warn(`[ONEDRIVE] config/create for "${safeNewName}" reported error: ${createDidThrow.message}` +
                (createDidThrow.response?.status ? ` (HTTP ${createDidThrow.response.status})` : '') +
                ` — verifying whether the remote was actually written...`);

            // Give rcd a moment to finish writing rclone.conf, then re-list.
            await new Promise(r => setTimeout(r, 500));
            let createdAnyway = false;
            try {
                const remotesAfter = await rcListRemotes(server, password);
                createdAnyway = remotesAfter.includes(safeNewName);
            } catch (listErr) {
                console.warn(`[ONEDRIVE] post-create listremotes failed:`, listErr.message);
            }

            if (createdAnyway) {
                console.log(`[ONEDRIVE] config/create for "${safeNewName}" returned an error but the remote ` +
                    `exists in rclone.conf — treating as success.`);
            } else {
                // Genuine failure — surface the real rcd body to the UI.
                const wrapped = new Error(
                    createDidThrow.response?.data?.error
                    || createDidThrow.response?.data?.message
                    || createDidThrow.message
                    || 'config/create failed'
                );
                wrapped.response = createDidThrow.response;
                wrapped.code = createDidThrow.code;
                wrapped.status = createDidThrow.response?.status >= 400 && createDidThrow.response?.status < 500
                    ? createDidThrow.response.status
                    : 500;
                throw wrapped;
            }
        }

        // Best-effort verification: read the new remote's token back, hit
        // /me to confirm which account it actually belongs to. This catches
        // the multi-account-mixup case where the user clicked clone on a
        // remote that wasn't the one they thought it was.
        let verifyAccount = null;
        try {
            const verify = await creds.provider.getAccountInfo(
                creds.accessToken, creds.refreshToken,
                { clientId: creds.clientId, clientSecret: creds.clientSecret, region: creds.region }
            );
            // getAccountInfo returns { email, name } directly OR { accountInfo, newToken } when it refreshed
            verifyAccount = verify?.accountInfo || verify || null;
        } catch (verifyErr) {
            console.warn(`[ONEDRIVE] Post-clone verify failed (clone still created):`, verifyErr.message);
        }

        console.log(`[ONEDRIVE] Cloned remote "${sourceName}" → "${safeNewName}" with drive_id=${drive_id} drive_type=${normalizedDriveType}` +
            (verifyAccount ? ` (account: ${verifyAccount.email || verifyAccount.name})` : ''));
        res.json({
            success: true,
            name: safeNewName,
            source_remote: sourceName,
            drive_id: drive_id,
            drive_type: normalizedDriveType,
            account: verifyAccount
        });
    } catch (error) {
        sendError(res, error, 'clone-remote');
    }
});

module.exports = router;
