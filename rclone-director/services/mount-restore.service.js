/**
 * Mount Auto-Restore Service
 * ----------------------------------------------------------------------------
 * Re-creates persistent FUSE mounts whenever the underlying rclone process has
 * been restarted (container update, host package upgrade, OOM, manual restart,
 * full reboot, Infinity Tools `--install` re-run, etc.). Without this layer,
 * the "Permanent" checkbox in the Mounts UI only saves metadata; the mount
 * itself dies the moment rclone-rcd exits and an operator must manually
 * re-mount each one.
 *
 * Behaviour:
 *   - On Director startup (after a configurable delay so rclone-rcd has time
 *     to come up too): reconcile once.
 *   - Then on an interval (default 60s ± 10s jitter): reconcile again. The
 *     interval covers the case where the Director is up but rclone-rcd was
 *     restarted out-of-band (e.g. `systemctl restart rclone-ui-backend`, or
 *     a routine `--install` re-run from the installer).
 *   - Reconciliation is idempotent: for each entry in persistent-mounts.json
 *     we check `mount/listmounts` and only re-create entries that are missing.
 *   - Best-effort stale-FUSE cleanup before remount: call rclone-rcd's
 *     `mount/unmount` first (errors swallowed). rclone-rcd runs on the host
 *     and has access to the real `fusermount`, so this clears zombie kernel
 *     mount entries from a prior rclone process and avoids EBUSY on the new
 *     `mount/mount` call.
 *   - Per-mount backoff + cool-down so a chronically-failing mount (revoked
 *     credentials, dead remote, etc.) doesn't spam logs every 60s.
 *   - Single-flight mutex: at most one reconciliation cycle runs at a time.
 *
 * Safety:
 *   - Honours a `disabled: true` (or `userUnmounted: true`) flag on entries
 *     so operators can take a mount down without losing its configuration.
 *   - Skips mounts whose `serverId` no longer exists (warns once).
 *   - Skips mounts on encrypted-password servers when no admin session has
 *     ever supplied the master key (we can't decrypt headless). Retried
 *     automatically after the next admin login.
 *   - All actions logged with `[MOUNT-RESTORE]` prefix.
 *
 * Off switches:
 *   - DISABLE_MOUNT_AUTORESTORE=1     → skip both startup restore and loop.
 *   - MOUNT_STARTUP_DELAY_MS=<int>    → override startup delay (default 10000).
 *   - MOUNT_RECONCILE_INTERVAL_MS=<n> → override loop interval (default 60000).
 */

const https = require('https');
const axios = require('axios');

const { loadMounts, loadServers } = require('./data.service');
const auth = require('../auth');

const PREFIX = '[MOUNT-RESTORE]';

// --- Tunables (overridable via env) -----------------------------------------
const DEFAULT_STARTUP_DELAY_MS = 10000;
const DEFAULT_INTERVAL_MS = 60000;
const JITTER_MS = 10000;
const REQUEST_TIMEOUT_MS = 30000;
const UNMOUNT_TIMEOUT_MS = 10000;

// Per-mount backoff ladder: 5s -> 15s -> 45s -> 5min cool-down (then repeats).
const BACKOFF_LADDER_MS = [5000, 15000, 45000];
const COOLDOWN_AFTER_LADDER_MS = 5 * 60 * 1000;

// Match phrases that indicate a stale FUSE entry / busy mount point.
const BUSY_HINT_PATTERN = /busy|EBUSY|target is busy|transport endpoint/i;

// Axios instance that tolerates self-signed certs on host-local rclone-rcd.
const axiosInstance = axios.create({
    timeout: REQUEST_TIMEOUT_MS,
    httpsAgent: new https.Agent({ rejectUnauthorized: false })
});

// In-memory per-mount state for backoff and one-shot warnings.
// shape: { mountPoint -> { attempts, nextAttemptAt, lastError, warnedDisabled, warnedNoServer, warnedEncrypted } }
const mountState = new Map();

// Master key snapshot. Populated by the auth/login route via setMasterKey()
// so background reconciliation can decrypt server creds without a live request.
let cachedMasterKey = null;

let loopHandle = null;
let runningPromise = null; // single-flight mutex

// --- Env helpers ------------------------------------------------------------

