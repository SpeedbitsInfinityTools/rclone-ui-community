/**
 * Template Service
 * Business logic for template operations
 */

const { v4: uuidv4 } = require('uuid');

/**
 * Validate template data
 */
function validateTemplate(template) {
    const errors = [];
    
    if (!template.name || template.name.trim() === '') {
        errors.push('Template name is required');
    }
    
    if (!template.remoteType || template.remoteType.trim() === '') {
        errors.push('Remote type is required');
    }
    
    if (!template.config || typeof template.config !== 'object') {
        errors.push('Template config must be an object');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Create a new template with generated ID and timestamps
 */
function createTemplate(templateData) {
    return {
        id: uuidv4(),
        name: templateData.name,
        description: templateData.description || '',
        remoteType: templateData.remoteType,
        config: templateData.config,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

/**
 * Update existing template with new data
 */
function updateTemplate(existingTemplate, updates) {
    return {
        ...existingTemplate,
        name: updates.name !== undefined ? updates.name : existingTemplate.name,
        description: updates.description !== undefined ? updates.description : existingTemplate.description,
        remoteType: updates.remoteType !== undefined ? updates.remoteType : existingTemplate.remoteType,
        config: updates.config !== undefined ? updates.config : existingTemplate.config,
        updatedAt: new Date().toISOString()
    };
}

module.exports = {
    validateTemplate,
    createTemplate,
    updateTemplate
};

