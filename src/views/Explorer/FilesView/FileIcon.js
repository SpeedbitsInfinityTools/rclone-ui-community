import React from "react";
import * as PropTypes from "prop-types";

const mimeClassMap = {
    "application/pdf": "fa-file-pdf-o",
    "image/jpeg": "fa-file-image-o",
    "application/rar": "fa-file-archive-o",
    "application/x-rar-compressed": "fa-file-archive-o",
    "application/zip": "fa-file-archive-o",
    "text/plain": "fa-file-text-o",
    "text/x-vcard": "fa-address-card-o"
}

function FileIcon({IsDir, IsBucket, MimeType}) {
    let className = mimeClassMap[MimeType];
    
    // Buckets get a special icon (like Cyberduck)
    if (IsBucket) {
        className = "fa-database"; // Database icon for buckets (S3, B2, GCS, etc.)
    } else if (IsDir) {
        className = "fa-folder";  // Regular folder icon
    }
    
    if (!className) className = "fa-file";

    return <i className={className + " fa fa-lg"} data-test="fileIconComponent"/>;
}

FileIcon.propTypes = {
    IsDir: PropTypes.bool.isRequired,
    IsBucket: PropTypes.bool,  // Optional - only present for bucket-based remotes
    MimeType: PropTypes.string.isRequired
}

export default FileIcon;