function disabled() {
    const v = process.env.DISABLE_MOUNT_AUTORESTORE;
    return v === '1' || v === 'true';
}

function startupDelayMs() {
    const n = parseInt(process.env.MOUNT_STARTUP_DELAY_MS, 10);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_STARTUP_DELAY_MS;
}

function intervalBaseMs() {
    const n = parseInt(process.env.MOUNT_RECONCILE_INTERVAL_MS, 10);
    return Number.isFinite(n) && n >= 1000 ? n : DEFAULT_INTERVAL_MS;
}

function nextIntervalMs() {
    const base = intervalBaseMs();
    const jitter = Math.floor((Math.random() * 2 - 1) * JITTER_MS); // -JITTER..+JITTER
    return Math.max(1000, base + jitter);
}

// --- Master key cache -------------------------------------------------------

/**
 * Stash the active master key so background reconciliation can decrypt
 * encrypted server passwords. Called from the auth/login route after a
 * successful login.
 */
function setMasterKey(key) {
    if (typeof key === 'string' && key.length > 0) {
        cachedMasterKey = key;
    }
}

function clearMasterKey() {
    cachedMasterKey = null;
}

function getMasterKey() {
    // Prefer a currently active authenticated session key. If no session
    // exists, drop any cached copy so background restore can't decrypt
    // credentials indefinitely after logout/session expiry.
    const activeKey = auth.getAnyActiveMasterKey();
    if (activeKey) {
        cachedMasterKey = activeKey;
        return activeKey;
    }
    cachedMasterKey = null;
    return null;
}

// --- Per-mount backoff state -----------------------------------------------

function getMountStateFor(mountPoint) {
    let st = mountState.get(mountPoint);
    if (!st) {
        st = {
            attempts: 0,
            nextAttemptAt: 0,
            lastError: null,
            warnedDisabled: false,
            warnedNoServer: false,
            warnedEncrypted: false
        };
        mountState.set(mountPoint, st);
    }
    return st;
}

function clearMountState(mountPoint) {
    mountState.delete(mountPoint);
}

function shouldAttempt(mountPoint) {
    const st = getMountStateFor(mountPoint);
    return Date.now() >= st.nextAttemptAt;
}

function recordAttempt(mountPoint, success, errMsg) {
    const st = getMountStateFor(mountPoint);
    if (success) {
        st.attempts = 0;
        st.nextAttemptAt = 0;
        st.lastError = null;
        return;
    }
    st.lastError = errMsg || st.lastError;
    st.attempts += 1;
    const idx = st.attempts - 1;
    const wait = idx < BACKOFF_LADDER_MS.length
        ? BACKOFF_LADDER_MS[idx]
        : COOLDOWN_AFTER_LADDER_MS;
    st.nextAttemptAt = Date.now() + wait;
}

// --- Credentials / RCD helpers ---------------------------------------------

/** Return { username, password } in plaintext for a server, or null when the
 *  password can't be obtained (encrypted + no master key cached yet). */
function resolveServerCreds(server) {
    if (!server) return null;
    if (server.password) {
        return { username: server.username, password: server.password };
    }
    if (server.encryptedPassword) {
        const key = getMasterKey();
        if (!key) return null;
        try {
            const decrypted = auth.decryptPassword(server.encryptedPassword, key);
            return { username: server.username, password: decrypted };
        } catch (_e) {
            return null;
        }
    }
    return null;
}

async function listActiveMounts(server, creds) {
    const resp = await axiosInstance.post(
        `${server.url}/mount/listmounts`,
        {},
        { auth: creds, timeout: REQUEST_TIMEOUT_MS }
    );
    if (resp.data && Array.isArray(resp.data.mountPoints)) {
        return resp.data.mountPoints;
    }
    return [];
}

function isAlreadyMounted(activeMounts, mountPoint) {
    return activeMounts.some(m => (m.MountPoint || m.mountPoint) === mountPoint);
}

/** Best-effort stale-FUSE cleanup. We can't run `fusermount -uz` from inside
 *  the Director container (the FUSE handle lives in the host kernel), but
 *  rclone-rcd does run on the host with access to fusermount. Calling its
 *  `mount/unmount` endpoint asks rclone to tear down any prior mount at the
 *  given path. Errors are intentionally swallowed: (a) rclone may not know
 *  about the path at all (then this is a no-op), (b) any real failure is
 *  recoverable by the subsequent mount call or the next reconciliation tick. */
