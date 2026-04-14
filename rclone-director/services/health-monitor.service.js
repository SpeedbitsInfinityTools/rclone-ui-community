/**
 * Health Monitor Service for Rclone Director
 * 
 * Periodically checks all configured rclone servers for:
 * - RCD connectivity (POST /rc/noop)
 * - Mount health (POST /mount/listmounts + test read)
 * - Authentication errors (parse error messages for auth keywords)
 * 
 * Sends ntfy notifications with 24-hour deduplication per unique error.
 */

const fs = require('fs').promises;
const path = require('path');
const { DATA_DIR } = require('../config/constants');
const dataService = require('./data.service');
const { axiosInstance } = require('./server.service');
const ntfyService = require('./ntfy.service');
const auth = require('../auth');

const STATE_FILE = path.join(DATA_DIR, 'notification-state.json');
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_LOG_ENTRIES = 100;

const AUTH_ERROR_KEYWORDS = [
    'token expired', 'tokenexpired', 'credential', 'unauthorized',
    'forbidden', 'sas', 'sharedkey', 'authentication', 'auth failed',
    'access denied', 'invalid_grant', 'refresh token', 'oauth',
    '401', '403', 'signature', 'authorizationpermissionmismatch',
    'authenticationfailed', 'server failed to authenticate',
    'signed expiry time', 'not yet valid', 'token has expired'
];

