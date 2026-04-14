import React from "react";
import axiosInstance from "../../../utils/API/API";
import {Button, Modal, ModalHeader, ModalBody, ModalFooter, FormGroup, Label, Input, Badge} from "reactstrap";
import * as  PropTypes from "prop-types";
import {toast} from "react-toastify";
import {withRouter} from "../../../utils/withRouter";
import urls from "../../../utils/API/endpoint";
import {createTemplate, checkOAuthStatus, getOAuthAccountInfo} from "../../../utils/API/director";
import {isEmpty} from "../../../utils/Tools";
import ConfirmModal from "../../../components/ConfirmModal";


class ConfigRow extends React.Component {
    constructor(props, context) {
        super(props, context);
        let {remote, remoteName} = this.props;
        remote["name"] = remoteName;
        this.state = {
            remote: remote,
            isCreatingTemplate: false,
            showTemplateModal: false,
            templateName: `${remoteName} Template`,
            templateDescription: `Template based on ${remoteName}`,
            showDeleteModal: false,
            isDeleting: false,
            authStatus: null, // null = not checked yet, 'checking' = in progress, 'authenticated' | 'not_authenticated' | 'configured' | 'not_configured' | 'na'
            authStatusError: null,
            accountInfo: null, // { email, name, provider } or null
            storageInfo: null, // { total, used, free } or 'loading' or 'error' or 'not_supported'
            storageError: null
        };
        this.onDeleteClicked = this.onDeleteClicked.bind(this);
        this.onUpdateClicked = this.onUpdateClicked.bind(this);
        this.onMakeTemplateClicked = this.onMakeTemplateClicked.bind(this);
        this.toggleTemplateModal = this.toggleTemplateModal.bind(this);
        this.toggleDeleteModal = this.toggleDeleteModal.bind(this);
        this.handleTemplateNameChange = this.handleTemplateNameChange.bind(this);
        this.handleTemplateDescriptionChange = this.handleTemplateDescriptionChange.bind(this);
        this.handleSaveTemplate = this.handleSaveTemplate.bind(this);
        this.handleConfirmDelete = this.handleConfirmDelete.bind(this);
        this.checkAuthStatus = this.checkAuthStatus.bind(this);
        this.fetchStorageInfo = this.fetchStorageInfo.bind(this);
    }

    componentDidMount() {
        // Stagger API calls to avoid overwhelming the backend
        // Each remote gets a random delay between 0-500ms to spread out the load
        const randomDelay = Math.random() * 500;
        
        // Check authentication status when component mounts
        setTimeout(() => {
            this.checkAuthStatus();
        }, randomDelay);
        
        // Fetch storage information (with additional delay after auth)
        setTimeout(() => {
            this.fetchStorageInfo();
        }, randomDelay + 300);
    }

    componentDidUpdate(prevProps) {
        // If remote data changed, re-check auth status
        if (prevProps.remote !== this.props.remote || prevProps.remoteName !== this.props.remoteName) {
            this.checkAuthStatus();
        }
    }

    /**
     * Check if remote type is OAuth-based
     */
    isOAuthRemote(type) {
        const oauthTypes = ['dropbox', 'drive', 'onedrive', 'box', 'pcloud', 'yandex', 'jottacloud', 'hidrive', 'mailru', 'gphotos', 'gcs', 'pikpak', 'premiumizeme', 'putio', 'sharefile', 'zoho'];
        return oauthTypes.includes(type?.toLowerCase());
    }

    /**
     * Check if remote has credentials configured (for non-OAuth remotes)
     */
    hasCredentials(remote) {
        if (!remote) return false;
        
        const {type, parameters} = remote;
        
        // Check common credential fields based on remote type
        if (type === 's3' || type === 'b2' || type === 'wasabi' || type === 'digitalocean' || type === 'dreamhost' || type === 'scaleway' || type === 'minio') {
            // S3-compatible: check for access_key_id
            return !!(parameters?.access_key_id || remote?.access_key_id);
        }
        
        if (type === 'ftp' || type === 'ftps' || type === 'sftp') {
            // FTP: check for host and user
            return !!(parameters?.host || remote?.host) && !!(parameters?.user || remote?.user);
        }
        
        if (type === 'webdav' || type === 'nextcloud' || type === 'owncloud') {
            // WebDAV: check for url and user
            return !!(parameters?.url || remote?.url) && !!(parameters?.user || remote?.user);
        }
        
        if (type === 'azureblob' || type === 'azurefiles') {
            // Azure: check for account+key OR sas_url
            return !!(parameters?.account || remote?.account || parameters?.sas_url || remote?.sas_url);
        }
        
        if (type === 'gcs') {
            // Google Cloud Storage: check for service_account_file or project_number
            return !!(parameters?.service_account_file || parameters?.project_number || remote?.service_account_file || remote?.project_number);
        }
        
        // For other types, check if there are any parameters at all
        return !!(parameters && Object.keys(parameters).length > 0);
    }

