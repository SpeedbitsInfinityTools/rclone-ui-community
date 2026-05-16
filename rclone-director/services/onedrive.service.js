/**
 * OneDrive / SharePoint Service
 *
 * Helpers for the SharePoint-picker feature. Resolves an admin-authenticated
 * RCD server, reads a OneDrive remote's stored OAuth credentials from rclone.conf
 * via `config/get`, and writes a refreshed token back via `config/update` so
 * subsequent calls don't keep refreshing. Also clones a OneDrive remote into a
 * second remote that points at a different SharePoint drive while sharing the
 * same OAuth token (no re-authentication needed).
 *
 * Token-refresh persistence note:
 *   When a Microsoft Graph call returns 401, the OneDriveProvider helpers
 *   transparently exchange the refresh_token for a new access_token. They
 *   return that new token back to us so we can call `config/update` on the
 *   source remote. RCD itself also refreshes tokens during its own API
 *   activity, so a stale-but-still-valid refresh_token in one remote
 *   self-heals on the next operation. The persistence step here just avoids
 *   one extra round-trip on subsequent picker calls.
 */

const auth = require('../auth');
const { loadServers } = require('./data.service');
const { axiosInstance } = require('./server.service');
const OneDriveProvider = require('../oauth/providers/onedrive');

/**
 * Resolve the target RCD server for a request.
 * Header `x-rclone-server` takes precedence; otherwise the default server is used.
 * Returns { server, password } where `password` is the decrypted plaintext.
 *
 * Throws an error with `.status` set to 503 / 401 if we can't.
 */
async function resolveServer(req) {
    const adminPassword = req.adminPassword;
    if (!adminPassword) {
        throw Object.assign(new Error('Admin session not initialized'), { status: 401 });
    }
    const config = await loadServers();
    const serverId = req.headers['x-rclone-server'] || null;
    const server = serverId
        ? config.servers.find(s => s.id === serverId)
        : (config.servers.find(s => s.id === (config.defaultServerId || 'default')) || config.servers[0]);

    if (!server) {
        throw Object.assign(
            new Error('No rclone backend server is configured. Add one in Menu → Rclone Servers.'),
            { status: 503, code: 'NO_SERVER_CONFIGURED' }
        );
    }

    let password = server.password;
    if (server.encryptedPassword) {
        try {
            password = auth.decryptPassword(server.encryptedPassword, adminPassword);
        } catch (e) {
            throw Object.assign(
                new Error('Failed to decrypt server credentials (wrong admin password?)'),
                { status: 401 }
            );
        }
    }
    return { server, password };
}

/**
 * Call rclone RC `config/get` for a named remote.
 * Returns the raw response body (which has token, drive_id, etc. either at the
 * top level or under `parameters`, depending on rclone version).
 */
async function rcConfigGet(server, password, name) {
    const response = await axiosInstance.post(
        `${server.url}/config/get`,
        { name },
        { auth: { username: server.username, password }, timeout: 10000 }
    );
    return response.data;
}

/**
 * Call rclone RC `config/update`.
 */
async function rcConfigUpdate(server, password, payload) {
    return axiosInstance.post(
        `${server.url}/config/update`,
        payload,
        { auth: { username: server.username, password }, timeout: 15000 }
    );
}

/**
 * Call rclone RC `config/create`.
 */
async function rcConfigCreate(server, password, payload) {
    return axiosInstance.post(
        `${server.url}/config/create`,
        payload,
        { auth: { username: server.username, password }, timeout: 15000 }
    );
}

/**
 * Call rclone RC `config/listremotes`.
 */
async function rcListRemotes(server, password) {
    const response = await axiosInstance.post(
        `${server.url}/config/listremotes`,
        {},
        { auth: { username: server.username, password }, timeout: 10000 }
    );
    return Array.isArray(response.data?.remotes) ? response.data.remotes : [];
}

/**
 * Extract OneDrive OAuth credentials from a remote config returned by
 * `config/get`. Returns the fields we need to talk to Microsoft Graph.
 *
 * Throws with .status=400 if this isn't a OneDrive remote, .status=404 if
 * the remote has no usable token.
 */
