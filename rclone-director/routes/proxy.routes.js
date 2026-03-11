/**
 * Rclone API Proxy Routes
 * Handles proxying of rclone API calls to configured servers
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const FormData = require('form-data');
const auth = require('../auth');
const { loadServers } = require('../services/data.service');
const { axiosInstance } = require('../services/server.service');

// Multer for file uploads (store in memory for proxy forwarding)
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 * 1024 } // 10 GB limit per file (for cloud storage uploads)
});

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
 * POST /rclone/download - Special endpoint for file downloads
 * Uses rclone's core/command with 'cat' to stream file content
 * 
 * IMPORTANT: Returns 503 (not 401/404) when backend unavailable
 */
router.post('/download', auth.requireAdminAuth, async (req, res) => {
    let server = null; // Declare outside try block for catch block access
    try {
        const adminPassword = req.adminPassword;
        const { fs, remote } = req.body;
        
        if (!fs || !remote) {
            return res.status(400).json({ error: 'Missing required parameters: fs, remote' });
        }
        
        // Get target server
        const serverId = req.headers['x-rclone-server'] || null;
        server = serverId ? await getServerById(serverId) : await getDefaultServer();
        
        if (!server) {
            // Return 503 (Service Unavailable) instead of 404
            return res.status(503).json({ 
                error: 'No Rclone Server Configured',
                message: 'No rclone backend server is configured. Please add a server in Menu → Rclone Servers.',
                code: 'NO_SERVER_CONFIGURED'
            });
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
        
        console.log(`[DOWNLOAD] Downloading file: fs="${fs}", remote="${remote}"`);
        
        // Use rclone's --rc-serve HTTP GET endpoint for file downloads
        // Requires rcd to be started with --rc-serve flag
        // Format: GET /[remoteName:]/path/to/file
        // See: https://forum.rclone.org/t/rclone-cat-for-http-api/38844
        
        // URL-encode each path segment to handle special characters and spaces
        const encodedPath = remote.split('/').map(encodeURIComponent).join('/');
        
        // Construct the rc-serve URL with bracket notation
        // Example: /[hetzner:speedbitspublic]/folder/file.pdf
        const serveUrl = `${server.url}/[${fs}]/${encodedPath}`;
        
        console.log(`[DOWNLOAD] Streaming from rc-serve: ${serveUrl}`);
        
        // HTTP GET request to rc-serve endpoint (not RC POST)
        const response = await axiosInstance.get(
            serveUrl,
            {
                auth: { username: server.username, password: password },
                responseType: 'stream',  // Stream directly
                timeout: 300000,
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            }
        );
        
        console.log(`[DOWNLOAD] Stream received, piping to client`);
        
        // Set appropriate headers for file download
        const filename = remote.split('/').pop();
        res.setHeader('Content-Type', response.headers['content-type'] || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }
        
        // Stream the response directly to the client (S3 → RCD → Director → Browser)
        response.data.pipe(res);
        
    } catch (error) {
        console.error('[DOWNLOAD] Error:', error.message);
        
        // Handle connection errors with user-friendly messages
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
            return res.status(503).json({
                error: 'Server Not Connected',
                message: 'Cannot connect to the selected rclone server. Please switch to a connected server using the server selector in the top navigation bar, or check if your rclone backend is running.',
                code: error.code,
                serverUrl: server ? server.url : 'unknown'
            });
        }
        
        res.status(error.response?.status || 500).json({
            error: 'Download failed',
            details: error.message
        });
    }
});

/**
 * ALL /rclone/* - Generic proxy for all rclone API calls
 * Protected: Requires admin authentication to decrypt rclone passwords
 * Special handling for file uploads (operations/uploadfile)
 * 
 * IMPORTANT: Returns 503 (not 401/404) when backend unavailable
 * This allows dashboard to load and show error state gracefully
 */
