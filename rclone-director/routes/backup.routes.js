/**
 * Backup & Restore Routes
 * Handles export and import of configuration data
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const auth = require('../auth');
const { 
    loadServers, 
    saveServers, 
    loadTemplates, 
    saveTemplates,
    loadPersistentMounts,
    savePersistentMounts
} = require('../services/data.service');

/**
 * Constant-time string comparison to prevent timing attacks
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} - True if strings match
 */
function secureCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') {
        return false;
    }
    
    // Convert strings to buffers for constant-time comparison
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    
    // Use crypto.timingSafeEqual which is constant-time
    try {
        return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
    } catch (error) {
        // timingSafeEqual throws if lengths differ (not constant-time safe)
        // So we check length first and return false
        return false;
    }
}

/**
 * Validate backup data structure
 * @param {object} data - Import data
 * @returns {object} - { valid: boolean, error: string }
 */
function validateBackupData(data) {
    // Check top-level structure
    if (!data || typeof data !== 'object') {
        return { valid: false, error: 'Invalid data format: not an object' };
    }
    
    if (!data.exportMetadata || typeof data.exportMetadata !== 'object') {
        return { valid: false, error: 'Missing or invalid exportMetadata' };
    }
    
    if (!data.rcdServers || !Array.isArray(data.rcdServers)) {
        return { valid: false, error: 'Missing or invalid rcdServers array' };
    }
    
    if (!data.templates || !Array.isArray(data.templates)) {
        return { valid: false, error: 'Missing or invalid templates array' };
    }
    
    // Validate metadata
    if (!data.exportMetadata.version || !data.exportMetadata.exportDate) {
        return { valid: false, error: 'Invalid exportMetadata: missing required fields' };
    }
    
    // Validate servers
    for (const server of data.rcdServers) {
        if (!server.name || !server.url || !server.username) {
            return { valid: false, error: `Invalid server: missing required fields (name, url, username)` };
        }
        if (typeof server.name !== 'string' || typeof server.url !== 'string') {
            return { valid: false, error: `Invalid server: name and url must be strings` };
        }
    }
    
    // Validate templates
    for (const template of data.templates) {
        if (!template.name || !template.type || !template.parameters) {
            return { valid: false, error: `Invalid template: missing required fields (name, type, parameters)` };
        }
        if (typeof template.parameters !== 'object') {
            return { valid: false, error: `Invalid template: parameters must be an object` };
        }
    }
    
    // Validate mounts (optional)
    if (data.persistentMounts) {
        if (!Array.isArray(data.persistentMounts)) {
            return { valid: false, error: 'Invalid persistentMounts: must be an array' };
        }
        for (const mount of data.persistentMounts) {
            if (!mount.fs || !mount.mountPoint) {
                return { valid: false, error: `Invalid mount: missing required fields (fs, mountPoint)` };
            }
        }
    }
    
    return { valid: true };
}

/**
 * POST /director/backup/export - Export all settings (decrypted)
 * Protected: Requires admin authentication
 * Body: { password } - User must re-enter password for security
 */
