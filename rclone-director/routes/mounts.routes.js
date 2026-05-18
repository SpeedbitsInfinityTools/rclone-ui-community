/**
 * Mount Management Routes
 * Handles persistent mount operations
 */

const express = require('express');
const router = express.Router();
const auth = require('../auth');
const { loadMounts, saveMounts } = require('../services/data.service');
const { loadServers } = require('../services/data.service');
const { axiosInstance } = require('../services/server.service');
const mountRestore = require('../services/mount-restore.service');

/**
 * Helper: Get server by ID
 */
async function getServerById(serverId) {
    const config = await loadServers();
    return config.servers.find(s => s.id === serverId);
}

/**
 * Helper: Get default server
 */
async function getDefaultServer() {
    const config = await loadServers();
    const defaultId = config.defaultServerId || 'default';
    return config.servers.find(s => s.id === defaultId) || config.servers[0];
}

/**
 * POST /director/mount/create - Create mount with optional persistence
 * Protected: Requires admin authentication
 */
router.post('/create', auth.requireAdminAuth, async (req, res) => {
    let server = null; // Declare outside try block for catch block access
    try {
        const { fs, mountPoint, mountType, vfsOpt, mountOpt, permanent, serverId } = req.body;
        const adminPassword = req.adminPassword;
        
        if (!fs || !mountPoint) {
            return res.status(400).json({ error: 'Missing required fields: fs, mountPoint' });
        }
        
        // Get target server
        server = serverId ? await getServerById(serverId) : await getDefaultServer();
        if (!server) {
            return res.status(404).json({ error: 'No rclone server configured' });
        }
        
        // Decrypt password
        let password = server.password;
        if (server.encryptedPassword) {
            try {
                password = auth.decryptPassword(server.encryptedPassword, adminPassword);
            } catch (error) {
                return res.status(401).json({ error: 'Failed to decrypt server credentials' });
            }
        }
        
        // Prepare mount options with auto directory creation
        const finalMountOpt = {
            ...mountOpt,
            AllowNonEmpty: true,  // Allow mounting on non-empty directories
            AllowOther: true      // Allow other users to access the mount
        };
        
        console.log(`[MOUNT] Creating mount: ${fs} -> ${mountPoint}`);
        console.log(`[MOUNT] Server: ${server.url}`);
        console.log(`[MOUNT] VFS options:`, vfsOpt);
        console.log(`[MOUNT] Mount options:`, finalMountOpt);
        
        // Create mount via rclone API
        // Mount operations can take time (connecting to cloud storage, initializing filesystem)
        const response = await axiosInstance.post(
            `${server.url}/mount/mount`,
            { 
                fs, 
                mountPoint, 
                mountType: mountType || '', 
                vfsOpt: vfsOpt || {}, 
                mountOpt: finalMountOpt 
            },
            {
                auth: { username: server.username, password: password },
                timeout: 60000 // 60 seconds - mount operations can legitimately take time
            }
        );
        
        // If permanent, save to persistence file
        if (permanent) {
            const mounts = await loadMounts();
            
            // Remove existing mount with same mountPoint (if any)
            const filteredMounts = mounts.filter(m => m.mountPoint !== mountPoint);
            
            filteredMounts.push({
                fs,
                mountPoint,
                mountType: mountType || '',
                vfsOpt: vfsOpt || {},
                mountOpt: mountOpt || {},
                serverId: server.id,
                permanent: true,
                createdAt: new Date().toISOString()
            });
            
            await saveMounts(filteredMounts);
            console.log(`[MOUNT] ${fs} -> ${mountPoint} saved as permanent`);
        }
        
        // Fresh mount: clear any stale backoff state from a prior failed
        // reconciliation attempt at this path.
        try { mountRestore.clearMountState(mountPoint); } catch (_e) { /* ignore */ }
        
        res.json({ success: true, ...response.data });
    } catch (error) {
        console.error('[MOUNT] Creation error:', error.message);
        console.error('[MOUNT] Error code:', error.code);
        
        // Safely extract error details
        let errorDetails;
        try {
            errorDetails = error.response?.data || error.message || 'Unknown error';
        } catch (e) {
            errorDetails = error.message || 'Unknown error';
        }
        
        // Handle connection errors (including timeout)
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || 
            error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
            return res.status(503).json({
                error: 'Server Not Connected',
                message: 'Cannot create mount: The selected rclone server is not connected or the request timed out. Please switch to a connected server using the server selector in the top navigation bar.',
                code: error.code,
                serverUrl: server ? server.url : 'unknown'
            });
        }
        
        // Check if error is due to missing directory - extract message safely
        let errorMsg = '';
        try {
            if (error.response && error.response.data) {
                if (typeof error.response.data === 'string') {
                    errorMsg = error.response.data;
                } else if (error.response.data.error) {
                    errorMsg = error.response.data.error;
                }
            }
            if (!errorMsg && error.message) {
                errorMsg = error.message;
            }
        } catch (e) {
            console.error('[MOUNT] Error extracting error message:', e.message);
            errorMsg = '';
        }
        
        if (errorMsg.includes('no such file or directory') || errorMsg.includes('cannot find the path')) {
            return res.status(400).json({
                error: 'Mount Point Does Not Exist',
                message: `The mount point directory "${mountPoint}" does not exist on the server. Please create it first by running: sudo mkdir -p ${mountPoint}`,
                details: errorMsg,
                mountPoint: mountPoint
            });
        }
        
        // Generic error - safe serialization
        res.status(error.response?.status || 500).json({
            error: 'Failed to create mount',
            details: errorDetails
        });
    }
});

