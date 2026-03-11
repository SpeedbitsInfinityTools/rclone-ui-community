import {CHANGE_AUTH_KEY, CHANGE_AXIOS_INTERCEPTOR, CHANGE_IP_ADDRESS, SIGNOUT_REQUEST} from "./types";
import directorAPI from "../utils/API/director";
import {SESSION_KEY} from "../utils/Constants";

/**
 * Sign out the current user and delete the redux cache
 * SECURITY: Also calls backend to invalidate session on server
 * @returns {Function}
 */
export const signOut = () => async dispatch => {
    // Only call backend logout if we have an active session
    // This prevents 401 errors and redirect loops on login page
    const sessionKey = sessionStorage.getItem(SESSION_KEY);
    
    if (sessionKey && sessionKey !== 'null' && sessionKey !== 'undefined') {
        try {
            // Call backend to invalidate session on server
            // This is CRITICAL for security - prevents session reuse after logout
            await directorAPI.post('/auth/logout');
            console.log('[AUTH] Session invalidated on server');
        } catch (error) {
            // Even if backend call fails, still clear client-side storage
            // Don't log error if it's 401 (session already invalid)
            if (error.response?.status !== 401) {
                console.error('[AUTH] Failed to invalidate session on server:', error);
            }
        }
    }
    
    // Clear client-side storage and Redux state
    dispatch({
        type: SIGNOUT_REQUEST
    });
};

/**
 * Set new username and password for the rclone auth.
 * @param userName      {string}    New username to change.
 * @param password      {string}    New Password to change.
 * @returns             {Function}
 */
export const changeUserNamePassword = (userName, password) => dispatch => {
    dispatch({
        type: CHANGE_AUTH_KEY,
        payload: {authKey: btoa(userName + ":" + password), ipAddress: '/api/rclone'}
    });
    dispatch({
        type: CHANGE_AXIOS_INTERCEPTOR
    });
};

export const changeAuthKey = (authKey) => dispatch => {
    dispatch({
        type: CHANGE_AUTH_KEY,
        payload: {authKey: authKey, ipAddress: '/api/rclone'}
    });
    dispatch({
        type: CHANGE_AXIOS_INTERCEPTOR
    });
};

/**
 * Change the IPAddress of the rclone backend.
 * @param ipAddress
 * @returns {Function}
 */
export const changeIPAddress = (ipAddress) => dispatch => {
    dispatch({
        type: CHANGE_IP_ADDRESS,
        payload: {ipAddress}
    });
    dispatch({
        type: CHANGE_AXIOS_INTERCEPTOR
    });
};


