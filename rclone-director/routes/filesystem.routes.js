const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const auth = require('../auth');

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
 * Create a directory
 * POST /api/director/filesystem/create-directory
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
        
        if (!isPathUnderAllowedRoots(absolutePath)) {
            const parentPath = path.dirname(absolutePath);
            const realParentPath = await fs.realpath(parentPath).catch(() => parentPath);
            if (!isPathUnderAllowedRoots(realParentPath)) {
                return res.status(403).json({
                    success: false,
                    error: 'Path is outside allowed filesystem roots'
                });
            }
        }

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

        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