router.all('/*', auth.requireAdminAuth, upload.any(), async (req, res) => {
    let server = null; // Declare outside try block for catch block access
    try {
        const adminPassword = req.adminPassword;
        
        // Extract rclone API path
        const rclonePath = req.path.replace('/', '');
        
        // Get target server (from header or use default)
        const serverId = req.headers['x-rclone-server'] || null;
        server = serverId ? await getServerById(serverId) : await getDefaultServer();
        
        if (!server) {
            // Return 503 (Service Unavailable) instead of 404
            // This prevents axios interceptor from redirecting to login
            return res.status(503).json({ 
                error: 'No Rclone Server Configured',
                message: 'No rclone backend server is configured. Please add a server in Menu → Rclone Servers.',
                code: 'NO_SERVER_CONFIGURED'
            });
        }
        
        // Decrypt password
        let password = server.password; // Fallback for old plaintext
        if (server.encryptedPassword) {
            try {
                password = auth.decryptPassword(server.encryptedPassword, adminPassword);
            } catch (error) {
                console.error('[PROXY] Decryption error:', error.message);
                return res.status(401).json({ 
                    error: 'Failed to decrypt server credentials',
                    details: 'Invalid admin password'
                });
            }
        }
        
        console.log(`[PROXY] ${req.method} ${rclonePath} → ${server.url}`);
        
        // Check if this is a OneDrive operation that might need drive_id/drive_type
        // Extract remote name from request body if available
        let remoteName = null;
        if (req.body && typeof req.body === 'object') {
            // Check common fields that might contain remote name
            remoteName = req.body.remote || req.body.fs || req.body.src || req.body.dst;
            // Remove trailing colon if present (e.g., "one-drive:" -> "one-drive")
            if (remoteName && typeof remoteName === 'string') {
                remoteName = remoteName.replace(/:$/, '');
            }
        }
        
        // If this is a OneDrive operation and we have a remote name, check if drive_id/drive_type are missing
        if (remoteName && (rclonePath.includes('operations/list') || rclonePath.includes('operations/fsinfo') || rclonePath.includes('operations/about'))) {
            try {
                const configResponse = await axiosInstance.post(
                    `${server.url}/config/get`,
                    { name: remoteName },
                    {
                        auth: { username: server.username, password: password },
                        timeout: 5000
                    }
                );
                
                const config = configResponse.data;
                if (config && config.type === 'onedrive') {
                    const hasDriveId = config.drive_id || config.parameters?.drive_id;
                    const hasDriveType = config.drive_type || config.parameters?.drive_type;
                    
                    if (!hasDriveId || !hasDriveType) {
                        console.log(`[PROXY] OneDrive remote "${remoteName}" missing drive_id/drive_type, attempting to fix...`);
                        try {
                            // Import OneDrive provider directly
                            const OneDriveProvider = require('../oauth/providers/onedrive');
                            const provider = new OneDriveProvider();
                            
                            // Get token from config
                            const tokenString = config.token || config.parameters?.token;
                            if (!tokenString) {
                                throw new Error('No token found');
                            }
                            
                            const tokenJson = JSON.parse(tokenString);
                            const region = config.region || config.parameters?.region || 'global';
                            const clientId = config.client_id || config.parameters?.client_id || provider.config.clientId;
                            const clientSecret = config.client_secret || config.parameters?.client_secret || provider.config.clientSecret;
                            
                            // Fetch drive info
                            const driveInfo = await provider.getDriveInfo(
                                tokenJson.access_token,
                                tokenJson.refresh_token || null,
                                { clientId, clientSecret, region }
                            );
                            
                            // Update config
                            let updatePayload;
                            if (config.parameters && Object.keys(config.parameters).length > 0) {
                                updatePayload = {
                                    name: remoteName,
                                    parameters: {
                                        ...config.parameters,
                                        drive_id: driveInfo.drive_id,
                                        drive_type: driveInfo.drive_type
                                    }
                                };
                            } else {
                                const rootFields = { ...config };
                                rootFields.drive_id = driveInfo.drive_id;
                                rootFields.drive_type = driveInfo.drive_type;
                                updatePayload = {
                                    name: remoteName,
                                    parameters: rootFields
                                };
                            }
                            
                            await axiosInstance.post(
                                `${server.url}/config/update`,
                                updatePayload,
                                {
                                    auth: { username: server.username, password: password },
                                    timeout: 10000
                                }
                            );
                            
                            console.log(`[PROXY] Successfully fixed OneDrive remote "${remoteName}" with drive_id and drive_type`);
                        } catch (fixError) {
                            console.error(`[PROXY] Failed to fix OneDrive remote:`, fixError.message);
                            // Continue with request - might still work if RCD can handle it
                        }
                    }
                }
            } catch (checkError) {
                // If config check fails, continue with request
                console.debug(`[PROXY] Could not check OneDrive config:`, checkError.message);
            }
        }
        
        // Check if this is a file upload request
        const isFileUpload = rclonePath.includes('operations/uploadfile') && req.files && req.files.length > 0;
        
        if (isFileUpload) {
            // Handle file upload with multipart/form-data
            console.log(`[PROXY] File upload detected: ${req.files.length} file(s)`);
            
            const formData = new FormData();
            
            // Append each file to the form data
            // IMPORTANT: rclone expects field name "file" (not "file0", "file1", etc.)
            for (const file of req.files) {
                formData.append('file', file.buffer, {
                    filename: file.originalname,
                    contentType: file.mimetype
                });
            }
            
            // Proxy the request with multipart data
            const response = await axiosInstance({
                method: req.method,
                url: `${server.url}/${rclonePath}`,
                data: formData,
                params: req.query,
                auth: { username: server.username, password: password },
                headers: {
                    ...formData.getHeaders() // This sets Content-Type: multipart/form-data with boundary
                },
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
                timeout: 300000 // 5 minutes for long operations
            });
            
            res.json(response.data);
        } else {
            // Regular JSON request
            const response = await axiosInstance({
                method: req.method,
                url: `${server.url}/${rclonePath}`,
                data: req.body,
                params: req.query,
                auth: { username: server.username, password: password },
                headers: { 'Content-Type': 'application/json' },
                timeout: 300000 // 5 minutes for long operations
            });
            
            res.json(response.data);
        }
    } catch (error) {
        console.error('[PROXY] Error:', error.message);
        
        // Handle connection errors with user-friendly messages
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
            return res.status(503).json({
                error: 'Server Not Connected',
                message: 'Cannot connect to the selected rclone server. Please switch to a connected server using the server selector in the top navigation bar, or check if your rclone backend is running.',
                code: error.code,
                serverUrl: server ? server.url : 'unknown',
                suggestion: 'Click on the server name in the top navigation bar to switch to another server, or go to Menu → Rclone Servers to manage your server configurations.'
            });
        }
        
        // Handle authentication errors
        if (error.response?.status === 401) {
            return res.status(401).json({
                error: 'Authentication Failed',
                message: 'Invalid credentials for the rclone server. Please check the username and password in Menu → Rclone Servers.',
                details: error.response?.data
            });
        }
        
        res.status(error.response?.status || 500).json({
            error: error.message,
            details: error.response?.data || error.message
        });
    }
});

module.exports = router;