function sanitizeNotificationMessage(input) {
    const text = String(input || '');
    return text
        .replace(/(access_token|refresh_token|id_token|token|password|secret|authorization)\s*[:=]\s*[^,\s"']+/gi, '$1=***')
        .replace(/(Bearer\s+)[^\s"']+/gi, '$1***')
        .replace(/([?&](?:access_token|refresh_token|token|code|state)=)[^&\s]+/gi, '$1***')
        .slice(0, 1200);
}

let interval = null;
let running = false;
let lastCheckTime = null;
let lastCheckResults = null;

// In-memory state, persisted to disk
let dedupMap = {};   // { errorKey: lastNotifiedTimestamp }
let notifLog = [];   // Recent notification entries
let serverDownState = {}; // { serverId: true } tracks which servers are known down

async function loadState() {
    try {
        const data = await fs.readFile(STATE_FILE, 'utf8');
        const state = JSON.parse(data);
        dedupMap = state.dedupMap || {};
        notifLog = state.log || [];
        serverDownState = state.serverDownState || {};
        cleanupOldDedupEntries();
    } catch {
        dedupMap = {};
        notifLog = [];
        serverDownState = {};
    }
}

async function saveState() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        await fs.writeFile(STATE_FILE, JSON.stringify({
            dedupMap,
            log: notifLog.slice(0, MAX_LOG_ENTRIES),
            serverDownState
        }, null, 2));
    } catch (error) {
        console.error('[HEALTH-MONITOR] Failed to save state:', error.message);
    }
}

function cleanupOldDedupEntries() {
    const now = Date.now();
    for (const key of Object.keys(dedupMap)) {
        if (now - dedupMap[key] > DEDUP_WINDOW_MS) {
            delete dedupMap[key];
        }
    }
}

function shouldNotify(errorKey) {
    const lastNotified = dedupMap[errorKey];
    if (!lastNotified) return true;
    return (Date.now() - lastNotified) > DEDUP_WINDOW_MS;
}

function markNotified(errorKey) {
    dedupMap[errorKey] = Date.now();
}

function addLogEntry(entry) {
    notifLog.unshift({
        timestamp: new Date().toISOString(),
        ...entry
    });
    if (notifLog.length > MAX_LOG_ENTRIES) {
        notifLog = notifLog.slice(0, MAX_LOG_ENTRIES);
    }
}

function isAuthError(errorMessage) {
    if (!errorMessage) return false;
    const lower = errorMessage.toLowerCase();
    return AUTH_ERROR_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Resolve the plaintext password for a server, handling encrypted passwords.
 */
function getServerPassword(server) {
    if (server.password && !server.encryptedPassword) {
        return server.password;
    }
    if (server.encryptedPassword) {
        const activeMasterKey = auth.getAnyActiveMasterKey();
        if (activeMasterKey) {
            try {
                return auth.decryptPassword(server.encryptedPassword, activeMasterKey);
            } catch {
                // fall through to env fallback
            }
        }

        const envAdminPassword = process.env.ADMIN_PASSWORD;
        if (envAdminPassword) {
            try {
                return auth.decryptPassword(server.encryptedPassword, envAdminPassword);
            } catch {
                // fall through
            }
        }
        return null;
    }
    return server.password || null;
}

/**
 * Check a single rclone server
 */
async function checkServer(server) {
    const serverId = server.id;
    const serverName = server.name || serverId;
    const password = getServerPassword(server);
    const results = { server: serverName, serverId, checks: [] };

    if (!password) {
        results.checks.push({ type: 'connectivity', status: 'skipped', message: 'Cannot decrypt password' });
        return results;
    }

    // 1. Connectivity check: POST /rc/noop
    try {
        await axiosInstance.post(`${server.url}/rc/noop`, {}, {
            auth: { username: server.username, password },
            timeout: 5000
        });

        results.checks.push({ type: 'connectivity', status: 'ok' });

        // Server is up - send recovery notification if it was previously down
        if (serverDownState[serverId]) {
            delete serverDownState[serverId];
            const errorKey = `${serverName}:rclone_recovered`;
            if (shouldNotify(errorKey)) {
                const msg = `Rclone server "${serverName}" (${server.url}) is back online.`;
                const sendResult = await ntfyService.sendNotification('rclone_recovered', {
                    title: `Rclone Recovered: ${serverName}`,
                    message: msg
                });
                if (sendResult.success) {
                    markNotified(errorKey);
                }
                addLogEntry({ server: serverName, type: 'rclone_recovered', message: msg, sent: sendResult.success });
            }
        }

    } catch (error) {
        const errMsg = error.message || 'Unknown error';
        const safeErrMsg = sanitizeNotificationMessage(errMsg);
        results.checks.push({ type: 'connectivity', status: 'error', message: errMsg });

        // Mark server as down
        const wasDown = serverDownState[serverId];
        serverDownState[serverId] = true;

        if (!wasDown) {
            const errorKey = `${serverName}:rclone_down`;
            if (shouldNotify(errorKey)) {
                const msg = `Rclone server "${serverName}" (${server.url}) is unreachable: ${safeErrMsg}`;
                const sendResult = await ntfyService.sendNotification('rclone_down', {
                    title: `Rclone Down: ${serverName}`,
                    message: msg
                });
                if (sendResult.success) {
                    markNotified(errorKey);
                }
                addLogEntry({ server: serverName, type: 'rclone_down', message: msg, sent: sendResult.success });
            }
        }

        return results; // Skip mount checks if server is down
    }

    // 2. Mount health check: POST /mount/listmounts
    try {
        const mountsResponse = await axiosInstance.post(`${server.url}/mount/listmounts`, {}, {
            auth: { username: server.username, password },
            timeout: 10000
        });

        const mountPoints = mountsResponse.data?.mountPoints || [];
        results.checks.push({ type: 'mounts_list', status: 'ok', count: mountPoints.length });

        // 3. For each mount, try listing the root to detect auth errors
        for (const mount of mountPoints) {
            const fs = mount.Fs || '';
            const mountPoint = mount.MountPoint || '';

            try {
                await axiosInstance.post(`${server.url}/operations/list`, {
                    fs: fs,
                    remote: ''
                }, {
                    auth: { username: server.username, password },
                    timeout: 10000
                });
                results.checks.push({ type: 'mount_read', status: 'ok', mount: mountPoint, fs });
            } catch (mountError) {
                const mountErrMsg = mountError.response?.data?.error || mountError.message || '';
                const safeMountErrMsg = sanitizeNotificationMessage(mountErrMsg);
                results.checks.push({ type: 'mount_read', status: 'error', mount: mountPoint, fs, message: mountErrMsg });

                if (isAuthError(mountErrMsg)) {
                    const errorKey = `${serverName}:auth_error:${fs}`;
                    if (shouldNotify(errorKey)) {
                        const msg = `Authentication error on "${fs}" (server: ${serverName}): ${safeMountErrMsg}`;
                        const sendResult = await ntfyService.sendNotification('auth_error', {
                            title: `Auth Error: ${fs} on ${serverName}`,
                            message: msg
                        });
                        if (sendResult.success) {
                            markNotified(errorKey);
                        }
                        addLogEntry({ server: serverName, type: 'auth_error', fs, message: msg, sent: sendResult.success });
                    }
                } else {
                    const errorKey = `${serverName}:mount_error:${mountPoint}`;
                    if (shouldNotify(errorKey)) {
                        const msg = `Mount error at "${mountPoint}" (${fs}) on server "${serverName}": ${safeMountErrMsg}`;
                        const sendResult = await ntfyService.sendNotification('mount_error', {
                            title: `Mount Error: ${mountPoint} on ${serverName}`,
                            message: msg
                        });
                        if (sendResult.success) {
                            markNotified(errorKey);
                        }
                        addLogEntry({ server: serverName, type: 'mount_error', mount: mountPoint, message: msg, sent: sendResult.success });
                    }
                }
            }
        }
    } catch (error) {
        const errMsg = error.response?.data?.error || error.message || '';
        const safeErrMsg = sanitizeNotificationMessage(errMsg);
        results.checks.push({ type: 'mounts_list', status: 'error', message: errMsg });

        // FUSE not installed is not a notification-worthy error
        if (!errMsg.toLowerCase().includes('fuse')) {
            const errorKey = `${serverName}:mount_error:listmounts`;
            if (shouldNotify(errorKey)) {
                const msg = `Failed to list mounts on "${serverName}": ${safeErrMsg}`;
                const sendResult = await ntfyService.sendNotification('mount_error', {
                    title: `Mount List Error: ${serverName}`,
                    message: msg
                });
                if (sendResult.success) {
                    markNotified(errorKey);
                }
                addLogEntry({ server: serverName, type: 'mount_error', message: msg, sent: sendResult.success });
            }
        }
    }

    // 4. Probe all configured remotes for auth errors (catches expired tokens on unmounted remotes)
    try {
        const configDump = await axiosInstance.post(`${server.url}/config/dump`, {}, {
            auth: { username: server.username, password },
            timeout: 10000
        });

        const remotes = configDump.data || {};
        const remoteNames = Object.keys(remotes);
        // Skip remotes already tested via mounts above
        const mountedFs = new Set();
        try {
            const mountsResp = await axiosInstance.post(`${server.url}/mount/listmounts`, {}, {
                auth: { username: server.username, password },
                timeout: 5000
            });
            for (const m of (mountsResp.data?.mountPoints || [])) {
                if (m.Fs) mountedFs.add(m.Fs.replace(/:$/, ''));
            }
        } catch {
            // Already handled above
        }

        for (const remoteName of remoteNames) {
            if (mountedFs.has(remoteName)) continue;

            const fs = `${remoteName}:`;
            try {
                await axiosInstance.post(`${server.url}/operations/list`, {
                    fs,
                    remote: ''
                }, {
                    auth: { username: server.username, password },
                    timeout: 15000
                });
                results.checks.push({ type: 'remote_auth', status: 'ok', remote: remoteName });
            } catch (remoteError) {
                const remoteErrMsg = remoteError.response?.data?.error || remoteError.message || '';
                const safeRemoteErrMsg = sanitizeNotificationMessage(remoteErrMsg);
                results.checks.push({ type: 'remote_auth', status: 'error', remote: remoteName, message: remoteErrMsg });

                if (isAuthError(remoteErrMsg)) {
                    const errorKey = `${serverName}:auth_error:${remoteName}`;
                    if (shouldNotify(errorKey)) {
                        const msg = `Authentication error on remote "${remoteName}" (server: ${serverName}): ${safeRemoteErrMsg}`;
                        const sendResult = await ntfyService.sendNotification('auth_error', {
                            title: `Auth Error: ${remoteName} on ${serverName}`,
                            message: msg
                        });
                        if (sendResult.success) {
                            markNotified(errorKey);
                        }
                        addLogEntry({ server: serverName, type: 'auth_error', remote: remoteName, message: msg, sent: sendResult.success });
                    }
                }
            }
        }
    } catch (error) {
        // config/dump may not be available on older rclone versions -- non-fatal
        const errMsg = error.response?.data?.error || error.message || '';
        if (!errMsg.includes('couldn\'t find method')) {
            results.checks.push({ type: 'remote_auth', status: 'error', message: errMsg });
        }
    }

    return results;
}

/**
 * Run a full health check across all configured servers
 */
async function runCheck() {
    try {
        const serversConfig = await dataService.loadServers();
        const servers = serversConfig.servers || [];
        const allResults = [];

        for (const server of servers) {
            try {
                const result = await checkServer(server);
                allResults.push(result);
            } catch (error) {
                console.error(`[HEALTH-MONITOR] Error checking server ${server.name}:`, error.message);
                allResults.push({ server: server.name, serverId: server.id, checks: [{ type: 'internal_error', message: error.message }] });
            }
        }

        lastCheckTime = new Date().toISOString();
        lastCheckResults = allResults;

        cleanupOldDedupEntries();
        await saveState();

        return allResults;
    } catch (error) {
        console.error('[HEALTH-MONITOR] Check failed:', error.message);
        return [];
    }
}

function start(intervalSeconds) {
    const ms = Math.max((intervalSeconds || 60), 10) * 1000;
    stop();
    running = true;
    console.log(`[HEALTH-MONITOR] Started (interval: ${ms / 1000}s)`);

    // Run first check after a short delay (let servers settle after startup)
    setTimeout(() => {
        if (running) runCheck();
    }, 5000);

    interval = setInterval(() => {
        if (running) runCheck();
    }, ms);
}

function stop() {
    if (interval) {
        clearInterval(interval);
        interval = null;
    }
    running = false;
    console.log('[HEALTH-MONITOR] Stopped');
}

async function runNow() {
    return await runCheck();
}

function getStatus() {
    return {
        running,
        lastCheckTime,
        lastCheckResults,
        dedupEntries: Object.keys(dedupMap).length,
        serversDown: Object.keys(serverDownState)
    };
}

function getLog() {
    return notifLog;
}

/**
 * Initialize the health monitor (load persisted state, auto-start if configured)
 */
async function initialize() {
    await loadState();
    const config = await ntfyService.loadConfig();
    if (config.monitoring?.enabled && config.enabled) {
        start(config.monitoring.intervalSeconds || 60);
    }
}

module.exports = {
    initialize,
    start,
    stop,
    runNow,
    getStatus,
    getLog
};
