import React from 'react';
import PropTypes from 'prop-types';
import { Alert } from 'reactstrap';

/**
 * Component to display a warning when rclone backend is not accessible
 * Shows a helpful banner with 503 errors to guide users to server management
 */
const RcloneWarningBanner = ({hasError, error, version}) => {
    // Check if this is a 503 error (backend unavailable)
    const is503Error = error && error.response && error.response.status === 503;
    const errorMessage = error?.response?.data?.message || error?.message || '';
    
    // Don't show banner if we have a successful version (means we're connected now)
    // Check multiple possible indicators of successful connection
    const hasSuccessfulVersion = version && (version.version || version.rclone || version.decomposed);
    
    // Also check if hasError is false (no current error)
    const hasCurrentError = hasError === true;
    
    // Only show banner for 503 errors when:
    // 1. We currently have an error
    // 2. It's a 503 error
    // 3. We don't have a successful connection
    if (!hasCurrentError || !is503Error || hasSuccessfulVersion) {
        return null;
    }
    
    return (
        <Alert 
            color="warning" 
            style={{
                backgroundColor: '#fff3cd',
                color: '#856404',
                border: '1px solid #ffeaa7',
                marginBottom: '20px',
                padding: '15px'
            }}
        >
            <h5 style={{color: '#856404', marginTop: '0'}}>
                <i className="fa fa-exclamation-triangle" style={{marginRight: '10px'}}></i>
                <strong>Rclone Backend Not Available</strong>
            </h5>
            <p style={{marginBottom: '10px'}}>
                {errorMessage || 'The Rclone backend server is not responding. This could be because:'}
            </p>
            <ul style={{marginBottom: '10px'}}>
                <li>No rclone server is configured yet</li>
                <li>The configured server is not running</li>
                <li>Network connectivity issues</li>
            </ul>
            <p style={{marginBottom: '0'}}>
                <strong>To fix this:</strong> Go to <strong>Menu → Rclone Servers</strong> to manage your backend server configuration, or check if your rclone service is running.
            </p>
        </Alert>
    );
};

RcloneWarningBanner.propTypes = {
    hasError: PropTypes.bool.isRequired,
    error: PropTypes.object,
    version: PropTypes.object
};

export default RcloneWarningBanner;