async function bestEffortUnmount(server, creds, mountPoint) {
    try {
        await axiosInstance.post(
            `${server.url}/mount/unmount`,
            { mountPoint },
            { auth: creds, timeout: UNMOUNT_TIMEOUT_MS }
        );
        console.log(`${PREFIX} Cleared stale mount entry at ${mountPoint}`);
    } catch (_e) {
        // Expected when rclone has no record of this path.
    }
}

async function createMount(server, creds, entry) {
    const { fs: rfs, mountPoint, mountType, vfsOpt, mountOpt } = entry;
    const finalMountOpt = {
        ...(mountOpt || {}),
        AllowNonEmpty: true,
        AllowOther: true
    };
    const body = {
        fs: rfs,
        mountPoint,
        mountType: mountType || '',
        vfsOpt: vfsOpt || {},
        mountOpt: finalMountOpt
    };
    await axiosInstance.post(
        `${server.url}/mount/mount`,
        body,
        { auth: creds, timeout: REQUEST_TIMEOUT_MS }
    );
}

function describeError(err) {
    const data = err.response && err.response.data;
    if (data) {
        if (typeof data === 'string') return data;
        if (data.error) return data.error;
        try { return JSON.stringify(data); } catch (_e) { /* ignore */ }
    }
    return err.message || String(err);
}

// --- Core reconcile loop ----------------------------------------------------

/**
 * One reconciliation pass.
 * @param {object} opts
 * @param {'startup'|'interval'|'manual'} [opts.trigger='interval']
 * @returns {Promise<object>} summary
 */
async function reconcileOnce(opts) {
    const trigger = (opts && opts.trigger) || 'interval';

    // Coalesce with any in-flight run to prevent overlap.
    if (runningPromise) {
        return runningPromise;
    }

    runningPromise = (async () => {
        const summary = {
            trigger,
            checked: 0,
            restored: 0,
            alreadyMounted: 0,
            skipped: 0,
            failed: 0,
            errors: []
        };
        try {
            const persistent = await loadMounts();
            if (!Array.isArray(persistent) || persistent.length === 0) {
                return summary;
            }

            const serversConfig = await loadServers();
            const serversById = new Map(
                (serversConfig.servers || []).map(s => [s.id, s])
            );

            // Cache listmounts per server so we make at most one call per
            // server even if the user has 20 mounts on it.
            const listCache = new Map();

            for (const entry of persistent) {
                summary.checked += 1;
                const { mountPoint, serverId } = entry;

                if (!mountPoint) {
                    summary.skipped += 1;
                    continue;
                }

                // Honour explicit "user took this down, leave it down" flag.
                if (entry.disabled === true || entry.userUnmounted === true) {
                    const st = getMountStateFor(mountPoint);
                    if (!st.warnedDisabled) {
                        console.log(`${PREFIX} Skipping ${mountPoint} - flagged disabled/userUnmounted in persistent-mounts.json`);
                        st.warnedDisabled = true;
                    }
                    summary.skipped += 1;
                    continue;
                }

                const hasExplicitServerId = typeof serverId === 'string' && serverId.trim() !== '';
                const server = hasExplicitServerId
                    ? serversById.get(serverId)
                    : (serversById.get(serversConfig.defaultServerId) || (serversConfig.servers || [])[0]);
                if (!server) {
                    const st = getMountStateFor(mountPoint);
                    if (!st.warnedNoServer) {
                        if (hasExplicitServerId) {
                            console.warn(`${PREFIX} Skipping ${mountPoint} - referenced serverId="${serverId}" not found. Refusing fallback to default server for safety.`);
                        } else {
                            console.warn(`${PREFIX} Skipping ${mountPoint} - no default server configured`);
                        }
                        st.warnedNoServer = true;
                    }
                    summary.skipped += 1;
                    continue;
                }

                const creds = resolveServerCreds(server);
                if (!creds) {
                    const st = getMountStateFor(mountPoint);
                    if (!st.warnedEncrypted) {
                        console.warn(`${PREFIX} Skipping ${mountPoint} - server "${server.name || server.id}" has encrypted credentials and no master key cached yet. Will retry after next admin login.`);
                        st.warnedEncrypted = true;
                    }
                    summary.skipped += 1;
                    continue;
                }

                // Honour backoff (manual trigger bypasses it).
                if (!shouldAttempt(mountPoint) && trigger !== 'manual') {
                    summary.skipped += 1;
                    continue;
                }

                // Lazy per-server listmounts cache.
                let activeMounts = listCache.get(server.id);
                if (!activeMounts) {
                    try {
                        activeMounts = await listActiveMounts(server, creds);
                        listCache.set(server.id, activeMounts);
                    } catch (err) {
                        const msg = describeError(err);
                        summary.failed += 1;
                        summary.errors.push(`listmounts on ${server.name || server.id}: ${msg}`);
                        recordAttempt(mountPoint, false, msg);
                        continue;
                    }
                }

                if (isAlreadyMounted(activeMounts, mountPoint)) {
                    summary.alreadyMounted += 1;
                    recordAttempt(mountPoint, true);
                    continue;
                }

                // Stale-FUSE cleanup, then mount.
                await bestEffortUnmount(server, creds, mountPoint);

                try {
                    await createMount(server, creds, entry);
                    summary.restored += 1;
                    recordAttempt(mountPoint, true);
                    console.log(`${PREFIX} ✅ Restored ${entry.fs} -> ${mountPoint} on server="${server.name || server.id}" (trigger=${trigger})`);
                    // Invalidate per-server cache so subsequent entries see the new state.
                    listCache.delete(server.id);
                } catch (err) {
                    const msg = describeError(err);
                    summary.failed += 1;
                    summary.errors.push(`mount ${mountPoint}: ${msg}`);
                    recordAttempt(mountPoint, false, msg);
                    if (BUSY_HINT_PATTERN.test(msg)) {
                        console.warn(`${PREFIX} ⚠️  ${mountPoint} could not be restored - kernel still holds a stale FUSE entry from a previous rclone process.`);
                        console.warn(`${PREFIX}    Manual fix: SSH to host and run  sudo fusermount -uz ${mountPoint}`);
                        console.warn(`${PREFIX}    (We will retry automatically on the next reconciliation cycle.)`);
                    } else {
                        console.warn(`${PREFIX} ⚠️  Failed to restore ${mountPoint}: ${msg}`);
                    }
                }
            }
        } catch (err) {
            const msg = describeError(err);
            summary.errors.push(`reconcile error: ${msg}`);
            console.error(`${PREFIX} Reconcile failed:`, msg);
        } finally {
            runningPromise = null;
        }
        return summary;
    })();

    return runningPromise;
}