function extractOneDriveCredentials(remoteName, configFromRcd) {
    if (!configFromRcd || typeof configFromRcd !== 'object') {
        throw Object.assign(new Error(`Remote "${remoteName}" not found`), { status: 404 });
    }
    const type = configFromRcd.type || configFromRcd.parameters?.type;
    if (type !== 'onedrive') {
        throw Object.assign(
            new Error(`Remote "${remoteName}" is type "${type}", not "onedrive"`),
            { status: 400, code: 'WRONG_TYPE' }
        );
    }
    const tokenString = configFromRcd.token || configFromRcd.parameters?.token;
    if (!tokenString) {
        throw Object.assign(
            new Error(`Remote "${remoteName}" has no OAuth token. Authenticate the remote first.`),
            { status: 404, code: 'NO_TOKEN' }
        );
    }
    let tokenJson;
    try {
        tokenJson = typeof tokenString === 'string' ? JSON.parse(tokenString) : tokenString;
    } catch (e) {
        throw Object.assign(
            new Error(`Remote "${remoteName}" has malformed token JSON in rclone.conf`),
            { status: 500, code: 'BAD_TOKEN' }
        );
    }
    const provider = new OneDriveProvider();
    return {
        provider,
        tokenString: typeof tokenString === 'string' ? tokenString : JSON.stringify(tokenString),
        accessToken: tokenJson.access_token,
        refreshToken: tokenJson.refresh_token || null,
        region: configFromRcd.region || configFromRcd.parameters?.region || 'global',
        clientId: configFromRcd.client_id || configFromRcd.parameters?.client_id || provider.config.clientId,
        clientSecret: configFromRcd.client_secret || configFromRcd.parameters?.client_secret || provider.config.clientSecret,
        currentDriveId: configFromRcd.drive_id || configFromRcd.parameters?.drive_id || null,
        currentDriveType: configFromRcd.drive_type || configFromRcd.parameters?.drive_type || null,
        // Raw config so callers building update payloads have everything they need.
        rawConfig: configFromRcd
    };
}

/**
 * Persist a refreshed OAuth token back to the source remote via config/update.
 * Safe to call even if `newToken` is null (no-op).
 *
 * Best-effort: logs but never throws. A failure here only means the next
 * picker call will need to refresh again — not a hard failure.
 */
async function persistRefreshedToken(server, password, remoteName, rawConfig, newToken) {
    if (!newToken || !newToken.access_token) return;
    try {
        const refreshedTokenString = JSON.stringify(newToken);
        let updatePayload;
        if (rawConfig.parameters && Object.keys(rawConfig.parameters).length > 0) {
            updatePayload = {
                name: remoteName,
                parameters: { ...rawConfig.parameters, token: refreshedTokenString }
            };
        } else {
            const rootFields = { ...rawConfig, token: refreshedTokenString };
            delete rootFields.name;
            updatePayload = { name: remoteName, parameters: rootFields };
        }
        await rcConfigUpdate(server, password, updatePayload);
        console.log(`[OneDrive] Persisted refreshed token for "${remoteName}"`);
    } catch (e) {
        console.warn(`[OneDrive] Failed to persist refreshed token for "${remoteName}":`, e.message);
    }
}

/**
 * Load credentials for a remote — convenience that combines resolveServer +
 * rcConfigGet + extractOneDriveCredentials.
 *
 * Returns { server, password, remoteName, creds }.
 */
async function loadOneDriveCredentials(req, remoteName) {
    if (typeof remoteName !== 'string' || !remoteName.trim()) {
        throw Object.assign(new Error('remote_name is required'), { status: 400 });
    }
    const safeName = remoteName.trim();
    if (!/^[A-Za-z0-9_][A-Za-z0-9_\-.]*$/.test(safeName)) {
        throw Object.assign(
            new Error(`Invalid remote name "${remoteName}" (allowed: letters, digits, _-., must not start with - or .)`),
            { status: 400 }
        );
    }
    const { server, password } = await resolveServer(req);
    const rawConfig = await rcConfigGet(server, password, safeName);
    const creds = extractOneDriveCredentials(safeName, rawConfig);
    return { server, password, remoteName: safeName, creds };
}

module.exports = {
    resolveServer,
    rcConfigGet,
    rcConfigUpdate,
    rcConfigCreate,
    rcListRemotes,
    extractOneDriveCredentials,
    persistRefreshedToken,
    loadOneDriveCredentials
};
