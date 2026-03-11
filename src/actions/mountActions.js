import axiosInstance from "../utils/API/API";
import urls from "../utils/API/endpoint";
import {CREATE_MOUNT, GET_MOUNT_LIST, REMOVE_MOUNT, REQUEST_ERROR, REQUEST_SUCCESS} from "./types";
import {unmount as directorUnmount} from "../utils/API/director";

/**
 * Get the current mount lists and load into state
 * @returns {function(...[*]=)}
 */
export const getMountList = () => {
	return (dispatch) => {
		axiosInstance.post(urls.listMounts).then(res => {
			console.log(res);
			dispatch({
				type: GET_MOUNT_LIST,
				status: REQUEST_SUCCESS,
				payload: res.data
			})
		}, (error) => {
			dispatch({
				type: GET_MOUNT_LIST,
				status: REQUEST_ERROR,
				payload: error
			})
		})
	}
}

/**
 * Add a new mount location
 * @param fs                        {string}    Name of the remote eg mydrive:
 * @param mountPoint                {string}    Path to mount on the local filesystem where rclone is running
 * @param mountType                 {string}    One of "cmount", "mount", "mount2": Specifies what mountType rclone should use
 * @param vfsOpt					{{}}		vfs options
 * @param mountOpt					{{}}		mount options
 * @returns {function(...[*]=)}
 */
export const addMount = (fs, mountPoint, mountType, vfsOpt, mountOpt) => {
	if (!fs.endsWith(":")) fs = fs + ":";
	const type = CREATE_MOUNT
	return (dispatch) => {
		axiosInstance.post(urls.createMount, {fs, mountPoint, mountType, vfsOpt, mountOpt}).then(res => {
			dispatch({
				type,
				status: REQUEST_SUCCESS,
				payload: res.data
			})
			// Refresh mount list after successful mount
			dispatch(getMountList());
		}, (error) => {
			dispatch({
				type,
				status: REQUEST_ERROR,
				payload: error
			})
		})
	}
}

/**
 * unmount removes an mounted location "mountPoint"
 * Uses Director API to also remove from persistent storage
 * @param mountPoint                {string}    Path to location where the mount was created.
 * @returns {function(...[*]=)}
 */
export const unmount = (mountPoint) => {
	const type = REMOVE_MOUNT;
	return (dispatch) => {
		// Get the currently selected server ID from localStorage
		const currentServerId = localStorage.getItem('RCLONE_LAST_SERVER_ID');
		
		// Use Director's enhanced unmount which also removes from persistence
		directorUnmount({
			mountPoint,
			serverId: currentServerId  // Use the currently selected server
		}).then(res => {
			dispatch({
				type,
				status: REQUEST_SUCCESS,
				payload: res
			})
			// Refresh mount list after successful unmount
			dispatch(getMountList());

		}, (error) => {
			// Check if this is a "busy mount" error with troubleshooting info
			const errorData = error.response?.data;
			
			if (errorData && errorData.error === 'Mount is Busy' && errorData.troubleshooting) {
				// Create detailed error message for busy mount
				const troubleshooting = errorData.troubleshooting;
				let errorMsg = `${errorData.message}\n\n`;
				errorMsg += `Reason: ${troubleshooting.reason}\n\n`;
				errorMsg += 'Common causes:\n';
				troubleshooting.commonCauses.forEach(cause => {
					errorMsg += `• ${cause}\n`;
				});
				errorMsg += '\nSolutions:\n';
				troubleshooting.solutions.forEach(solution => {
					errorMsg += `• ${solution}\n`;
				});
				if (troubleshooting.forceUnmount) {
					errorMsg += `\n⚠️ Force Unmount (WARNING: May cause data loss!):\n`;
					errorMsg += `${troubleshooting.forceUnmount.command}\n`;
					errorMsg += `${troubleshooting.forceUnmount.description}`;
				}
				
				// Dispatch with formatted error message
				dispatch({
					type,
					status: REQUEST_ERROR,
					payload: {
						...error,
						message: errorMsg,
						detailedError: errorData
					}
				})
			} else {
				// Standard error handling
				dispatch({
					type,
					status: REQUEST_ERROR,
					payload: error
				})
			}
		})
	}
}


/**
 * unmountAll removes all mounts created by mount/mount
 * @returns {function(...[*]=)}
 */
export const unmountAll = () => {
	const type = REMOVE_MOUNT;
	return (dispatch) => {
		axiosInstance.post(urls.unmountAll).then(res => {
			dispatch({
				type,
				status: REQUEST_SUCCESS,
				payload: res.data
			})
			// Refresh mount list after successful unmount all
			dispatch(getMountList());

		}, (error) => {
			dispatch({
				type,
				status: REQUEST_ERROR,
				payload: error
			})
		})
	}
}