// --- Lifecycle --------------------------------------------------------------

function scheduleLoop() {
    const wait = nextIntervalMs();
    loopHandle = setTimeout(async () => {
        try {
            await reconcileOnce({ trigger: 'interval' });
        } catch (e) {
            console.error(`${PREFIX} Interval reconcile threw:`, e.message);
        } finally {
            scheduleLoop();
        }
    }, wait);
    // Don't keep the event loop alive just for this timer.
    if (loopHandle && typeof loopHandle.unref === 'function') {
        loopHandle.unref();
    }
}

function initialize() {
    if (disabled()) {
        console.log(`${PREFIX} Auto-restore is disabled via DISABLE_MOUNT_AUTORESTORE=1`);
        return;
    }
    const delay = startupDelayMs();
    console.log(`${PREFIX} Initialized (startup delay ${delay}ms, interval ~${intervalBaseMs()}ms ±${JITTER_MS}ms jitter)`);

    setTimeout(async () => {
        try {
            const summary = await reconcileOnce({ trigger: 'startup' });
            console.log(`${PREFIX} Startup reconcile: checked=${summary.checked} restored=${summary.restored} alreadyMounted=${summary.alreadyMounted} skipped=${summary.skipped} failed=${summary.failed}`);
        } catch (e) {
            console.error(`${PREFIX} Startup reconcile threw:`, e.message);
        } finally {
            scheduleLoop();
        }
    }, delay);
}

function stop() {
    if (loopHandle) {
        clearTimeout(loopHandle);
        loopHandle = null;
    }
}

module.exports = {
    initialize,
    stop,
    reconcileOnce,
    setMasterKey,
    clearMasterKey,
    getMasterKey,
    clearMountState,
    // Exposed for tests / introspection only.
    _internal: { mountState }
};
