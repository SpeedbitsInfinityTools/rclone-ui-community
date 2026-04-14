/**
 * Notification Routes for Rclone Director
 * Handles ntfy configuration, test sending, and health monitor control.
 */

const express = require('express');
const router = express.Router();
const auth = require('../auth');
const ntfyService = require('../services/ntfy.service');

// Lazy-loaded health monitor (initialized by server.js)
let healthMonitor = null;
function setHealthMonitor(monitor) {
    healthMonitor = monitor;
}

// ============================================================================
// NTFY CONFIGURATION
// ============================================================================

router.get('/config', auth.requireAdminAuth, async (req, res) => {
    try {
        const config = await ntfyService.loadConfig();
        res.json(ntfyService.maskConfig(config));
    } catch (error) {
        console.error('[NOTIFICATIONS] Failed to get config:', error.message);
        res.status(500).json({ error: 'Failed to load notification configuration' });
    }
});

router.post('/config', auth.requireAdminAuth, async (req, res) => {
    try {
        let newConfig = req.body;
        newConfig = await ntfyService.mergeWithExistingSecrets(newConfig);

        // Auto-manage monitoring: runs whenever ntfy is fully configured.
        // User can temporarily pause via the Pause button (sets monitoring.paused=true).
        const ntfyFullyConfigured = newConfig.enabled && newConfig.topic;
        const userPaused = newConfig.monitoring?.paused === true;
        newConfig.monitoring = {
            ...newConfig.monitoring,
            enabled: ntfyFullyConfigured && !userPaused
        };

        await ntfyService.saveConfig(newConfig);

        if (healthMonitor) {
            if (newConfig.monitoring.enabled) {
                healthMonitor.start(newConfig.monitoring.intervalSeconds || 60);
            } else {
                healthMonitor.stop();
            }
        }

        res.json({ success: true, message: 'Notification configuration saved' });
    } catch (error) {
        console.error('[NOTIFICATIONS] Failed to save config:', error.message);
        res.status(500).json({ error: 'Failed to save notification configuration' });
    }
});

// ============================================================================
// TEST NOTIFICATION
// ============================================================================

router.post('/test', auth.requireAdminAuth, async (req, res) => {
    try {
        const testConfig = req.body.config || null;
        let configToTest = testConfig;

        if (configToTest?.auth) {
            configToTest = await ntfyService.mergeWithExistingSecrets(configToTest);
        }

        const result = await ntfyService.testConnection(configToTest);
        res.json(result);
    } catch (error) {
        console.error('[NOTIFICATIONS] Failed to send test:', error.message);
        res.status(500).json({ error: 'Failed to send test notification' });
    }
});

// ============================================================================
// STATUS
// ============================================================================

router.get('/status', auth.requireAdminAuth, async (req, res) => {
    try {
        const config = await ntfyService.loadConfig();
        const monitorStatus = healthMonitor ? healthMonitor.getStatus() : { running: false };

        res.json({
            ntfy: {
                enabled: config.enabled || false,
                server: config.server || 'https://ntfy.sh',
                topic: config.topic || '',
                authType: config.auth?.type || 'none'
            },
            monitor: monitorStatus
        });
    } catch (error) {
        console.error('[NOTIFICATIONS] Failed to get status:', error.message);
        res.status(500).json({ error: 'Failed to get notification status' });
    }
});

// ============================================================================
// NOTIFICATION LOG
// ============================================================================

router.get('/log', auth.requireAdminAuth, async (req, res) => {
    try {
        const log = healthMonitor ? healthMonitor.getLog() : [];
        res.json({ log: log.slice(0, 50) });
    } catch (error) {
        console.error('[NOTIFICATIONS] Failed to get log:', error.message);
        res.status(500).json({ error: 'Failed to get notification log' });
    }
});

// ============================================================================
// HEALTH MONITOR CONTROL
// ============================================================================

router.post('/monitor/start', auth.requireAdminAuth, async (req, res) => {
    try {
        if (!healthMonitor) {
            return res.status(500).json({ error: 'Health monitor not initialized' });
        }
        const config = await ntfyService.loadConfig();
        const interval = config.monitoring?.intervalSeconds || 60;
        healthMonitor.start(interval);

        config.monitoring = { ...config.monitoring, enabled: true, paused: false };
        await ntfyService.saveConfig(config);

        res.json({ success: true, message: 'Health monitor started' });
    } catch (error) {
        console.error('[NOTIFICATIONS] Failed to start monitor:', error.message);
        res.status(500).json({ error: 'Failed to start health monitor' });
    }
});

router.post('/monitor/stop', auth.requireAdminAuth, async (req, res) => {
    try {
        if (!healthMonitor) {
            return res.status(500).json({ error: 'Health monitor not initialized' });
        }
        healthMonitor.stop();

        const config = await ntfyService.loadConfig();
        config.monitoring = { ...config.monitoring, enabled: false, paused: true };
        await ntfyService.saveConfig(config);

        res.json({ success: true, message: 'Health monitor paused' });
    } catch (error) {
        console.error('[NOTIFICATIONS] Failed to stop monitor:', error.message);
        res.status(500).json({ error: 'Failed to stop health monitor' });
    }
});

router.post('/monitor/run-now', auth.requireAdminAuth, async (req, res) => {
    try {
        if (!healthMonitor) {
            return res.status(500).json({ error: 'Health monitor not initialized' });
        }
        const results = await healthMonitor.runNow();
        res.json({ success: true, results });
    } catch (error) {
        console.error('[NOTIFICATIONS] Failed to run check:', error.message);
        res.status(500).json({ error: 'Failed to run health check' });
    }
});

router.put('/monitor/interval', auth.requireAdminAuth, async (req, res) => {
    try {
        const parsedInterval = parseInt(req.body.intervalSeconds, 10);
        if (!Number.isInteger(parsedInterval) || parsedInterval < 10) {
            return res.status(400).json({ error: 'Interval must be at least 10 seconds' });
        }

        const config = await ntfyService.loadConfig();
        config.monitoring = { ...config.monitoring, intervalSeconds: parsedInterval };
        await ntfyService.saveConfig(config);

        if (healthMonitor && config.monitoring?.enabled) {
            healthMonitor.start(parsedInterval);
        }

        res.json({ success: true, message: `Monitor interval set to ${parsedInterval}s` });
    } catch (error) {
        console.error('[NOTIFICATIONS] Failed to update interval:', error.message);
        res.status(500).json({ error: 'Failed to update monitor interval' });
    }
});

module.exports = router;
module.exports.setHealthMonitor = setHealthMonitor;