/**
 * POST /director/mount/unmount - Unmount and remove from persistence
 * Protected: Requires admin authentication
 */
router.post('/unmount', auth.requireAdminAuth, async (req, res) => {
    let server = null; // Declare outside try block for catch block access
    try {
        const { mountPoint, serverId, keepPersistent } = req.body;
        const adminPassword = req.adminPassword;
        
        if (!mountPoint) {
            return res.status(400).json({ error: 'Missing required field: mountPoint' });
        }
        
        // Get target server
        server = serverId ? await getServerById(serverId) : await getDefaultServer();
        if (!server) {
            return res.status(404).json({ error: 'No rclone server configured' });
        }
        
        // Decrypt password
        let password = server.password;
        if (server.encryptedPassword) {
            try {
                password = auth.decryptPassword(server.encryptedPassword, adminPassword);
            } catch (error) {
                return res.status(401).json({ error: 'Failed to decrypt server credentials' });
            }
        }
        
        // Unmount via rclone API
        // Unmount operations are usually quick but may take time if there are open files
        const response = await axiosInstance.post(
            `${server.url}/mount/unmount`,
            { mountPoint },
            {
                auth: { username: server.username, password: password },
                timeout: 30000 // 30 seconds - allow time for graceful unmount
            }
        );
        
        // Update persistence file.
        const mounts = await loadMounts();
        if (keepPersistent === true) {
            const updatedMounts = mounts.map((m) => {
                if (m.mountPoint !== mountPoint) return m;
                return {
                    ...m,
                    userUnmounted: true,
                    disabled: true,
                    unmountedAt: new Date().toISOString()
                };
            });
            await saveMounts(updatedMounts);
            console.log(`[MOUNT] ${mountPoint} marked userUnmounted=true (kept in persistence)`);            
        } else {
            const filteredMounts = mounts.filter(m => m.mountPoint !== mountPoint);
            await saveMounts(filteredMounts);
            console.log(`[MOUNT] ${mountPoint} removed from persistence`);
        }
        
        // Clear any backoff state so a future mount at the same path starts
        // fresh (no stale "warned about busy" cool-down).
        try { mountRestore.clearMountState(mountPoint); } catch (_e) { /* ignore */ }
        
        res.json({ success: true, keepPersistent: keepPersistent === true, ...response.data });
    } catch (error) {
        console.error('[MOUNT] Unmount error:', error.message);
        console.error('[MOUNT] Error code:', error.code);
        
        // Safely extract error details without causing crashes
        let errorDetails;
        try {
            errorDetails = error.response?.data || error.message || 'Unknown error';
        } catch (e) {
            errorDetails = error.message || 'Unknown error';
        }
        
        // Handle connection errors (including timeout)
        // ECONNABORTED = axios timeout
        // ETIMEDOUT = network timeout
        // ECONNREFUSED = connection refused
        // ENOTFOUND = DNS resolution failed
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || 
            error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
            return res.status(503).json({
                error: 'Server Not Connected',
                message: 'Cannot unmount: The selected rclone server is not connected or the request timed out. Please switch to a connected server using the server selector in the top navigation bar.',
                code: error.code,
                serverUrl: server ? server.url : 'unknown'
            });
        }
        
        // Check if error is due to busy mount (files in use, process in directory, etc.)
        // Be very careful here - extract error message safely
        let errorMsg = '';
        try {
            if (error.response && error.response.data) {
                if (typeof error.response.data === 'string') {
                    errorMsg = error.response.data;
                } else if (error.response.data.error) {
                    errorMsg = error.response.data.error;
                }
            }
            if (!errorMsg && error.message) {
                errorMsg = error.message;
            }
        } catch (e) {
            console.error('[MOUNT] Error extracting error message:', e.message);
            errorMsg = '';
        }
        
        const isBusyMount = errorMsg.toLowerCase().includes('busy') || 
                           errorMsg.toLowerCase().includes('in use') || 
                           errorMsg.toLowerCase().includes('target is busy') ||
                           errorMsg.toLowerCase().includes('device or resource busy');
        
        if (isBusyMount) {
            return res.status(409).json({
                error: 'Mount is Busy',
                message: `Cannot unmount ${mountPoint}: The mount is currently in use.`,
                details: errorMsg,
                mountPoint: mountPoint,
                troubleshooting: {
                    reason: 'The mount cannot be unmounted because it is currently in use by one or more processes.',
                    commonCauses: [
                        'A terminal/shell is currently in a directory within the mount',
                        'A file from the mount is open in an application (editor, viewer, etc.)',
                        'A background process is accessing files in the mount',
                        'A file transfer or sync operation is in progress'
                    ],
                    solutions: [
                        'Close any terminals that are in the mount directory',
                        'Close all applications that have files open from the mount',
                        'Wait for any ongoing file operations to complete',
                        'Check which processes are using the mount with: lsof +D ' + mountPoint
                    ],
                    forceUnmount: {
                        warning: 'Force unmounting can cause data loss if files are being written!',
                        command: `sudo fusermount -uz ${mountPoint} || sudo umount -l ${mountPoint}`,
                        description: 'Run this command via SSH on the server to force unmount'
                    }
                }
            });
        }
        
        // Generic error - ensure we don't try to serialize circular references
        res.status(error.response?.status || 500).json({
            error: 'Failed to unmount',
            details: errorDetails,
            mountPoint: mountPoint
        });
    }
});