router.post('/export', auth.requireAdminAuth, async (req, res) => {
    try {
        const { password } = req.body;
        const adminPasswordOrKey = req.adminPassword; // master key stored in session

        if (!password) {
            return res.status(400).json({ error: 'Password is required for export' });
        }

        // Verify the password against stored bcrypt hash (do NOT compare with session master key)
        const isValid = await auth.verifyAdminPassword('admin', password);
        if (!isValid) {
            return res.status(403).json({ error: 'Password verification failed' });
        }

        console.log('[BACKUP] Starting export...');

        // Load and decrypt all data
        const servers = await loadServers();
        const templates = await loadTemplates();
        const mounts = await loadPersistentMounts();

        // Decrypt server passwords
        const decryptedServers = servers.servers.map(server => {
            let decryptedPassword = null;
            if (server.encryptedPassword) {
                try {
                    decryptedPassword = auth.decryptPassword(server.encryptedPassword, adminPasswordOrKey);
                } catch (error) {
                    console.error(`[BACKUP] Failed to decrypt password for server ${server.name}:`, error);
                    decryptedPassword = '[DECRYPTION_FAILED]';
                }
            } else if (server.password) {
                // Fallback for legacy plaintext password field
                decryptedPassword = server.password;
            }

            return {
                id: server.id,
                name: server.name,
                url: server.url,
                username: server.username,
                password: decryptedPassword,
                isDefault: server.isDefault,
                createdAt: server.createdAt
            };
        });

        // Decrypt template parameters
        const decryptedTemplates = templates.map(template => {
            const decryptParams = (params) => {
                const decrypted = {};
                for (const [key, paramObj] of Object.entries(params)) {
                    if (paramObj.encrypted) {
                        try {
                            decrypted[key] = auth.decryptPassword(paramObj.value, adminPasswordOrKey);
                        } catch (error) {
                            console.error(`[BACKUP] Failed to decrypt template parameter ${key}:`, error);
                            decrypted[key] = '[DECRYPTION_FAILED]';
                        }
                    } else {
                        decrypted[key] = paramObj.value;
                    }
                }
                return decrypted;
            };

            const decryptedTemplate = {
                id: template.id,
                name: template.name,
                description: template.description,
                type: template.type,
                parameters: decryptParams(template.parameters),
                createdAt: template.createdAt
            };

            // Decrypt base remote if present (for crypt templates)
            if (template.baseRemote && template.baseRemote.parameters) {
                decryptedTemplate.baseRemote = {
                    type: template.baseRemote.type,
                    parameters: decryptParams(template.baseRemote.parameters)
                };
            }

            return decryptedTemplate;
        });

        // Build export object
        const exportData = {
            exportMetadata: {
                version: '1.0.0',
                exportDate: new Date().toISOString(),
                exportedBy: 'admin', // Future: get from user context
                rcloneDirectorVersion: '1.0.0'
            },
            rcdServers: decryptedServers,
            templates: decryptedTemplates,
            persistentMounts: mounts.mounts || []
        };

        console.log('[BACKUP] Export completed successfully');
        console.log(`[BACKUP] Exported: ${decryptedServers.length} servers, ${decryptedTemplates.length} templates, ${exportData.persistentMounts.length} mounts`);

        res.json(exportData);
    } catch (error) {
        console.error('[BACKUP] Export failed:', error);
        res.status(500).json({ error: 'Failed to export settings', details: error.message });
    }
});

/**
 * POST /director/backup/import - Import settings from backup file
 * Protected: Requires admin authentication
 * Body: { data, password, mode } 
 *   - data: The exported JSON data
 *   - password: User password for re-encryption
 *   - mode: 'merge' or 'replace'
 */