    /**
     * Check authentication status for this remote
     */
    async checkAuthStatus() {
        const {remote, remoteName} = this.props;
        const {type} = remote;
        
        // Don't check if already checking or if status is cached
        if (this.state.authStatus === 'checking') {
            return;
        }
        
        this.setState({ authStatus: 'checking', authStatusError: null, accountInfo: null });
        
        try {
            if (this.isOAuthRemote(type)) {
                // OAuth remote - check via Director API
                const selectedServerId = sessionStorage.getItem('RCLONE_SERVER_ID');
                const serverId = selectedServerId && selectedServerId !== 'null' ? selectedServerId : null;
                
                try {
                    const statusResponse = await checkOAuthStatus(remoteName, serverId);
                    if (statusResponse.success && statusResponse.authenticated) {
                        this.setState({ authStatus: 'authenticated', authStatusError: null });
                        
                        // Fetch account info for authenticated remotes
                        try {
                            const accountResponse = await getOAuthAccountInfo(remoteName, serverId);
                            if (accountResponse && accountResponse.success && accountResponse.account) {
                                this.setState({ accountInfo: accountResponse.account });
                                console.log(`[ConfigRow] Account info for ${remoteName}:`, accountResponse.account);
                            }
                        } catch (accountError) {
                            console.log(`[ConfigRow] Could not fetch account info for ${remoteName}:`, accountError.message);
                            
                            // If it's a timeout, retry once after a delay
                            if (accountError.code === 'ECONNABORTED' || accountError.message?.includes('timeout')) {
                                console.log(`[ConfigRow] Retrying account info for ${remoteName} after timeout...`);
                                setTimeout(async () => {
                                    try {
                                        const retryResponse = await getOAuthAccountInfo(remoteName, serverId);
                                        if (retryResponse && retryResponse.success && retryResponse.account) {
                                            this.setState({ accountInfo: retryResponse.account });
                                            console.log(`[ConfigRow] Account info for ${remoteName} (retry):`, retryResponse.account);
                                        }
                                    } catch (retryError) {
                                        console.log(`[ConfigRow] Retry failed for ${remoteName}:`, retryError.message);
                                        // Give up after one retry
                                    }
                                }, 2000); // Wait 2 seconds before retry
                            }
                        }
                    } else {
                        this.setState({ authStatus: 'not_authenticated', authStatusError: null });
                    }
                } catch (error) {
                    console.error(`[ConfigRow] Error checking OAuth status for ${remoteName}:`, error);
                    // On error, assume not authenticated
                    this.setState({ authStatus: 'not_authenticated', authStatusError: error.message });
                }
            } else {
                // Non-OAuth remote - check for credentials
                if (this.hasCredentials(remote)) {
                    this.setState({ authStatus: 'configured', authStatusError: null });
                } else {
                    this.setState({ authStatus: 'not_configured', authStatusError: null });
                }
            }
        } catch (error) {
            console.error(`[ConfigRow] Error checking auth status for ${remoteName}:`, error);
            this.setState({ authStatus: 'na', authStatusError: error.message });
        }
    }

