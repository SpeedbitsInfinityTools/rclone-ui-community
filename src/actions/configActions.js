import {GET_CONFIG_DUMP, GET_PROVIDERS, REMOVE_CONFIG_DUMP_ENTRY, REQUEST_ERROR, REQUEST_SUCCESS} from "./types";
import {getAllConfigDump, getAllProviders} from "rclone-api";
import {toast} from "react-toastify";

/**
 * Gets all Providers from the rclone UI Backend
 * @param {boolean} suppressToast - If true, don't show toast notifications (for pages with custom error handling)
 * @returns {Function}
 */
export const getProviders = (suppressToast = false) => dispatch => {
    getAllProviders().then(data => dispatch({
        type: GET_PROVIDERS,
        payload: data.providers
    })).catch(error => {
        console.error('[CONFIG] Failed to get providers:', error);
        
        // Only show toast if not suppressed (pages like NewDrive show full-page warnings instead)
        if (!suppressToast) {
            // Check if it's a connection error (503 from our improved error handling)
            if (error.response?.status === 503 || error.code === 'ECONNREFUSED') {
                toast.error(
                    error.response?.data?.message || 
                    'Cannot connect to rclone server. Please switch to a connected server using the server selector in the top navigation bar, or check if your rclone backend is running.',
                    { autoClose: 8000 }
                );
            } else {
                toast.error(
                    `Failed to load provider list: ${error.response?.data?.message || error.message}`,
                    { autoClose: 5000 }
                );
            }
        }
        
        dispatch({
            type: GET_PROVIDERS,
            status: REQUEST_ERROR,
            payload: error
        });
    });
};

/**
 * Gets dump of configured remotes from the rclone backend
 * @param {boolean} suppressToast - If true, don't show toast notifications (for pages with custom error handling)
 * @returns {Function}
 */
/**
 * Optimistically remove one or more remotes from the Redux configDump so
 * the UI updates instantly after a config/delete, without waiting for the
 * follow-up config/dump round-trip.
 *
 * The next successful getConfigDump() will replace the dump wholesale, so
 * this is purely a UX latency hack and self-corrects on the next refresh.
 *
 * @param {string|string[]} names - Remote name(s) to drop from the dump.
 */
export const removeConfigDumpEntry = (names) => ({
    type: REMOVE_CONFIG_DUMP_ENTRY,
    payload: names
});

export const getConfigDump = (suppressToast = false) => dispatch => {
    getAllConfigDump().then(res => dispatch({
        type: GET_CONFIG_DUMP,
        status: REQUEST_SUCCESS,
        payload: res
    })).catch(error => {
        console.error('[CONFIG] Failed to get config dump:', error);
        
        // Only show toast if not suppressed (pages like ShowConfig show full-page warnings instead)
        if (!suppressToast) {
            // Check if it's a connection error
            if (error.response?.status === 503 || error.code === 'ECONNREFUSED') {
                toast.error(
                    error.response?.data?.message || 
                    'Cannot connect to rclone server. Please switch to a connected server using the server selector in the top navigation bar.',
                    { autoClose: 8000 }
                );
            } else {
                toast.error(
                    `Failed to load remote configurations: ${error.response?.data?.message || error.message}`,
                    { autoClose: 5000 }
                );
            }
        }
        
        dispatch({
            type: GET_CONFIG_DUMP,
            status: REQUEST_ERROR,
            payload: error
        });
    });
};
