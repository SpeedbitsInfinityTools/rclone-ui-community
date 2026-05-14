const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const auth = require('../auth');
const { loadServers } = require('../services/data.service');
const { axiosInstance } = require('../services/server.service');

const ALLOW_ALL_FILESYSTEM_PATHS = process.env.FILESYSTEM_ALLOW_ALL === 'true';
const RESTRICT_FILESYSTEM_BROWSE = process.env.FILESYSTEM_RESTRICT_BROWSE === 'true';
const ALLOWED_FILESYSTEM_ROOTS = (process.env.FILESYSTEM_ALLOWED_ROOTS || '/mnt,/media,/host,/tmp,/home')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => path.resolve(p));

function isUnsafePathInput(p) {
    return typeof p !== 'string' || p.length === 0 || p.includes('\0');
}

function isPathUnderAllowedRoots(targetPath) {
    if (ALLOW_ALL_FILESYSTEM_PATHS) {
        return true;
    }
    return ALLOWED_FILESYSTEM_ROOTS.some(root => (
        targetPath === root || targetPath.startsWith(`${root}${path.sep}`)
    ));
}

function isPathAllowedForBrowse(targetPath) {
    if (!RESTRICT_FILESYSTEM_BROWSE) {
        // Default behavior: allow browsing the full container filesystem.
        return true;
    }
    return isPathUnderAllowedRoots(targetPath);
}

/**
 * Strip the "/host" prefix (case-insensitive) from a path.
 * In Docker, the host filesystem is bind-mounted into the container at /host
 * (read-only). The UI lets users browse those paths, but any write operation
 * (mkdir, mount, ...) has to be performed on the host side — by rclone rcd,
 * which actually runs on the host.
 *
 *   "/host"          -> { isHostPath: true,  hostPath: "/"           }
 *   "/host/mnt/foo"  -> { isHostPath: true,  hostPath: "/mnt/foo"    }
 *   "/HOST/etc"      -> { isHostPath: true,  hostPath: "/etc"        }
 *   "/mnt/foo"       -> { isHostPath: false, hostPath: "/mnt/foo"    } (unchanged)
 */
function stripHostPrefix(p) {
    if (typeof p !== 'string' || !p) {
        return { isHostPath: false, hostPath: p };
    }
    if (/^\/host$/i.test(p)) {
        return { isHostPath: true, hostPath: '/' };
    }
    if (/^\/host\//i.test(p)) {
        return { isHostPath: true, hostPath: p.slice(5) || '/' };
    }
    return { isHostPath: false, hostPath: p };
}

/**
 * Load the default rclone server (rclone rcd running on the host) and decrypt
 * its password using the current request's admin password if necessary.
 * Returns { server, password } or null if no server is configured / decrypt fails.
 */
async function getDefaultRcloneServer(req) {
    try {
        const config = await loadServers();
        const defaultId = config.defaultServerId || 'default';
        const server = config.servers.find(s => s.id === defaultId) || config.servers[0];
        if (!server) return null;

        let password = server.password;
        if (server.encryptedPassword) {
            try {
                password = auth.decryptPassword(server.encryptedPassword, req.adminPassword);
            } catch (e) {
                console.error('[FILESYSTEM] Failed to decrypt rclone server password:', e.message);
                return null;
            }
        }
        return { server, password };
    } catch (e) {
        console.error('[FILESYSTEM] Failed to load rclone server config:', e.message);
        return null;
    }
}

/**
 * Browse filesystem directories
 * GET /api/director/filesystem/browse?path=/home&mode=directories
 */