    /**
     * Fetch storage information using Rclone's /operations/about endpoint
     * This endpoint is supported by most cloud storage providers
     */
    async fetchStorageInfo() {
        const {remoteName} = this.props;
        
        // Don't fetch if already loading
        if (this.state.storageInfo === 'loading') {
            return;
        }
        
        this.setState({ storageInfo: 'loading', storageError: null });
        
        try {
            const response = await axiosInstance.post(urls.getAbout, {
                fs: `${remoteName}:`
            }, {
                timeout: 15000 // 15 second timeout (increased for remote servers)
            });
            
            if (response.data && (response.data.total !== undefined || response.data.used !== undefined)) {
                // Success - provider supports about endpoint
                this.setState({
                    storageInfo: {
                        total: response.data.total || null,
                        used: response.data.used || null,
                        free: response.data.free || null,
                        trashed: response.data.trashed || null
                    },
                    storageError: null
                });
            } else {
                // Provider doesn't return storage info
                this.setState({ 
                    storageInfo: 'not_supported',
                    storageError: null 
                });
            }
        } catch (error) {
            console.log(`[ConfigRow] Storage info not available for ${remoteName}:`, error.message);
            
            // Check if it's a 503 (server disconnected) or timeout
            if (error.response?.status === 503 || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
                this.setState({ 
                    storageInfo: 'error',
                    storageError: error.code === 'ECONNABORTED' ? 'Request timeout' : 'Server disconnected'
                });
            } else if (error.response?.status === 500) {
                // 500 error often means provider doesn't support the endpoint (e.g., S3)
                this.setState({ 
                    storageInfo: 'not_supported',
                    storageError: null 
                });
            } else {
                // Provider doesn't support the about endpoint (404, 501, etc.)
                this.setState({ 
                    storageInfo: 'not_supported',
                    storageError: null 
                });
            }
        }
    }

    onUpdateClicked = () => {
        const {name} = this.state.remote;
        this.props.history.push("/newdrive/edit/" + name);
    };

    toggleDeleteModal() {
        this.setState(prevState => ({
            showDeleteModal: !prevState.showDeleteModal
        }));
    }

    onDeleteClicked() {
        this.toggleDeleteModal();
    }

    async handleConfirmDelete() {
        const {name, type} = this.state.remote;
        let {refreshHandle} = this.props;

        this.setState({ isDeleting: true });

        try {
            // Delete the main remote
            await axiosInstance.post(urls.deleteConfig, {name: name});
            
            // If this is a crypt remote, also delete its base remote
            if (type === 'crypt') {
                const baseRemoteName = `${name}_base`;
                try {
                    await axiosInstance.post(urls.deleteConfig, {name: baseRemoteName});
                    console.log(`Also deleted base remote: ${baseRemoteName}`);
                } catch (err) {
                    console.warn(`Base remote ${baseRemoteName} not found or already deleted:`, err);
                    // Don't show error to user - base remote might not exist
                }
            }
            
            // Close modal and refresh the parent component
            this.toggleDeleteModal();
            refreshHandle();
            toast.success('Remote deleted successfully');
        } catch (err) {
            console.error(`Error deleting remote: ${err}`);
            toast.error('Error deleting remote');
        } finally {
            this.setState({ isDeleting: false });
        }
    }

    toggleTemplateModal() {
        const {remote} = this.state;
        this.setState(prevState => ({
            showTemplateModal: !prevState.showTemplateModal,
            // Reset form values when opening
            templateName: !prevState.showTemplateModal ? `${remote.name} Template` : prevState.templateName,
            templateDescription: !prevState.showTemplateModal ? `Template based on ${remote.name}` : prevState.templateDescription
        }));
    }

    handleTemplateNameChange(e) {
        this.setState({ templateName: e.target.value });
    }

    handleTemplateDescriptionChange(e) {
        this.setState({ templateDescription: e.target.value });
    }

    onMakeTemplateClicked() {
        this.toggleTemplateModal();
    }

