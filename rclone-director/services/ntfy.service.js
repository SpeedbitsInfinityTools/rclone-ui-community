/**
 * Native ntfy Notification Service for Rclone Director
 * Sends push notifications directly to ntfy server via HTTP POST.
 * No external dependencies - uses Node.js built-in fetch.
 */

const fs = require('fs').promises;
const path = require('path');
const { DATA_DIR } = require('../config/constants');

const NTFY_CONFIG_FILE = path.join(DATA_DIR, 'ntfy-config.json');

const DEFAULT_CONFIG = {
    enabled: false,
    server: 'https://ntfy.sh',
    topic: '',
    auth: {
        type: 'none',
        username: '',
        password: '',
        token: ''
    },
    defaults: {
        priority: 'default',
        tags: ['rclone-ui']
    },
    monitoring: {
        enabled: false,
        intervalSeconds: 60
    },
    notifications: {
        rclone_down: {
            enabled: true,
            title: 'Rclone Server Down',
            message: 'Rclone RCD server is unreachable',
            priority: 'high',
            tags: ['x', 'rclone-ui']
        },
        rclone_recovered: {
            enabled: true,
            title: 'Rclone Server Recovered',
            message: 'Rclone RCD server is back online',
            priority: 'default',
            tags: ['white_check_mark', 'rclone-ui']
        },
        mount_error: {
            enabled: true,
            title: 'Mount Error',
            message: 'A mounted drive is inaccessible',
            priority: 'high',
            tags: ['warning', 'rclone-ui']
        },
        auth_error: {
            enabled: true,
            title: 'Authentication Error',
            message: 'Credentials expired or invalid on a remote',
            priority: 'urgent',
            tags: ['rotating_light', 'rclone-ui']
        }
    }
};

const PRIORITY_MAP = {
    'min': 1,
    'low': 2,
    'default': 3,
    'high': 4,
    'urgent': 5
};

function normalizeConfig(config = {}) {
    return {
        ...DEFAULT_CONFIG,
        ...config,
        auth: {
            ...DEFAULT_CONFIG.auth,
            ...(config.auth || {})
        },
        defaults: {
            ...DEFAULT_CONFIG.defaults,
            ...(config.defaults || {})
        },
        monitoring: {
            ...DEFAULT_CONFIG.monitoring,
            ...(config.monitoring || {})
        },
        notifications: {
            ...DEFAULT_CONFIG.notifications,
            ...(config.notifications || {})
        }
    };
}

function validateConfig(config) {
    const normalized = normalizeConfig(config);
    let parsedUrl;
    try {
        parsedUrl = new URL(normalized.server);
    } catch {
        throw new Error('Invalid ntfy server URL');
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('ntfy server URL must use http or https');
    }

    if (normalized.monitoring.intervalSeconds < 10) {
        throw new Error('Monitoring interval must be at least 10 seconds');
    }

    return normalized;
}

async function loadConfig() {
    try {
        const data = await fs.readFile(NTFY_CONFIG_FILE, 'utf8');
        const config = JSON.parse(data);
        return normalizeConfig(config);
    } catch (error) {
        return normalizeConfig(DEFAULT_CONFIG);
    }
}

async function saveConfig(configData) {
    const normalized = validateConfig(configData);
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(NTFY_CONFIG_FILE, JSON.stringify(normalized, null, 2));
    console.log('[NTFY] Configuration saved');
}

/**
 * Return config with secrets masked for frontend display
 */
function maskConfig(config) {
    return {
        ...config,
        auth: {
            type: config.auth?.type || 'none',
            username: config.auth?.username || '',
            password: config.auth?.password ? '********' : '',
            token: config.auth?.token ? '********' : ''
        }
    };
}

/**
 * Merge incoming config with existing, preserving masked secrets
 */
async function mergeWithExistingSecrets(newConfig) {
    if (!newConfig.auth) return newConfig;
    const existing = await loadConfig();
    if (newConfig.auth.password === '********' && existing.auth?.password) {
        newConfig.auth.password = existing.auth.password;
    }
    if (newConfig.auth.token === '********' && existing.auth?.token) {
        newConfig.auth.token = existing.auth.token;
    }
    return newConfig;
}

function buildAuthHeader(auth) {
    if (!auth || auth.type === 'none') return null;
    if (auth.type === 'token' && auth.token) {
        return `Bearer ${auth.token}`;
    }
    if (auth.type === 'basic' && auth.username && auth.password) {
        const credentials = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
        return `Basic ${credentials}`;
    }
    return null;
}

/**
 * Send a raw notification to the ntfy server
 */
async function sendToNtfy(options = {}) {
    const config = await loadConfig();

    if (!config.enabled) {
        return { success: false, message: 'ntfy is not enabled' };
    }
    if (!config.topic) {
        return { success: false, message: 'ntfy topic is not configured' };
    }

    const url = `${config.server.replace(/\/$/, '')}/${config.topic}`;
    const headers = { 'Content-Type': 'text/plain' };

    if (options.title) headers['Title'] = options.title;

    const priority = options.priority || config.defaults?.priority || 'default';
    headers['Priority'] = String(PRIORITY_MAP[priority] || 3);

    const tags = options.tags || config.defaults?.tags || ['rclone-ui'];
    if (tags.length > 0) headers['Tags'] = tags.join(',');

    const authHeader = buildAuthHeader(config.auth);
    if (authHeader) headers['Authorization'] = authHeader;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: options.message || 'Notification from Rclone UI'
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`ntfy responded with ${response.status}: ${errorText}`);
        }

        return { success: true, message: 'Notification sent successfully' };
    } catch (error) {
        console.error('[NTFY] Failed to send notification:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Send a typed notification (rclone_down, mount_error, etc.)
 */
async function sendNotification(type, customData = {}) {
    const config = await loadConfig();
    if (!config.enabled) {
        return { success: false, message: 'ntfy is not enabled' };
    }

    const notification = config.notifications?.[type];
    if (!notification || !notification.enabled) {
        return { success: false, message: `Notification type '${type}' not configured or disabled` };
    }

    return sendToNtfy({
        title: customData.title || notification.title,
        message: customData.message || notification.message,
        priority: customData.priority || notification.priority,
        tags: customData.tags || notification.tags
    });
}

/**
 * Test ntfy connection by sending a test notification
 */
async function testConnection(testConfig = null) {
    const config = testConfig || await loadConfig();

    if (!config.topic) {
        return { success: false, error: 'ntfy topic is not configured' };
    }

    const url = `${(config.server || 'https://ntfy.sh').replace(/\/$/, '')}/${config.topic}`;
    const headers = {
        'Content-Type': 'text/plain',
        'Title': 'Rclone UI - Test Notification',
        'Priority': '3',
        'Tags': 'test,rclone-ui'
    };

    const authHeader = buildAuthHeader(config.auth);
    if (authHeader) headers['Authorization'] = authHeader;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: 'This is a test notification from Rclone Director UI'
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`ntfy responded with ${response.status}: ${errorText}`);
        }

        return { success: true, message: 'Test notification sent successfully' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

module.exports = {
    loadConfig,
    saveConfig,
    maskConfig,
    mergeWithExistingSecrets,
    sendToNtfy,
    sendNotification,
    testConnection,
    DEFAULT_CONFIG,
    NTFY_CONFIG_FILE,
    normalizeConfig,
    validateConfig
};
