/**
 * Template Management Routes
 * Handles CRUD operations for rclone configuration templates
 */

const express = require('express');
const router = express.Router();
const auth = require('../auth');
const { loadTemplates, saveTemplates } = require('../services/data.service');

/**
 * GET /director/templates - List all templates
 * Protected: Requires admin authentication
 */
router.get('/', auth.requireAdminAuth, async (req, res) => {
    try {
        const templates = await loadTemplates();
        res.json({ templates });
    } catch (error) {
        console.error('[TEMPLATES] Failed to load templates:', error);
        res.status(500).json({ error: 'Failed to load templates', details: error.message });
    }
});

/**
 * POST /director/templates - Create a new template
 * Protected: Requires admin authentication
 * Body: { name, description, type, parameters, baseRemote (optional, for crypt templates) }
 */
router.post('/', auth.requireAdminAuth, async (req, res) => {
    try {
        const { name, description, type, parameters, baseRemote } = req.body;
        const adminPassword = req.adminPassword;

        if (!name || !type || !parameters) {
            return res.status(400).json({ error: 'Missing required fields: name, type, parameters' });
        }

        const templates = await loadTemplates();

        // Check for duplicate name
        if (templates.find(t => t.name === name)) {
            return res.status(400).json({ error: 'Template with this name already exists' });
        }

        // Function to encrypt parameters
        const encryptParams = (params) => {
            const encryptedParams = {};
            const sensitiveFields = ['password', 'password2', 'client_secret', 'token', 'account_key', 'access_key_id', 'secret_access_key'];
            
            for (const [key, value] of Object.entries(params)) {
                if (sensitiveFields.includes(key) && value) {
                    // Encrypt sensitive value
                    encryptedParams[key] = {
                        encrypted: true,
                        value: auth.encryptPassword(value, adminPassword)
                    };
                } else {
                    // Store non-sensitive value as-is
                    encryptedParams[key] = {
                        encrypted: false,
                        value: value
                    };
                }
            }
            return encryptedParams;
        };

        // Encrypt main parameters
        const encryptedParameters = encryptParams(parameters);

        // Build template object
        const newTemplate = {
            id: `template_${Date.now()}`,
            name,
            description: description || '',
            type,
            parameters: encryptedParameters,
            createdAt: new Date().toISOString()
        };

        // If this is a crypt template with base remote, encrypt base remote parameters too
        if (baseRemote && baseRemote.type && baseRemote.parameters) {
            newTemplate.baseRemote = {
                type: baseRemote.type,
                parameters: encryptParams(baseRemote.parameters)
            };
            console.log('[TEMPLATES] Created crypt template with base remote');
        }

        templates.push(newTemplate);
        await saveTemplates(templates);

        console.log('[TEMPLATES] Created template:', newTemplate.name);
        res.json({ success: true, template: newTemplate });
    } catch (error) {
        console.error('[TEMPLATES] Failed to create template:', error);
        res.status(500).json({ error: 'Failed to create template', details: error.message });
    }
});

/**
 * GET /director/templates/:id - Get a single template (with decrypted values)
 * Protected: Requires admin authentication
 */
router.get('/:id', auth.requireAdminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const adminPassword = req.adminPassword;
        const templates = await loadTemplates();

        const template = templates.find(t => t.id === id);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }

        // Function to decrypt parameters
        const decryptParams = (params) => {
            const decrypted = {};
            for (const [key, paramObj] of Object.entries(params)) {
                if (paramObj.encrypted) {
                    try {
                        decrypted[key] = auth.decryptPassword(paramObj.value, adminPassword);
                    } catch (error) {
                        console.error(`[TEMPLATES] Failed to decrypt parameter ${key}:`, error);
                        throw new Error('Failed to decrypt template parameters');
                    }
                } else {
                    decrypted[key] = paramObj.value;
                }
            }
            return decrypted;
        };

        // Decrypt main parameters
        const decryptedParameters = decryptParams(template.parameters);

        // Build response
        const response = {
            ...template,
            parameters: decryptedParameters
        };

        // Decrypt base remote parameters if present (for crypt templates)
        if (template.baseRemote && template.baseRemote.parameters) {
            response.baseRemote = {
                type: template.baseRemote.type,
                parameters: decryptParams(template.baseRemote.parameters)
            };
        }

        res.json(response);
    } catch (error) {
        console.error('[TEMPLATES] Failed to get template:', error);
        res.status(500).json({ error: 'Failed to get template', details: error.message });
    }
});

/**
 * DELETE /director/templates/:id - Delete a template
 * Protected: Requires admin authentication
 */
router.delete('/:id', auth.requireAdminAuth, async (req, res) => {
    try {
        const { id } = req.params;
        let templates = await loadTemplates();

        const index = templates.findIndex(t => t.id === id);
        if (index === -1) {
            return res.status(404).json({ error: 'Template not found' });
        }

        const deletedTemplate = templates[index];
        templates = templates.filter(t => t.id !== id);
        await saveTemplates(templates);

        console.log('[TEMPLATES] Deleted template:', deletedTemplate.name);
        res.json({ success: true, message: 'Template deleted' });
    } catch (error) {
        console.error('[TEMPLATES] Failed to delete template:', error);
        res.status(500).json({ error: 'Failed to delete template', details: error.message });
    }
});

module.exports = router;