    async handleSaveTemplate() {
        const {remote, templateName, templateDescription} = this.state;
        // Extract only parameters, excluding name and type
        const {name, type, ...parameters} = remote;
        
        // Validate input
        if (!templateName || templateName.trim() === '') {
            toast.error('Template name is required');
            return;
        }
        
        this.setState({ isCreatingTemplate: true });
        
        try {
            // For crypt remotes, we need to include the base remote configuration
            if (type === 'crypt') {
                // Extract the base remote name from the crypt remote's "remote" parameter
                const baseRemoteName = parameters.remote ? parameters.remote.split(':')[0] : `${name}_base`;
                
                try {
                    // Fetch the base remote configuration
                    const baseRemoteResponse = await axiosInstance.post(urls.getConfigForRemote, {name: baseRemoteName});
                    const baseRemoteConfig = baseRemoteResponse.data;
                    
                    if (baseRemoteConfig && !isEmpty(baseRemoteConfig)) {
                        // Extract only the parameters, excluding name and type
                        const { name: baseName, type: baseType, ...baseParameters } = baseRemoteConfig;
                        
                        // Create template with both crypt and base configurations
                        await createTemplate({
                            name: templateName,
                            description: templateDescription,
                            type: 'crypt',
                            parameters: parameters,
                            // Include base remote info for reconstruction on import
                            baseRemote: {
                                type: baseType,
                                parameters: baseParameters
                            }
                        });
                        
                        toast.success(`Template "${templateName}" created with encrypted configuration!`);
                    } else {
                        toast.warning('Base remote not found. Creating template with crypt config only.');
                        await createTemplate({
                            name: templateName,
                            description: templateDescription,
                            type: type,
                            parameters: parameters
                        });
                    }
                } catch (baseError) {
                    console.warn('Could not fetch base remote, creating template with crypt config only:', baseError);
                    await createTemplate({
                        name: templateName,
                        description: templateDescription,
                        type: type,
                        parameters: parameters
                    });
                    toast.warning('Template created, but base remote could not be included.');
                }
            } else {
                // Normal (non-crypt) remote
                await createTemplate({
                    name: templateName,
                    description: templateDescription,
                    type: type,
                    parameters: parameters
                });
                
                toast.success(`Template "${templateName}" created successfully!`);
            }
            
            // Close modal and refresh parent
            this.toggleTemplateModal();
            if (this.props.onTemplateCreated) {
                this.props.onTemplateCreated();
            }
        } catch (error) {
            console.error('Failed to create template:', error);
            const errorMsg = error.response?.data?.error || error.message || 'Unknown error';
            toast.error(`Failed to create template: ${errorMsg}`);
        } finally {
            this.setState({ isCreatingTemplate: false });
        }
    }


