/**
 * Health Check Routes
 * Status endpoints for monitoring
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { loadServers } = require('../services/data.service');
const { axiosInstance } = require('../services/server.service');

/**
 * Get edition information from .edition marker file
 */
function getEditionInfo() {
    try {
        const editionPath = path.join(__dirname, '..', '.edition');
        if (fs.existsSync(editionPath)) {
            const content = fs.readFileSync(editionPath, 'utf8');
            return JSON.parse(content);
        }
    } catch (error) {
        console.warn('[HEALTH] Could not read .edition file:', error.message);
    }
    // Default to commercial if no .edition file
    return {
        edition: 'commercial',
        features: ['multi-server', 'add-server', 'delete-server'],
        max_servers: -1
    };
}

/**
 * GET /health - Health check endpoint
 * Public endpoint (no auth required)
 */
router.get('/', async (req, res) => {
    try {
        // Check if we can load servers (basic functionality test)
        const config = await loadServers();
        const defaultServer = config.servers.find(s => s.id === config.defaultServerId) || config.servers[0];
        
        // Try to connect to default RCD backend
        let backendStatus = {
            connected: false,
            error: null,
            server: null
        };
        
        if (defaultServer) {
            try {
                // Try to decrypt password if encrypted (same logic as other endpoints)
                // Note: Health check doesn't have admin auth, so we can't decrypt encrypted passwords
                // In that case, mark as error but don't fail the entire health check
                let password = defaultServer.password;
                if (defaultServer.encryptedPassword && !password) {
                    backendStatus.error = 'Cannot verify backend connection (password encrypted, no auth provided)';
                    backendStatus.server = { name: defaultServer.name, url: defaultServer.url };
                } else {
                    const response = await axiosInstance.post(
                        `${defaultServer.url}/core/version`,
                        {},
                        {
                            auth: { username: defaultServer.username, password: password },
                            timeout: 2000  // Reduced from 5000ms to 2000ms for faster health checks
                        }
                    );
                    
                    backendStatus = {
                        connected: true,
                        server: {
                            name: defaultServer.name,
                            url: defaultServer.url,
                            version: response.data.version
                        }
                    };
                }
            } catch (error) {
                backendStatus.error = error.message;
                backendStatus.server = { name: defaultServer.name, url: defaultServer.url };
            }
        }
        
        const editionInfo = getEditionInfo();
        
        res.json({
            status: 'ok',
            service: 'Rclone Director',
            timestamp: new Date().toISOString(),
            backend: backendStatus,
            serversConfigured: config.servers.length,
            edition: editionInfo.edition,
            maxServers: editionInfo.max_servers
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            service: 'Rclone Director',
            error: error.message
        });
    }
});

/**
 * GET /health/edition - Get edition information
 * Public endpoint (no auth required)
 */
router.get('/edition', (req, res) => {
    const editionInfo = getEditionInfo();
    res.json(editionInfo);
});

module.exports = router;

