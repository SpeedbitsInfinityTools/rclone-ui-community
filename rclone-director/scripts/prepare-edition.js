#!/usr/bin/env node
/**
 * Edition Preparation Script for Rclone Director
 * 
 * This script prepares the codebase for Docker builds by replacing the
 * multi-server routes with a Community Edition stub.
 * 
 * Single-image approach:
 * - Build time: Always creates Community stub (multi-server blocked)
 * - Runtime: If Infinity Tools injects real servers.routes.js → Commercial
 * 
 * The stub allows:
 * - Listing servers (single server)
 * - Editing existing server
 * - Testing connection
 * - Restarting RCD
 * 
 * The stub blocks (returns 402 Payment Required):
 * - Adding new servers
 * - Deleting servers
 * - Setting default server
 * 
 * Usage:
 *   node scripts/prepare-edition.js
 */

const fs = require('fs');
const path = require('path');

const APP_DIR = path.join(__dirname, '..');

// Community edition stub for servers.routes.js
const SERVERS_ROUTES_STUB = `/**
 * Server Management Routes - Community Edition
 * 
 * In Community edition, only 1 Rclone server is allowed (the local one).
 * Adding, deleting, and managing multiple servers is only available in Commercial edition.
 * 
 * To enable Commercial features, use Infinity Tools which injects the full
 * servers.routes.js file at deployment time.
 */

const express = require('express');
const router = express.Router();
const auth = require('../auth');
const { loadServers, saveServers } = require('../services/data.service');
const { axiosInstance } = require('../services/server.service');

const UPGRADE_MESSAGE = 'Multi-server management is only available in the Commercial edition. ' +
    'Get Infinity Tools at https://www.speedbits.io for multi-server support.';

/**
 * GET /director/servers - List all rclone servers
 * ALLOWED in Community edition (returns single server)
 */
router.get('/', auth.requireAdminAuth, async (req, res) => {
    try {
        const config = await loadServers();
        const servers = config.servers.map(s => ({
            id: s.id,
            name: s.name,
            url: s.url,
            username: s.username,
            isDefault: s.id === config.defaultServerId,
            createdAt: s.createdAt,
            hasPassword: !!(s.encryptedPassword || s.password)
        }));
        res.json({ 
            servers, 
            defaultServerId: config.defaultServerId,
            edition: 'community',
            maxServers: 1
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to load servers', details: error.message });
    }
});

/**
 * POST /director/servers - Create new rclone server
 * BLOCKED in Community edition
 */
router.post('/', auth.requireAdminAuth, async (req, res) => {
    res.status(402).json({
        error: 'Feature not available',
        message: UPGRADE_MESSAGE,
        upgrade_required: true,
        upgrade_url: 'https://www.speedbits.io',
        edition: 'community'
    });
});

/**
 * PUT /director/servers/:id - Update rclone server
 * ALLOWED in Community edition (for editing the single server)
 */
router.put('/:id', auth.requireAdminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, url, username, password, port } = req.body;
        const adminPassword = req.adminPassword;
        
        const config = await loadServers();
        const serverIndex = config.servers.findIndex(s => s.id === id);
        
        if (serverIndex === -1) {
            return res.status(404).json({ error: 'Server not found' });
        }
        
        if (name) config.servers[serverIndex].name = name;
        if (url) {
            let fullUrl = url;
            if (port && !url.includes(':' + port)) {
                fullUrl = url.replace(/:\\\\d+$/, '') + ':' + port;
            }
            config.servers[serverIndex].url = fullUrl;
        }
        if (username) config.servers[serverIndex].username = username;
        if (password) {
            config.servers[serverIndex].encryptedPassword = auth.encryptPassword(password, adminPassword);
            delete config.servers[serverIndex].password;
        }
        config.servers[serverIndex].updatedAt = new Date().toISOString();
        
        await saveServers(config);
        
        const updatedServer = { ...config.servers[serverIndex] };
        delete updatedServer.password;
        delete updatedServer.encryptedPassword;
        
        res.json({ success: true, server: updatedServer });
    } catch (error) {
        console.error('[SERVER] Update error:', error);
        res.status(500).json({ error: 'Failed to update server', details: error.message });
    }
});

/**
 * DELETE /director/servers/:id - Delete rclone server
 * BLOCKED in Community edition
 */
router.delete('/:id', auth.requireAdminAuth, async (req, res) => {
    res.status(402).json({
        error: 'Feature not available',
        message: 'Deleting servers is not available in Community edition. You must have at least one server configured.',
        upgrade_required: true,
        upgrade_url: 'https://www.speedbits.io',
        edition: 'community'
    });
});

/**
 * POST /director/servers/:id/set-default - Set default server
 * BLOCKED in Community edition
 */
router.post('/:id/set-default', auth.requireAdminAuth, async (req, res) => {
    res.status(402).json({
        error: 'Feature not available',
        message: UPGRADE_MESSAGE,
        upgrade_required: true,
        upgrade_url: 'https://www.speedbits.io',
        edition: 'community'
    });
});

/**
 * POST /director/servers/:id/test - Test connection to server
 * ALLOWED in Community edition
 */
router.post('/:id/test', auth.requireAdminAuth, async (req, res) => {
    const { id } = req.params;
    const adminPassword = req.adminPassword;
    
    let server;
    try {
        const config = await loadServers();
        server = config.servers.find(s => s.id === id);
        
        if (!server) {
            return res.status(404).json({ error: 'Server not found' });
        }
        
        let password = server.password;
        if (server.encryptedPassword) {
            try {
                password = auth.decryptPassword(server.encryptedPassword, adminPassword);
            } catch (error) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Failed to decrypt password',
                    details: 'Invalid admin password or corrupted data'
                });
            }
        }
        
        const response = await axiosInstance.post(
            \`\${server.url}/core/version\`,
            {},
            {
                auth: { username: server.username, password: password },
                timeout: 10000
            }
        );
        
        res.json({ success: true, version: response.data });
    } catch (error) {
        console.error('[SERVER] Test error:', error);
        
        let errorDetails = error.message;
        if (error.response) {
            const status = error.response.status;
            if (status === 401) {
                errorDetails = 'Authentication failed (401 Unauthorized) - Check username/password';
            } else if (status === 403) {
                errorDetails = 'Access forbidden (403) - Check permissions';
            } else if (status === 404) {
                errorDetails = 'Endpoint not found (404) - Is rclone RCD running?';
            } else {
                errorDetails = \`HTTP \${status}: \${error.response.data?.error || error.response.statusText || 'Unknown error'}\`;
            }
        } else if (error.code === 'ECONNREFUSED') {
            errorDetails = \`Connection refused - Server not reachable\${server ? \` at \${server.url}\` : ''}\`;
        } else if (error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
            errorDetails = \`\${error.code}: Cannot reach server\${server ? \` at \${server.url}\` : ''}\`;
        }
        
        res.status(500).json({ 
            success: false, 
            error: 'Connection failed', 
            details: errorDetails
        });
    }
});

/**
 * POST /director/servers/test-temp - Test temporary server config
 * BLOCKED in Community edition
 */
router.post('/test-temp', auth.requireAdminAuth, async (req, res) => {
    res.status(402).json({
        error: 'Feature not available',
        message: UPGRADE_MESSAGE,
        upgrade_required: true,
        upgrade_url: 'https://www.speedbits.io',
        edition: 'community'
    });
});

/**
 * POST /director/servers/:id/restart - Restart RCD service
 * ALLOWED in Community edition
 */
router.post('/:id/restart', auth.requireAdminAuth, async (req, res) => {
    const { id } = req.params;
    const adminPassword = req.adminPassword;
    
    try {
        const config = await loadServers();
        const server = config.servers.find(s => s.id === id);
        
        if (!server) {
            return res.status(404).json({ error: 'Server not found' });
        }
        
        let password = server.password;
        if (server.encryptedPassword) {
            try {
                password = auth.decryptPassword(server.encryptedPassword, adminPassword);
            } catch (error) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Failed to decrypt password',
                    details: 'Invalid admin password or corrupted data'
                });
            }
        }
        
        console.log(\`[SERVER] Restarting RCD for server: \${server.name} (\${server.url})\`);
        
        await axiosInstance.post(
            \`\${server.url}/core/quit\`,
            {},
            {
                auth: { username: server.username, password: password },
                timeout: 5000
            }
        );
        
        console.log(\`[SERVER] ✅ Restart signal sent to \${server.name}\`);
        res.json({ 
            success: true,
            message: 'Restart signal sent. RCD will restart in ~10 seconds if systemd is configured with Restart=always'
        });
        
    } catch (error) {
        console.error('[SERVER] Restart error:', error);
        
        if (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET') {
            console.log(\`[SERVER] ✅ RCD shutdown detected (\${error.code}) - restart in progress\`);
            return res.json({ 
                success: true,
                message: 'RCD is shutting down. It will restart in ~10 seconds.'
            });
        }
        
        let errorDetails = error.message;
        if (error.response) {
            const status = error.response.status;
            if (status === 401) {
                errorDetails = 'Authentication failed - Check credentials';
            } else if (status === 404) {
                errorDetails = 'Endpoint not found - RCD may not support core/quit (requires rclone v1.52+)';
            } else {
                errorDetails = \`HTTP \${status}: \${error.response.data?.error || 'Unknown error'}\`;
            }
        }
        
        res.status(500).json({ 
            success: false, 
            error: 'Failed to restart RCD', 
            details: errorDetails
        });
    }
});

module.exports = router;
`;

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🏗️  Rclone Director - Build Preparation');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('📦 Single-image approach:');
console.log('   - Build: Community stub (multi-server blocked)');
console.log('   - Runtime: Commercial if servers.routes.js injected');
console.log('');

