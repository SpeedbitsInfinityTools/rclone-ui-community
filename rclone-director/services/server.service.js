/**
 * Server Service
 * Business logic for server operations
 */

const axios = require('axios');
const https = require('https');

// Create axios instance that accepts self-signed certificates for localhost
const axiosInstance = axios.create({
    httpsAgent: new https.Agent({
        rejectUnauthorized: false // Accept self-signed certs (for localhost RCD only)
    })
});

/**
 * Test connection to rclone server
 */
async function testServerConnection(serverUrl, username, password) {
    try {
        const response = await axiosInstance.post(
            `${serverUrl}/rc/noop`,
            {},
            {
                auth: { username, password },
                timeout: 5000
            }
        );
        
        return {
            success: true,
            message: 'Connection successful',
            data: response.data
        };
    } catch (error) {
        return {
            success: false,
            message: error.message,
            error: error.code || 'CONNECTION_ERROR'
        };
    }
}

/**
 * Get server by ID from config
 */
function getServerById(serversConfig, serverId) {
    return serversConfig.servers.find(s => s.id === serverId);
}

/**
 * Validate server configuration
 */
function validateServer(server) {
    const errors = [];
    
    if (!server.name || server.name.trim() === '') {
        errors.push('Server name is required');
    }
    
    if (!server.url || server.url.trim() === '') {
        errors.push('Server URL is required');
    } else {
        try {
            new URL(server.url);
        } catch (e) {
            errors.push('Server URL is invalid');
        }
    }
    
    if (!server.username || server.username.trim() === '') {
        errors.push('Username is required');
    }
    
    if (!server.password || server.password.trim() === '') {
        errors.push('Password is required');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

module.exports = {
    axiosInstance,
    testServerConnection,
    getServerById,
    validateServer
};

