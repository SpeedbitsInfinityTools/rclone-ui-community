/**
 * Mount Service
 * Business logic for mount operations
 */

const { axiosInstance } = require('./server.service');

/**
 * Validate mount configuration
 */
function validateMount(mount) {
    const errors = [];
    
    if (!mount.fs || mount.fs.trim() === '') {
        errors.push('Remote path (fs) is required');
    }
    
    if (!mount.mountPoint || mount.mountPoint.trim() === '') {
        errors.push('Mount point is required');
    }
    
    if (!mount.serverId || mount.serverId.trim() === '') {
        errors.push('Server ID is required');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

/**
 * Create mount on rclone server
 */
async function createMount(serverUrl, auth, mountConfig) {
    try {
        const response = await axiosInstance.post(
            `${serverUrl}/mount/mount`,
            mountConfig,
            {
                auth,
                timeout: 10000
            }
        );
        
        return {
            success: true,
            data: response.data
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            code: error.code || 'MOUNT_ERROR'
        };
    }
}

/**
 * Unmount from rclone server
 */
async function unmount(serverUrl, auth, mountPoint) {
    try {
        const response = await axiosInstance.post(
            `${serverUrl}/mount/unmount`,
            { mountPoint },
            {
                auth,
                timeout: 10000
            }
        );
        
        return {
            success: true,
            data: response.data
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            code: error.code || 'UNMOUNT_ERROR'
        };
    }
}

/**
 * List active mounts from rclone server
 */
async function listMounts(serverUrl, auth) {
    try {
        const response = await axiosInstance.post(
            `${serverUrl}/mount/listmounts`,
            {},
            {
                auth,
                timeout: 5000
            }
        );
        
        return {
            success: true,
            data: response.data
        };
    } catch (error) {
        return {
            success: false,
            error: error.message,
            code: error.code || 'LIST_ERROR'
        };
    }
}

module.exports = {
    validateMount,
    createMount,
    unmount,
    listMounts
};