/**
 * GET /director/mounts/persistent - List all persistent mounts
 * Protected: Requires admin authentication
 */
router.get('/persistent', auth.requireAdminAuth, async (req, res) => {
    try {
        const mounts = await loadMounts();
        res.json({ mounts });
    } catch (error) {
        console.error('[MOUNT] List error:', error);
        res.status(500).json({ error: 'Failed to load persistent mounts', details: error.message });
    }
});

/**
 * POST /director/mounts/restore-now - Force an immediate reconciliation of
 * persistent mounts against the live rclone-rcd. Useful for:
 *   - Operator-triggered recovery after manually fixing a zombie FUSE entry
 *     (e.g. `sudo fusermount -uz <path>` followed by this call).
 *   - Smoke testing the auto-restore service.
 *   - Re-trying mounts that hit the per-mount backoff cool-down (manual
 *     trigger bypasses the backoff check).
 *
 * Protected: Requires admin authentication.
 *
 * Response: { trigger, checked, restored, alreadyMounted, skipped, failed, errors[] }
 */
router.post('/restore-now', auth.requireAdminAuth, async (req, res) => {
    try {
        const summary = await mountRestore.reconcileOnce({ trigger: 'manual' });
        console.log(`[MOUNT-RESTORE] Manual restore via API: checked=${summary.checked} restored=${summary.restored} alreadyMounted=${summary.alreadyMounted} skipped=${summary.skipped} failed=${summary.failed}`);
        res.json({ success: summary.failed === 0, ...summary });
    } catch (error) {
        console.error('[MOUNT-RESTORE] Manual restore failed:', error.message);
        res.status(500).json({ error: 'Failed to run mount restore', details: error.message });
    }
});

module.exports = router;

