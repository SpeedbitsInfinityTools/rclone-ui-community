import axiosInstance from "./API";
import urls from "./endpoint";
import {addColonAtLast} from "../Tools";

/**
 * Get files list with extended metadata (includes IsBucket field for bucket icons)
 * Uses operations/list RC endpoint (supports IsBucket field in Rclone v1.67+)
 * 
 * @param remoteName {string} Name of the remote config
 * @param remotePath {string} Path within the remote
 * @param fsInfo {object} Optional filesystem info for bucket detection fallback
 * @returns {Promise<{list: Array}>} Promise with file list including IsBucket field
 */
export async function getFilesListWithBucketInfo(remoteName, remotePath, fsInfo = null) {
    const fs = addColonAtLast(remoteName);
    const remote = remotePath || "";
    
    const data = {
        fs,
        remote,
        opt: {
            recurse: false,
            showHash: false,
            showModTime: true
        }
    };
    
    const response = await axiosInstance.post(urls.getFilesList, data);
    const rawList = response.data.list || [];
    
    // operations/list includes IsBucket field natively in Rclone v1.67+
    // For older versions, infer IsBucket from context
    const isBucketBased = fsInfo && fsInfo.Features && fsInfo.Features.BucketBased;
    
    // Check if we're truly at the root of the remote (where buckets exist)
    // At root: fs="remote:" (ends with colon), remote=""
    // Inside bucket: fs="remote:bucket" (no trailing colon), remote=""
    const isAtRemoteRoot = (!remote || remote === "") && fs.endsWith(':');
    
    const transformedList = rawList.map(item => ({
        ...item,
        // Use native IsBucket field if available, otherwise infer from context
        // Only mark as bucket if: bucket-based storage AND at remote root (not inside bucket) AND is a directory
        IsBucket: item.IsBucket !== undefined 
            ? !!item.IsBucket 
            : (isBucketBased && isAtRemoteRoot && item.IsDir)
    }));
    
    console.log(`[FilesAPI] Loaded ${transformedList.length} items (fs="${fs}", remote="${remote}", atRoot=${isAtRemoteRoot}, IsBucket: ${rawList[0]?.IsBucket !== undefined ? 'native' : 'inferred'})`);
    return { list: transformedList };
}