router.post('/import', auth.requireAdminAuth, async (req, res) => {
    try {
        const { data, password, mode = 'merge' } = req.body;
        const adminPasswordOrKey = req.adminPassword; // master key stored in session

        if (!data) {
            return res.status(400).json({ error: 'Import data is required' });
        }

        if (!password) {
            return res.status(400).json({ error: 'Password is required for import' });
        }

        // Verify password against stored bcrypt hash (do NOT compare with session master key)
        const isValid = await auth.verifyAdminPassword('admin', password);
        if (!isValid) {
            return res.status(403).json({ error: 'Password verification failed' });
        }

        // Validate import data structure thoroughly
        const validation = validateBackupData(data);
        if (!validation.valid) {
            return res.status(400).json({ error: 'Invalid import file format', details: validation.error });
        }

        console.log('[BACKUP] Starting import...');
        console.log(`[BACKUP] Import mode: ${mode}`);
        console.log(`[BACKUP] Importing: ${data.rcdServers.length} servers, ${data.templates.length} templates, ${data.persistentMounts?.length || 0} mounts`);

        const importStats = {
            servers: { imported: 0, skipped: 0, failed: 0 },
            templates: { imported: 0, skipped: 0, failed: 0 },
            mounts: { imported: 0, skipped: 0, failed: 0 }
        };

        // Import RCD Servers
        const currentServers = await loadServers();
        
        // Safeguard: reject replace mode with empty servers array
        if (mode === 'replace' && (!data.rcdServers || data.rcdServers.length === 0)) {
            return res.status(400).json({
                error: 'Cannot replace servers with empty list',
                details: 'Replace mode requires at least one server. Use merge mode or include servers in the backup file.'
            });
        }
        
        let newServers = mode === 'replace' ? [] : [...currentServers.servers];

        for (const server of data.rcdServers) {
            try {
                // Check for duplicates
                const exists = newServers.find(s => s.id === server.id || (s.name === server.name && s.url === server.url));
                
                if (exists && mode === 'merge') {
                    console.log(`[BACKUP] Skipping duplicate server: ${server.name}`);
                    importStats.servers.skipped++;
                    continue;
                }

                // Re-encrypt password
                const encryptedPassword = server.password ? auth.encryptPassword(server.password, adminPasswordOrKey) : null;

                newServers.push({
                    id: server.id || `server_${uuidv4()}`,
                    name: server.name,
                    url: server.url,
                    username: server.username,
                    encryptedPassword: encryptedPassword,
                    isDefault: server.isDefault || false,
                    createdAt: server.createdAt || new Date().toISOString()
                });

                importStats.servers.imported++;
            } catch (error) {
                console.error(`[BACKUP] Failed to import server ${server.name}:`, error);
                importStats.servers.failed++;
            }
        }

        // Compute consistent defaultServerId
        // If replace mode or current defaultServerId doesn't exist in new servers, find a new default
        let defaultServerId = currentServers.defaultServerId;
        if (mode === 'replace' || !newServers.some(s => s.id === defaultServerId)) {
            const explicitDefault = newServers.find(s => s.isDefault);
            defaultServerId = explicitDefault?.id || newServers[0]?.id || null;
        }
        
        await saveServers({ servers: newServers, defaultServerId });

        // Import Templates
        let currentTemplates = await loadTemplates();
        let newTemplates = mode === 'replace' ? [] : [...currentTemplates];

        for (const template of data.templates) {
            try {
                // Check for duplicates
                const exists = newTemplates.find(t => t.id === template.id || t.name === template.name);
                
                if (exists && mode === 'merge') {
                    console.log(`[BACKUP] Skipping duplicate template: ${template.name}`);
                    importStats.templates.skipped++;
                    continue;
                }

                // Re-encrypt parameters
                const encryptParams = (params) => {
                    const encrypted = {};
                    const sensitiveFields = ['password', 'password2', 'client_secret', 'token', 'account_key', 'access_key_id', 'secret_access_key'];
                    
                    for (const [key, value] of Object.entries(params)) {
                        if (sensitiveFields.includes(key) && value && value !== '[DECRYPTION_FAILED]') {
                            encrypted[key] = {
                                encrypted: true,
                                value: auth.encryptPassword(value, adminPasswordOrKey)
                            };
                        } else {
                            encrypted[key] = {
                                encrypted: false,
                                value: value
                            };
                        }
                    }
                    return encrypted;
                };

                const encryptedTemplate = {
                    id: template.id || `template_${uuidv4()}`,
                    name: template.name,
                    description: template.description || '',
                    type: template.type,
                    parameters: encryptParams(template.parameters),
                    createdAt: template.createdAt || new Date().toISOString()
                };

                // Re-encrypt base remote if present
                if (template.baseRemote && template.baseRemote.parameters) {
                    encryptedTemplate.baseRemote = {
                        type: template.baseRemote.type,
                        parameters: encryptParams(template.baseRemote.parameters)
                    };
                }

                newTemplates.push(encryptedTemplate);
                importStats.templates.imported++;
            } catch (error) {
                console.error(`[BACKUP] Failed to import template ${template.name}:`, error);
                importStats.templates.failed++;
            }
        }

        await saveTemplates(newTemplates);

        // Import Persistent Mounts
        if (data.persistentMounts && data.persistentMounts.length > 0) {
            const currentMounts = await loadPersistentMounts();
            let newMounts = mode === 'replace' ? [] : [...(currentMounts.mounts || [])];

            for (const mount of data.persistentMounts) {
                try {
                    // Check for duplicates
                    const exists = newMounts.find(m => m.id === mount.id || m.mountPoint === mount.mountPoint);
                    
                    if (exists && mode === 'merge') {
                        console.log(`[BACKUP] Skipping duplicate mount: ${mount.mountPoint}`);
                        importStats.mounts.skipped++;
                        continue;
                    }

                    newMounts.push({
                        ...mount,
                        id: mount.id || `mount_${uuidv4()}`
                    });

                    importStats.mounts.imported++;
                } catch (error) {
                    console.error(`[BACKUP] Failed to import mount ${mount.mountPoint}:`, error);
                    importStats.mounts.failed++;
                }
            }

            await savePersistentMounts({ mounts: newMounts });
        }

        console.log('[BACKUP] Import completed successfully');
        console.log('[BACKUP] Import statistics:', importStats);

        res.json({
            success: true,
            message: 'Settings imported successfully',
            statistics: importStats
        });
    } catch (error) {
        console.error('[BACKUP] Import failed:', error);
        res.status(500).json({ error: 'Failed to import settings', details: error.message });
    }
});

module.exports = router;