    /**
     * Format bytes to human-readable format
     */
    formatBytes(bytes, decimals = 1) {
        if (bytes === null || bytes === undefined) return null;
        if (bytes === 0) return '0 B';
        if (bytes === -1) return 'Unlimited';
        
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
        
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    renderStorageInfo() {
        const {storageInfo, storageError} = this.state;
        
        if (storageInfo === null || storageInfo === 'loading') {
            return (
                <span style={{fontSize: '12px', color: '#6c757d'}}>
                    <i className="fa fa-spinner fa-spin"></i> Loading...
                </span>
            );
        }
        
        if (storageInfo === 'error') {
            return (
                <span style={{fontSize: '12px', color: '#dc3545'}} title={storageError || 'Error loading storage info'}>
                    <i className="fa fa-exclamation-triangle"></i> Error
                </span>
            );
        }
        
        if (storageInfo === 'not_supported') {
            return (
                <span style={{fontSize: '12px', color: '#6c757d'}} title="This provider doesn't support storage info">
                    N/A
                </span>
            );
        }
        
        // storageInfo is an object with total, used, free
        const {total, used, free} = storageInfo;
        
        // If no data at all
        if (!total && !used && !free) {
            return (
                <span style={{fontSize: '12px', color: '#6c757d'}}>
                    N/A
                </span>
            );
        }
        
        // Calculate percentage if we have both used and total
        let percentage = null;
        if (used !== null && total !== null && total > 0 && total !== -1) {
            percentage = Math.round((used / total) * 100);
        }
        
        // Build display string
        const usedStr = this.formatBytes(used);
        const totalStr = this.formatBytes(total);
        
        // Determine color based on percentage
        let color = '#28a745'; // green
        if (percentage !== null) {
            if (percentage > 90) {
                color = '#dc3545'; // red
            } else if (percentage > 75) {
                color = '#ffc107'; // yellow
            }
        }
        
        return (
            <div style={{fontSize: '12px'}}>
                {usedStr && totalStr && (
                    <>
                        <div style={{fontWeight: '500'}}>
                            {usedStr} / {totalStr}
                            {percentage !== null && (
                                <span style={{color: color, marginLeft: '4px'}}>
                                    ({percentage}%)
                                </span>
                            )}
                        </div>
                        {free !== null && (
                            <div style={{fontSize: '11px', color: '#6c757d'}}>
                                Free: {this.formatBytes(free)}
                            </div>
                        )}
                    </>
                )}
                {usedStr && !totalStr && (
                    <div style={{fontWeight: '500'}}>
                        Used: {usedStr}
                    </div>
                )}
                {!usedStr && totalStr && (
                    <div style={{fontWeight: '500'}}>
                        Total: {totalStr}
                    </div>
                )}
            </div>
        );
    }

    renderAuthStatusBadge() {
        const {authStatus, authStatusError, accountInfo} = this.state;
        const {type} = this.state.remote;
        const isOAuth = this.isOAuthRemote(type);
        
        if (authStatus === null || authStatus === 'checking') {
            return (
                <Badge color="secondary" style={{fontSize: '11px', padding: '4px 8px'}}>
                    <i className="fa fa-spinner fa-spin"></i> Checking...
                </Badge>
            );
        }
        
        if (authStatus === 'authenticated') {
            return (
                <div>
                    <Badge color="success" style={{fontSize: '11px', padding: '4px 8px'}} title="OAuth authenticated">
                        <i className="fa fa-check-circle"></i> Authenticated
                    </Badge>
                    {accountInfo && (accountInfo.email || accountInfo.name) && (
                        <div style={{fontSize: '12px', color: '#666', marginTop: '4px', lineHeight: '1.3'}}>
                            {accountInfo.name && (
                                <div title="Account name">
                                    <i className="fa fa-user" style={{width: '14px', marginRight: '4px', color: '#999'}}></i>
                                    {accountInfo.name}
                                </div>
                            )}
                            {accountInfo.email && (
                                <div title="Account email">
                                    <i className="fa fa-envelope" style={{width: '14px', marginRight: '4px', color: '#999'}}></i>
                                    {accountInfo.email}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            );
        }
        
        if (authStatus === 'not_authenticated') {
            return (
                <Badge color="danger" style={{fontSize: '11px', padding: '4px 8px'}} title={authStatusError || "OAuth not authenticated"}>
                    <i className="fa fa-times-circle"></i> Not Authenticated
                </Badge>
            );
        }
        
        if (authStatus === 'configured') {
            return (
                <Badge color="info" style={{fontSize: '11px', padding: '4px 8px'}} title="Credentials configured">
                    <i className="fa fa-check-circle"></i> Configured
                </Badge>
            );
        }
        
        if (authStatus === 'not_configured') {
            return (
                <Badge color="warning" style={{fontSize: '11px', padding: '4px 8px'}} title="Credentials not configured">
                    <i className="fa fa-exclamation-circle"></i> Not Configured
                </Badge>
            );
        }
        
        // 'na' or unknown status
        return (
            <Badge color="secondary" style={{fontSize: '11px', padding: '4px 8px'}} title="Status unknown">
                —
            </Badge>
        );
    }

    render() {
        const {name, type} = this.state.remote;
        const {sequenceNumber, disabled} = this.props;
        const {isCreatingTemplate, showTemplateModal, templateName, templateDescription, showDeleteModal, isDeleting} = this.state;
        
        return (
            <>
                <tr data-test="configRowComponent">
                    <th scope="row">{sequenceNumber}</th>
                    <td>{name}</td>
                    <td>
                        {type}
                        {type === 'crypt' && (
                            <i className="fa fa-lock" style={{marginLeft: '6px', color: '#28a745'}} title="Encrypted remote"/>
                        )}
                    </td>
                    <td>
                        {this.renderStorageInfo()}
                    </td>
                    <td>
                        {this.renderAuthStatusBadge()}
                    </td>
                    <td>
                        <Button className={"bg-info mr-2"} onClick={this.onUpdateClicked} disabled={disabled}>
                            {disabled ? <><i className="fa fa-ban"></i> Edit</> : <>Edit</>}
                        </Button>
                        <Button 
                            color="success" 
                            className={"mr-2"} 
                            onClick={this.onMakeTemplateClicked}
                            disabled={isCreatingTemplate || disabled}
                            title={disabled ? "Server disconnected" : "Create a reusable template from this remote"}>
                            {isCreatingTemplate ? (
                                <><i className="fa fa-spinner fa-spin"></i> Creating...</>
                            ) : disabled ? (
                                <><i className="fa fa-ban"></i> Make Template</>
                            ) : (
                                <><i className="fa fa-arrow-right"></i> Make Template</>
                            )}
                        </Button>
                        <Button className={"bg-danger"} onClick={this.onDeleteClicked} disabled={disabled}>
                            {disabled ? <><i className="fa fa-ban"></i> Delete</> : <>Delete</>}
                        </Button>
                    </td>
                </tr>

                {/* Delete Confirmation Modal */}
                <ConfirmModal
                    isOpen={showDeleteModal}
                    toggle={this.toggleDeleteModal}
                    onConfirm={this.handleConfirmDelete}
                    title="Delete Remote"
                    message={
                        <>
                            <p>Are you sure you want to delete <strong>{name}</strong>?</p>
                            <p className="text-danger mb-0">
                                <i className="fa fa-exclamation-triangle"></i> This action cannot be undone!
                            </p>
                            {type === 'crypt' && (
                                <p className="text-warning mt-2 mb-0">
                                    <i className="fa fa-info-circle"></i> The base remote will also be deleted.
                                </p>
                            )}
                        </>
                    }
                    confirmText="Delete"
                    cancelText="Cancel"
                    confirmColor="danger"
                    icon="fa-trash"
                    isLoading={isDeleting}
                />

                {/* Template Creation Modal */}
                <Modal isOpen={showTemplateModal} toggle={this.toggleTemplateModal}>
                    <ModalHeader toggle={this.toggleTemplateModal}>
                        <i className="fa fa-plus-circle"></i> Create Template from "{name}"
                    </ModalHeader>
                    <ModalBody>
                        <p className="text-muted" style={{fontSize: '14px', marginBottom: '20px'}}>
                            <i className="fa fa-info-circle"></i> Create a reusable template to quickly set up new remotes with the same configuration.
                            {type === 'crypt' && (
                                <><br/><i className="fa fa-lock" style={{color: '#28a745'}}></i> This encrypted remote's configuration will be securely stored in the template.</>
                            )}
                        </p>
                        
                        <FormGroup>
                            <Label for="templateName">
                                Template Name <span style={{color: 'red'}}>*</span>
                            </Label>
                            <Input
                                type="text"
                                id="templateName"
                                value={templateName}
                                onChange={this.handleTemplateNameChange}
                                placeholder="Enter a descriptive name for this template"
                                disabled={isCreatingTemplate}
                            />
                        </FormGroup>
                        
                        <FormGroup>
                            <Label for="templateDescription">Description</Label>
                            <Input
                                type="textarea"
                                id="templateDescription"
                                value={templateDescription}
                                onChange={this.handleTemplateDescriptionChange}
                                placeholder="Enter a description (optional)"
                                rows="3"
                                disabled={isCreatingTemplate}
                            />
                        </FormGroup>
                    </ModalBody>
                    <ModalFooter>
                        <Button 
                            color="secondary" 
                            onClick={this.toggleTemplateModal}
                            disabled={isCreatingTemplate}>
                            Cancel
                        </Button>
                        <Button 
                            color="success" 
                            onClick={this.handleSaveTemplate}
                            disabled={isCreatingTemplate || !templateName || templateName.trim() === ''}>
                            {isCreatingTemplate ? (
                                <><i className="fa fa-spinner fa-spin"></i> Creating...</>
                            ) : (
                                <><i className="fa fa-save"></i> Create Template</>
                            )}
                        </Button>
                    </ModalFooter>
                </Modal>
            </>
        );
    }
}

const propTypes = {
    remote: PropTypes.object.isRequired, // Name of the remote to perform operations
    refreshHandle: PropTypes.func.isRequired, // Used to refresh the parent component upon change
    sequenceNumber: PropTypes.number.isRequired,
    remoteName: PropTypes.string.isRequired,
    onTemplateCreated: PropTypes.func, // Optional callback when template is created
    disabled: PropTypes.bool, // Disable actions when server disconnected

};

ConfigRow.propTypes = propTypes;

export default withRouter(ConfigRow);