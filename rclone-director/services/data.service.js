/**
 * Data Management Service
 * Handles loading and saving configuration files (servers, mounts, templates)
 */

const fs = require('fs').promises;
const { SERVERS_FILE, MOUNTS_FILE, TEMPLATES_FILE } = require('../config/constants');

/**
 * Get default server configuration
 */
function getDefaultServerConfig() {
    // Detect RCD configuration from environment
    const rcdPort = process.env.RCLONE_RCD_PORT || process.env.RCD_PORT || '5572';
    const rcdHost = process.env.RCLONE_DEFAULT_HOST || 'host.docker.internal';
    const rcdUrl = process.env.RCLONE_DEFAULT_URL || `http://${rcdHost}:${rcdPort}`;
    const rcdUser = process.env.RCLONE_DEFAULT_USER || 'admin';
    const rcdPass = process.env.RCLONE_DEFAULT_PASS || 'admin';
    
    console.log(`[SERVER] Creating default server: ${rcdUrl}`);
    
    return {
        servers: [
            {
                id: 'default',
                name: 'Local Rclone',
                url: rcdUrl,
                username: rcdUser,
                password: rcdPass,
                isDefault: true,
                createdAt: new Date().toISOString()
            }
        ],
        defaultServerId: 'default'
    };
}

/**
 * Load rclone servers configuration
 * IMPORTANT: Always returns valid config (creates default if file doesn't exist)
 */
async function loadServers() {
    try {
        const data = await fs.readFile(SERVERS_FILE, 'utf8');
        const parsed = JSON.parse(data);
        
        // Validate and fix structure if needed
        if (!parsed.servers || !Array.isArray(parsed.servers)) {
            console.warn('[SERVER] Invalid rclone-servers.json structure detected');
            console.warn('[SERVER] Expected: {servers: [...], defaultServerId: "id"}');
            console.warn('[SERVER] Got:', JSON.stringify(parsed, null, 2));
            
            // Try to fix common mistakes
            if (typeof parsed === 'object' && !parsed.servers) {
                // Flat structure like {default: {...}} - convert to proper format
                console.log('[SERVER] Attempting to fix flat structure...');
                const servers = Object.entries(parsed).map(([id, config]) => ({
                    id: id,
                    name: config.name || id,
                    url: config.url,
                    username: config.username,
                    password: config.password,
                    encryptedPassword: config.encryptedPassword,
                    isDefault: config.enabled || config.isDefault || false,
                    createdAt: config.createdAt || new Date().toISOString()
                }));
                
                const fixed = {
                    servers: servers,
                    defaultServerId: servers.find(s => s.isDefault)?.id || servers[0]?.id
                };
                
                console.log('[SERVER] ✅ Structure fixed, saving corrected format...');
                const saved = await saveServers(fixed);
                if (!saved) {
                    console.error('[SERVER] ⚠️  Failed to save fixed configuration (will use in-memory only)');
                }
                return fixed;
            }
            
            // Can't fix, create default and try to save
            console.error('[SERVER] Cannot fix structure, creating default configuration');
            const defaultConfig = getDefaultServerConfig();
            const saved = await saveServers(defaultConfig);
            if (!saved) {
                console.error('[SERVER] ⚠️  Failed to save default configuration (will use in-memory only)');
            }
            return defaultConfig;
        }
        
        console.log(`[SERVER] ✅ Loaded ${parsed.servers.length} server(s) from configuration`);
        return parsed;
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('[SERVER] No servers file found, creating default configuration');
            const defaultConfig = getDefaultServerConfig();
            const saved = await saveServers(defaultConfig);
            if (!saved) {
                console.error('[SERVER] ⚠️  Failed to save default configuration file');
                console.error('[SERVER] ⚠️  Director will continue with in-memory config only');
            }
            return defaultConfig;
        } else {
            console.error('[SERVER] Error loading servers file:', error.message);
            console.error('[SERVER] Using default configuration (in-memory only)');
            return getDefaultServerConfig();
        }
    }
}

/**
 * Save rclone servers configuration
 */
async function saveServers(config) {
    try {
        await fs.writeFile(SERVERS_FILE, JSON.stringify(config, null, 2));
        console.log(`[SERVER] ✅ Saved servers configuration to ${SERVERS_FILE}`);
        return true;
    } catch (error) {
        console.error('============================================================================');
        console.error('[ERROR] FAILED TO SAVE SERVERS CONFIGURATION');
        console.error('============================================================================');
        console.error('File:', SERVERS_FILE);
        console.error('Error:', error.message);
        console.error('Code:', error.code);
        if (error.code === 'EACCES') {
            console.error('CAUSE: Permission denied - Director cannot write to config directory');
            console.error('FIX: Run: chown -R 1000:1000', require('../config/constants').DATA_DIR);
        } else if (error.code === 'ENOENT') {
            console.error('CAUSE: Directory does not exist');
            console.error('FIX: Create directory:', require('../config/constants').DATA_DIR);
        }
        console.error('============================================================================');
        return false;
    }
}

/**
 * Load persistent mounts
 */
async function loadMounts() {
    try {
        const data = await fs.readFile(MOUNTS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

/**
 * Save persistent mounts
 */
async function saveMounts(mounts) {
    try {
        await fs.writeFile(MOUNTS_FILE, JSON.stringify(mounts, null, 2));
        return true;
    } catch (error) {
        console.error('Failed to save mounts:', error);
        return false;
    }
}

/**
 * Load persistent mounts (for backup/restore)
 * Returns { mounts: [...] } structure for compatibility with backup format
 */
async function loadPersistentMounts() {
    try {
        const mounts = await loadMounts();
        // Convert array format to { mounts: [...] } structure for backup compatibility
        return { mounts: Array.isArray(mounts) ? mounts : [] };
    } catch (error) {
        return { mounts: [] };
    }
}

/**
 * Save persistent mounts (for backup/restore)
 * Accepts { mounts: [...] } structure and converts to array format
 */
async function savePersistentMounts(data) {
    try {
        const mounts = data.mounts || [];
        await saveMounts(mounts);
        return true;
    } catch (error) {
        console.error('Failed to save persistent mounts:', error);
        return false;
    }
}

/**
 * Load templates from file
 */
async function loadTemplates() {
    try {
        const data = await fs.readFile(TEMPLATES_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // Return empty array if file doesn't exist
        console.log('No templates file found, returning empty array');
        return [];
    }
}

/**
 * Save templates to file
 */
async function saveTemplates(templates) {
    const { DATA_DIR } = require('../config/constants');
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(TEMPLATES_FILE, JSON.stringify(templates, null, 2));
    console.log('[TEMPLATES] Saved', templates.length, 'templates');
}

module.exports = {
    getDefaultServerConfig,
    loadServers,
    saveServers,
    loadMounts,
    saveMounts,
    loadPersistentMounts,
    savePersistentMounts,
    loadTemplates,
    saveTemplates
};

