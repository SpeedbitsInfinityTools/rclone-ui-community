import axios from "axios";
import {isLocalRemoteName} from "../Tools";
import {AUTH_KEY, SESSION_KEY} from "../Constants";
import urls from "./endpoint";

/**
 * Global level axios configuration for Rclone Director.
 * All API calls go through the Rclone Director backend proxy at /api/rclone
 */
let axiosInstance = axios.create({
    baseURL: '/api/rclone',  // Proxy through Rclone Director backend
    // Note: Don't set Content-Type here - let axios auto-detect based on data type
    // (FormData = multipart/form-data, Object = application/json)
    responseType: "json"
});

/**
 * Interceptor adds authentication and server selection to every axios request.
 */
axiosInstance.interceptors.request.use(
    config => {
        // Add session key header (REQUIRED for authentication)
        // This is a random token issued at login, stored on backend
        // NOT the password or master key!
        const sessionKey = sessionStorage.getItem(SESSION_KEY);
        if (sessionKey && sessionKey !== 'null' && sessionKey !== 'undefined') {
            config.headers['X-Session-Key'] = sessionKey;
        }
        
        // Add auth header if available (kept for backward compatibility)
        const authKey = sessionStorage.getItem(AUTH_KEY);
        if (authKey && authKey !== 'null' && authKey !== 'undefined') {
            config.headers.Authorization = 'Basic ' + authKey;
        }
        
        // Add selected rclone server header (optional - defaults to configured server)
        const selectedServerId = sessionStorage.getItem('RCLONE_SERVER_ID');
        if (selectedServerId && selectedServerId !== 'null' && selectedServerId !== 'undefined') {
            config.headers['X-Rclone-Server'] = selectedServerId;
        }
        
        // Set Content-Type for JSON requests, but let FormData auto-set for file uploads
        if (!(config.data instanceof FormData)) {
            config.headers['Content-Type'] = 'application/json';
        }
        
        return config;
    },
    error => Promise.reject(error)
);

/**
 * Response interceptor to handle 401 and 503 errors globally
 */
axiosInstance.interceptors.response.use(
    response => response, // Pass through successful responses
    error => {
        // IMPORTANT: Don't redirect if we're already on the login page to prevent infinite loops
        // HashRouter uses #/login format, so check hash exactly
        const currentHash = window.location.hash;
        const isLoginPage = currentHash === '#/login' || currentHash === '#/login/' || 
                           currentHash.startsWith('#/login?') || currentHash.startsWith('#/login/?');
        
        // Handle 503 Service Unavailable - RCD backend not reachable
        // IMPORTANT: Do NOT redirect to login, just pass through the error
        // Dashboard will handle it gracefully with a banner
        if (error.response && error.response.status === 503) {
            console.warn('[RCLONE] Backend unavailable (503) - dashboard will show error banner');
            return Promise.reject(error);
        }
        
        // Handle 401 Unauthorized - session expired or invalid
        if (error.response && error.response.status === 401) {
            // If we're already on the login page, just pass through the error
            if (isLoginPage) {
                console.log('[AUTH] 401 on login page - ignoring (prevents redirect loop)');
                return Promise.reject(error);
            }
            
            console.error('[AUTH] Session expired or invalid (401). Redirecting to login...');
            
            // Preserve server selection across logout/login
            const lastServerId = localStorage.getItem('RCLONE_LAST_SERVER_ID');
            
            // Clear all session data
            sessionStorage.clear();
            localStorage.clear();
            
            // Restore server selection
            if (lastServerId) {
                localStorage.setItem('RCLONE_LAST_SERVER_ID', lastServerId);
            }
            
            // Store error message for login page
            sessionStorage.setItem('LOGIN_ERROR', 'Your session has expired or is invalid. Please log in again.');
            
            // Redirect to login page (use hash routing)
            window.location.hash = '#/login';
            
            // Return a rejected promise to prevent further processing
            return Promise.reject(error);
        }
        
        // For all other errors, pass them through
        return Promise.reject(error);
    }
);

/**
 * Helper Method for moving a file/directory.
 * @param srcFs     {string}    remoteName of the source
 * @param srcRemote {string}    remotePath of the source
 * @param dstFs     {string}    remoteName of the destination
 * @param dstRemote {string}    remotePath of the destination
 * @param Name      {string}    name of the file/directory
 * @param IsDir     {boolean}   Determines whether the current path is a directory (true) or a file (false)
 * @returns         {Promise<*>}
 */
export function performMoveFile(srcFs, srcRemote, dstFs, dstRemote, Name, IsDir) {
    return performCopyOrMoveFile(srcFs, srcRemote, dstFs, dstRemote, Name, IsDir, 'move');
}

/**
 * Helper Method for copying a file/directory.
 * @param srcFs     {string}    remoteName of the source
 * @param srcRemote {string}    remotePath of the source
 * @param dstFs     {string}    remoteName of the destination
 * @param dstRemote {string}    remotePath of the destination
 * @param Name      {string}    name of the file/directory
 * @param IsDir     {boolean}   Determines whether the current path is a directory (true) or a file (false)
 * @returns         {Promise<*>}
 */
export function performCopyFile(srcFs, srcRemote, dstFs, dstRemote, Name, IsDir) {
    return performCopyOrMoveFile(srcFs, srcRemote, dstFs, dstRemote, Name, IsDir, 'copy');
}

/**
 * Perform the actual copying/ moving of a file/directory.
 * @access private
 * @param srcFs     {string}    remoteName of the source
 * @param srcRemote {string}    remotePath of the source
 * @param dstFs     {string}    remoteName of the destination
 * @param dstRemote {string}    remotePath of the destination
 * @param Name      {string}    name of the file/directory
 * @param IsDir     {boolean}   Determines whether the current path is a directory (true) or a file (false)
 * @param mode      {string}    Determines whether to copy or move. Allowed values: "copy", "move".
 * @returns         {Promise<AxiosResponse<T>>}
 */
async function performCopyOrMoveFile(srcFs, srcRemote, dstFs, dstRemote, Name, IsDir, mode) {
    let url = "";
    if (mode === "move") {
        if (IsDir) {
            url = urls.moveDir;
        } else {
            url = urls.moveFile;
        }
    } else {
        if (IsDir) {
            url = urls.copyDir;
        } else {
            url = urls.copyFile;
        }
    }

    if (isLocalRemoteName(srcFs)) {
        srcFs = "";
    }

    if (isLocalRemoteName(dstFs)) {
        dstFs = "";
    }

    let data = {
        _async: true
    };


    if (IsDir) {

        const splitRes = srcRemote.split('/');

        data = {
            ...data,
            srcFs: srcFs + srcRemote,
            dstFs: dstFs + dstRemote + "/" + splitRes[splitRes.length - 1],
        };
        console.log("DirOp:", data);
        return await axiosInstance.post(url, data);

    } else {
        if (dstRemote === "") {
            dstRemote = Name;
        } else {
            dstRemote += "/" + Name;
        }

        data = {
            ...data,
            srcFs: srcFs,
            srcRemote: srcRemote,
            dstFs: dstFs,
            dstRemote: dstRemote,
        };
        return await axiosInstance.post(url, data);

    }
}


export default axiosInstance;