router.get('/browse', auth.requireAdminAuth, async (req, res) => {
    try {
        const targetPath = req.query.path || '/';
        const selectMode = req.query.mode || 'directories';

        if (isUnsafePathInput(targetPath)) {
            return res.status(400).json({ success: false, error: 'Invalid path' });
        }

        const absolutePath = path.resolve(targetPath);

        if (!path.isAbsolute(absolutePath)) {
            return res.status(400).json({ success: false, error: 'Invalid path' });
        }
        
        const realPath = await fs.realpath(absolutePath).catch(() => absolutePath);
        if (!isPathAllowedForBrowse(realPath)) {
            return res.status(403).json({
                success: false,
                error: 'Path is outside allowed filesystem roots'
            });
        }

        let stats;
        try {
            stats = await fs.stat(absolutePath);
        } catch (e) {
            if (e.code === 'ENOENT') {
                return res.status(404).json({ success: false, error: `Path does not exist: ${absolutePath}` });
            }
            throw e;
        }

        if (!stats.isDirectory()) {
            return res.status(400).json({ success: false, error: 'Path is not a directory' });
        }

        const entries = await fs.readdir(absolutePath, { withFileTypes: true });

        const items = await Promise.all(entries.map(async (entry) => {
            const fullPath = path.join(absolutePath, entry.name);
            let entryStats = null;
            let isAccessible = true;

            try {
                entryStats = await fs.stat(fullPath);
            } catch (e) {
                isAccessible = false;
            }

            if (selectMode === 'directories' && !entry.isDirectory()) {
                return null;
            }

            return {
                name: entry.name,
                path: fullPath,
                is_directory: entry.isDirectory(),
                is_file: entry.isFile(),
                is_symlink: entry.isSymbolicLink(),
                size: entryStats?.size || null,
                modified: entryStats?.mtime?.toISOString() || null,
                is_accessible: isAccessible,
                permissions: entryStats ? (entryStats.mode & 0o777).toString(8).padStart(3, '0') : null
            };
        }));

        const filteredItems = items.filter(i => i !== null);

        filteredItems.sort((a, b) => {
            if (a.is_directory !== b.is_directory) {
                return b.is_directory ? 1 : -1;
            }
            return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        });

        res.json({
            success: true,
            data: {
                current_path: absolutePath,
                parent_path: path.dirname(absolutePath),
                is_root: absolutePath === '/',
                items: filteredItems,
                total_items: filteredItems.length
            }
        });

    } catch (error) {
        console.error('Failed to browse filesystem:', error);

        if (error.code === 'EACCES') {
            return res.status(403).json({ success: false, error: 'Permission denied: cannot access this directory' });
        }
        if (error.code === 'ENOENT') {
            return res.status(404).json({ success: false, error: 'Path does not exist' });
        }

        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Stat the owner (UID/GID/mode) of a path on the (host-visible) filesystem.
 * GET /api/director/filesystem/stat-owner?path=/host/home/backupuser/mnt
 *
 * Used by the New Mount modal to auto-populate vfsOpt.UID / vfsOpt.GID so the
 * resulting FUSE mount is writable to the same host user that owns the parent
 * of the chosen mount point. Without this, rclone (which runs as root in the
 * `rclone-ui-backend` systemd unit) reports every file as root-owned, and the
 * host user lands on EACCES even though the mount is technically read-write.
 *
 * The lookup is fs.stat()-only and walks up to the first existing ancestor,
 * which is enough to work for not-yet-created mount points like
 * `/host/home/backupuser/mnt` (stat /host/home/backupuser instead).
 */
router.get('/stat-owner', auth.requireAdminAuth, async (req, res) => {
    try {
        const targetPath = req.query.path;
        if (!targetPath || isUnsafePathInput(targetPath)) {
            return res.status(400).json({ success: false, error: 'Invalid path' });
        }

        const absolutePath = path.resolve(targetPath);
        if (!path.isAbsolute(absolutePath)) {
            return res.status(400).json({ success: false, error: 'Invalid path' });
        }

        let lookupPath = absolutePath;
        let usedFallback = false;

        // Walk up to the first existing ancestor. Cap depth at 64 to avoid
        // pathological loops on weird inputs.
        for (let i = 0; i < 64; i++) {
            try {
                const st = await fs.stat(lookupPath);
                return res.json({
                    success: true,
                    data: {
                        path: lookupPath,
                        requestedPath: absolutePath,
                        exists: lookupPath === absolutePath,
                        usedFallback,
                        uid: st.uid,
                        gid: st.gid,
                        mode: st.mode,
                        modeOctal: (st.mode & 0o7777).toString(8),
                        isDirectory: st.isDirectory(),
                    }
                });
            } catch (e) {
                if (e.code === 'ENOENT') {
                    usedFallback = true;
                    const parent = path.dirname(lookupPath);
                    if (parent === lookupPath) break; // hit "/"
                    lookupPath = parent;
                    continue;
                }
                if (e.code === 'EACCES') {
                    return res.status(403).json({ success: false, error: 'Permission denied while stat-ing path' });
                }
                throw e;
            }
        }

        return res.status(404).json({ success: false, error: 'No existing ancestor found' });
    } catch (error) {
        console.error('[FILESYSTEM] stat-owner failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Create a directory
 * POST /api/director/filesystem/create-directory
 *
 * Dispatch rules:
 *  - Paths under /host/... (the read-only host bind mount) cannot be created
 *    with the container's local fs (the mount is :ro). Instead, we strip the
 *    /host prefix and call rclone rcd's `operations/mkdir` against the
 *    on-the-fly `:local:` remote. rclone rcd runs on the host as root and
 *    can therefore create the directory on the actual host filesystem.
 *  - All other paths (e.g. /tmp/foo inside the container) keep using Node fs.
 */
router.post('/create-directory', auth.requireAdminAuth, async (req, res) => {
    try {
        const { path: targetPath } = req.body;

        if (!targetPath) {
            return res.status(400).json({ success: false, error: 'Path is required' });
        }
        if (isUnsafePathInput(targetPath)) {
            return res.status(400).json({ success: false, error: 'Invalid path' });
        }

        const absolutePath = path.resolve(targetPath);
        const { isHostPath, hostPath } = stripHostPrefix(absolutePath);

        // Allow-roots check is applied to whichever path will actually be created:
        //  - container path for in-container mkdir
        //  - stripped host path for rclone-rcd mkdir
        const pathToCheck = isHostPath ? hostPath : absolutePath;
        if (!isPathUnderAllowedRoots(pathToCheck)) {
            // Fallback: also accept if the parent resolves into an allowed root
            // (covers e.g. symlink trees). Only applied for container paths;
            // for host paths we cannot fs.realpath() across the bind mount.
            if (!isHostPath) {
                const parentPath = path.dirname(absolutePath);
                const realParentPath = await fs.realpath(parentPath).catch(() => parentPath);
                if (!isPathUnderAllowedRoots(realParentPath)) {
                    return res.status(403).json({
                        success: false,
                        error: 'Path is outside allowed filesystem roots'
                    });
                }
            } else {
                return res.status(403).json({
                    success: false,
                    error: `Host path is outside allowed roots (${ALLOWED_FILESYSTEM_ROOTS.join(', ')}).`
                });
            }
        }

        if (isHostPath) {
            // -----------------------------------------------------------------
            // Host-side mkdir via rclone rcd (runs on host as root).
            // -----------------------------------------------------------------
            const rclone = await getDefaultRcloneServer(req);
            if (!rclone) {
                return res.status(500).json({
                    success: false,
                    error:
                        'Cannot create directories under /host: no rclone backend is configured. ' +
                        '/host is a read-only view of the host filesystem inside this container, ' +
                        'so writes must be proxied to the rclone service running on the host.'
                });
            }

            // Best-effort existence check via rclone operations/stat. If it
            // succeeds and the entry exists, return a 409 (matches the
            // container-fs branch below).
            try {
                const statResp = await axiosInstance.post(
                    `${rclone.server.url}/operations/stat`,
                    { fs: ':local:', remote: hostPath },
                    { auth: { username: rclone.server.username, password: rclone.password }, timeout: 10000 }
                );
                if (statResp.data && statResp.data.item) {
                    return res.status(409).json({ success: false, error: 'Path already exists' });
                }
            } catch (e) {
                // 404 / not-found is fine; anything else we ignore here and
                // let the mkdir call below produce the real error.
            }

            try {
                await axiosInstance.post(
                    `${rclone.server.url}/operations/mkdir`,
                    { fs: ':local:', remote: hostPath },
                    { auth: { username: rclone.server.username, password: rclone.password }, timeout: 15000 }
                );
            } catch (err) {
                const status = err.response?.status;
                const detail = err.response?.data?.error || err.response?.data?.details?.error || err.message;
                console.error(`[FILESYSTEM] rclone mkdir failed for host path ${hostPath}:`, detail);

                if (status === 401 || status === 403) {
                    return res.status(403).json({
                        success: false,
                        error: `rclone rejected the mkdir (${status}). The configured rclone backend credentials may be wrong, or rclone is running as a user that cannot write to '${hostPath}'.`
                    });
                }
                if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND') {
                    return res.status(503).json({
                        success: false,
                        error: `Cannot reach rclone backend at ${rclone.server.url} to perform mkdir on host. (${err.code || err.message})`
                    });
                }
                return res.status(500).json({
                    success: false,
                    error: `Failed to create host directory '${hostPath}' via rclone: ${detail}`
                });
            }

            return res.json({
                success: true,
                message: 'Directory created on host successfully',
                data: { path: absolutePath, hostPath }
            });
        }

        // ---------------------------------------------------------------------
        // Container-internal mkdir via Node fs (legacy behaviour).
        // ---------------------------------------------------------------------
        try {
            await fs.access(absolutePath);
            return res.status(409).json({ success: false, error: 'Path already exists' });
        } catch (e) {
            // Path doesn't exist, good to proceed
        }

        await fs.mkdir(absolutePath, { recursive: true });

        res.json({
            success: true,
            message: 'Directory created successfully',
            data: { path: absolutePath }
        });

    } catch (error) {
        console.error('Failed to create directory:', error);

        if (error.code === 'EACCES') {
            return res.status(403).json({ success: false, error: 'Permission denied: cannot create directory here' });
        }
        if (error.code === 'EROFS') {
            return res.status(400).json({
                success: false,
                error:
                    'Cannot create directory: target filesystem is read-only. ' +
                    'If you intended to create a directory on the host, use a path under /host/... ' +
                    '(the Director will route the request to rclone running on the host).'
            });
        }

        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