// Step 1: Replace servers.routes.js with stub
console.log('📝 Step 1: Creating Community stub for multi-server routes');
const routesPath = path.join(APP_DIR, 'routes', 'servers.routes.js');
fs.writeFileSync(routesPath, SERVERS_ROUTES_STUB);
console.log('   ✓ Created routes/servers.routes.js (Community stub)');
console.log('');

// Step 2: Create edition marker file
console.log('📝 Step 2: Creating edition marker file');
const marker = {
    edition: 'community',
    features: ['single-server'],
    max_servers: 1,
    multi_server_disabled: true,
    upgrade_url: 'https://www.speedbits.io',
    upgrade_message: 'Multi-server management requires Infinity Tools. Get it at https://www.speedbits.io',
    prepared_at: new Date().toISOString(),
    note: 'Edition can be upgraded at runtime by injecting servers.routes.js'
};

const markerPath = path.join(APP_DIR, '.edition');
fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2));
console.log('   ✓ Created .edition marker');
console.log('');

console.log('✅ Build preparation complete!');
console.log('');
console.log('🔒 Default restrictions (Community):');
console.log('   - Maximum 1 Rclone server');
console.log('   - Adding servers → 402 Payment Required');
console.log('   - Deleting servers → 402 Payment Required');
console.log('   - Editing existing server → Allowed');
console.log('   - Test connection → Allowed');
console.log('   - Restart RCD → Allowed');
console.log('');
console.log('🔓 To enable Commercial features:');
console.log('   Mount real servers.routes.js to /app/commercial/');
console.log('   The startup script will detect and activate Commercial mode');
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
