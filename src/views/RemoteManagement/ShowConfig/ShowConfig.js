import React from "react";
import {Button, Col, Row, Table, Collapse, Card, CardBody} from "reactstrap";
import ConfigRow from "./ConfigRow";
import {connect} from "react-redux";
import {getConfigDump, removeConfigDumpEntry} from "../../../actions/configActions";
import * as PropTypes from "prop-types";
import {withRouter} from "../../../utils/withRouter";
import {getTemplates, deleteTemplate} from "../../../utils/API/director";
import {toast} from "react-toastify";
import ConfirmModal from "../../../components/ConfirmModal";


function RemoteRows({remotes, refreshHandle, removeRemoteOptimistic, onTemplateCreated, disabled}) {

    let returnMap = [];
    let curKey = 1;
    for (const [key, value] of Object.entries(remotes)) {
        // Hide base remotes (internal implementation detail for encrypted remotes)
        if (key.endsWith('_base')) {
            continue;
        }

        returnMap.push((<ConfigRow sequenceNumber={curKey} key={key} remoteName={key} remote={value}
                                   refreshHandle={refreshHandle}
                                   removeRemoteOptimistic={removeRemoteOptimistic}
                                   onTemplateCreated={onTemplateCreated} disabled={disabled}/>));
        curKey++;
    }
    return returnMap;
}


class ShowConfig extends React.PureComponent {

    state = {
        isRefreshing: false,
        templates: [],
        templatesOpen: false,
        loadingTemplates: false,
        showDeleteTemplateModal: false,
        templateToDelete: null,
        deletingTemplate: false,
        checkingConnection: false,
        connectionFailed: null
    };

    // Track the server ID for the current connection check to prevent race conditions
    pendingCheckServerId = null;

    componentDidMount() {
        //Get the configs
        this.checkInitialConnection();
        
        // Listen for server changes
        this.serverChangeHandler = () => {
            console.log('[ShowConfig] Server changed, re-checking connection...');
            // Re-run connection check when server changes
            this.checkInitialConnection();
        };
        window.addEventListener('rclone-server-changed', this.serverChangeHandler);
    }

    componentWillUnmount() {
        // Clean up event listener
        if (this.serverChangeHandler) {
            window.removeEventListener('rclone-server-changed', this.serverChangeHandler);
        }
    }

    checkInitialConnection = async () => {
        // Get the current server ID to track this specific check
        const currentServerId = sessionStorage.getItem('RCLONE_SERVER_ID') || 'default';
        this.pendingCheckServerId = currentServerId;
        
        console.log(`[ShowConfig] Starting connection check for server: ${currentServerId}`);
        
        // Set checking state to show spinner
        this.setState({ 
            checkingConnection: true,
            connectionFailed: false 
        });
        
        // Check connection status before allowing any actions
        try {
            // Make a direct API call to check connection (not Redux action)
            const { getAllConfigDump } = require('rclone-api');
            await getAllConfigDump();
            
            // Check if we're still on the same server (prevent race condition)
            const stillCurrentServer = sessionStorage.getItem('RCLONE_SERVER_ID') || 'default';
            if (stillCurrentServer !== currentServerId) {
                console.log(`[ShowConfig] Server changed during check (was ${currentServerId}, now ${stillCurrentServer}). Ignoring stale result.`);
                return; // Ignore this result - we've switched servers
            }
            
            // If successful, we're connected - dispatch Redux action to populate store (suppress toasts - we show warnings in UI)
            this.props.getConfigDump(true);
            
            // Load templates
            await this.loadTemplates();
            
            console.log(`[ShowConfig] Connection check succeeded for server: ${currentServerId}`);
            this.setState({ 
                checkingConnection: false,
                connectionFailed: false 
            });
        } catch (error) {
            // Check if we're still on the same server (prevent race condition)
            const stillCurrentServer = sessionStorage.getItem('RCLONE_SERVER_ID') || 'default';
            if (stillCurrentServer !== currentServerId) {
                console.log(`[ShowConfig] Server changed during check (was ${currentServerId}, now ${stillCurrentServer}). Ignoring stale error.`);
                return; // Ignore this result - we've switched servers
            }
            
            // Connection failed
            console.log(`[ShowConfig] Connection check failed for server: ${currentServerId}`, error);
            this.setState({ 
                checkingConnection: false,
                connectionFailed: true 
            });
        }
    };

    loadTemplates = async () => {
        this.setState({ loadingTemplates: true });
        try {
            const data = await getTemplates();
            this.setState({ templates: data.templates || [] });
        } catch (error) {
            console.error('Failed to load templates:', error);
            // Silently fail - templates are optional feature
        } finally {
            this.setState({ loadingTemplates: false });
        }
    };

    handleRefresh = async () => {
        this.setState({ isRefreshing: true });
        try {
            // Make a direct API call to refresh
            const { getAllConfigDump } = require('rclone-api');
            await getAllConfigDump();
            
            // If successful, dispatch Redux action to populate store (don't suppress toast - user manually refreshed)
            this.props.getConfigDump(false);
            
            // Load templates
            await this.loadTemplates();
        } catch (error) {
            console.error('[ShowConfig] Refresh failed:', error);
            // Error will be shown via toast from configActions
        } finally {
            // Show spinner for at least 500ms for visual feedback
            setTimeout(() => {
                this.setState({ isRefreshing: false });
            }, 500);
        }
    };

    toggleTemplates = () => {
        this.setState(prevState => ({ templatesOpen: !prevState.templatesOpen }));
    };

    handleDeleteTemplateClick = (template) => {
        this.setState({
            showDeleteTemplateModal: true,
            templateToDelete: template
        });
    };

    toggleDeleteTemplateModal = () => {
        this.setState(prevState => ({
            showDeleteTemplateModal: !prevState.showDeleteTemplateModal,
            templateToDelete: !prevState.showDeleteTemplateModal ? prevState.templateToDelete : null
        }));
    };

    handleConfirmDeleteTemplate = async () => {
        const {templateToDelete} = this.state;
        if (!templateToDelete) return;

        this.setState({ deletingTemplate: true });

        try {
            await deleteTemplate(templateToDelete.id);
            toast.success(`Template "${templateToDelete.name}" deleted successfully`);
            
            // Close modal and clear state
            this.setState({
                showDeleteTemplateModal: false,
                templateToDelete: null,
                deletingTemplate: false
            });
            
            // Reload templates
            await this.loadTemplates();
        } catch (error) {
            console.error('Failed to delete template:', error);
            const errorMsg = error.response?.data?.error || error.message || 'Unknown error';
            toast.error(`Failed to delete template: ${errorMsg}`);
            this.setState({ deletingTemplate: false });
        }
    };

    render() {
        const { isRefreshing, templates, templatesOpen, loadingTemplates, showDeleteTemplateModal, templateToDelete, deletingTemplate, checkingConnection, connectionFailed } = this.state;
        const { hasError, remotes, version } = this.props;
        
        // Use Redux version state as primary connection indicator
        const reduxConnected = version && (version.version || version.decomposed) && !version.hasError;
        const hasRemotes = remotes && Object.keys(remotes).length > 0;
        const isConnected = reduxConnected || hasRemotes;
        
        // Disable actions if not connected
        const isDisconnected = !isConnected && (connectionFailed === true || hasError);

        // Show loading spinner only during active local check AND no Redux data yet
        if (checkingConnection && !reduxConnected && !hasRemotes) {
            return (
                <div className="animated fadeIn">
                    <div style={{textAlign: 'center', padding: '50px'}}>
                        <i className="fa fa-spinner fa-spin" style={{fontSize: '48px', color: '#20a8d8'}}></i>
                        <p style={{marginTop: '20px', fontSize: '16px', color: '#666'}}>
                            Checking server connection...
                        </p>
                    </div>
                </div>
            );
        }

        // Show warning only after check completes or Redux reports error
        if (!isConnected && (connectionFailed === true || (version && version.hasError))) {
            return (
                <div className="animated fadeIn">
                    <Card>
                        <CardBody>
                            <div style={{
                                padding: '30px 20px',
                                textAlign: 'center'
                            }}>
                                <i className="fa fa-exclamation-triangle" 
                                   style={{fontSize: '64px', color: '#ffc107', marginBottom: '20px'}}></i>
                                
                                <h3 style={{color: '#856404', marginBottom: '15px'}}>
                                    Server Connection Required
                                </h3>
                                
                                <div style={{
                                    backgroundColor: '#fff3cd',
                                    border: '2px solid #ffc107',
                                    borderRadius: '6px',
                                    padding: '20px',
                                    marginBottom: '20px',
                                    maxWidth: '600px',
                                    margin: '0 auto 20px auto'
                                }}>
                                    <p style={{fontSize: '15px', color: '#856404', marginBottom: '15px'}}>
                                        <strong>You are currently not connected to an Rclone RCD server.</strong>
                                    </p>
                                    <p style={{fontSize: '14px', color: '#856404', marginBottom: '15px'}}>
                                        You cannot view, create, or edit remotes without an active connection to an Rclone server. 
                                        Remote configurations are stored on the server, not locally.
                                    </p>
                                    <div style={{fontSize: '14px', color: '#856404', textAlign: 'left'}}>
                                        <strong>To resolve:</strong>
                                        <ul style={{marginTop: '8px', marginBottom: '0'}}>
                                            <li>Click on the <strong>server name</strong> in the top navigation bar to switch to a connected server</li>
                                            <li>Go to <strong>Menu → Rclone Servers</strong> to add or configure server connections</li>
                                            <li>Ensure your Rclone RCD backend is running and accessible</li>
                                        </ul>
                                    </div>
                                </div>
                                
                                <Button 
                                    color="primary" 
                                    onClick={() => this.props.router.navigate('/rclone-servers')}
                                    style={{marginRight: '10px'}}
                                >
                                    <i className="fa fa-server"></i> Manage Servers
                                </Button>
                                <Button 
                                    color="secondary" 
                                    onClick={() => this.checkInitialConnection()}
                                >
                                    <i className="fa fa-refresh"></i> Retry Connection
                                </Button>
                            </div>
                        </CardBody>
                    </Card>
                </div>
            );
        }

        return (
            <div data-test="showConfigComponent">
                
                <Row>
                    <Col lg={8} className={"mb-4"} style={{marginTop: "10px"}}>
                        <Button color={"primary"} className={"float-left"}
                                onClick={() => this.props.router.navigate("/newdrive")}
                                disabled={isDisconnected}>
                            {checkingConnection ? (
                                <><i className="fa fa-spinner fa-spin"></i> Checking Connection...</>
                            ) : hasError ? (
                                <><i className="fa fa-ban"></i> Create a New Remote (Server Disconnected)</>
                            ) : (
                                <>Create a New Remote</>
                            )}
                        </Button>
                    </Col>
                    <Col lg={4} className={"mb-4"} style={{marginTop: "10px"}}>
                        <Button color={"secondary"} className={"float-right"}
                                onClick={this.handleRefresh}
                                disabled={isRefreshing}>
                            {isRefreshing ? (
                                <><i className="fa fa-spinner fa-spin"></i> Refreshing...</>
                            ) : (
                                <><i className="fa fa-refresh"></i> Refresh</>
                            )}
                        </Button>
                    </Col>

                </Row>
                <Table responsive className="table-striped">
                    <thead>
                    <tr>
                        <th>No.</th>
                        <th>Name</th>
                        <th>Type</th>
                        <th>Storage</th>
                        <th>Auth Status</th>
                        <th>Actions</th>
                    </tr>
                    </thead>
                    <tbody>
                        <RemoteRows remotes={this.props.remotes}
                                    refreshHandle={this.props.getConfigDump}
                                    removeRemoteOptimistic={this.props.removeConfigDumpEntry}
                                    onTemplateCreated={this.loadTemplates}
                                    disabled={isDisconnected}/>
                    </tbody>
                </Table>

                {/* Templates Section */}
                <Row className="mt-4">
                    <Col xs="12">
                        <Card>
                            <CardBody style={{padding: '15px', cursor: 'pointer', backgroundColor: '#f0f3f5'}} onClick={this.toggleTemplates}>
                                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                                    <h5 style={{margin: 0, fontWeight: '600'}}>
                                        <i className="fa fa-folder-open" style={{marginRight: '8px'}}></i>
                                        Remote Templates ({templates.length})
                                    </h5>
                                    <i className={`fa fa-chevron-${templatesOpen ? 'up' : 'down'}`}></i>
                                </div>
                                <small style={{color: '#73818f'}}>
                                    Reusable configurations that can be imported when creating new remotes
                                </small>
                            </CardBody>
                        </Card>
                    </Col>
                </Row>

                <Collapse isOpen={templatesOpen}>
                    <Row>
                        <Col xs="12">
                            {loadingTemplates ? (
                                <div className="text-center p-4">
                                    <i className="fa fa-spinner fa-spin"></i> Loading templates...
                                </div>
                            ) : templates.length === 0 ? (
                                <div className="text-center p-4" style={{color: '#73818f'}}>
                                    <i className="fa fa-info-circle"></i> No templates created yet.
                                    <br/>
                                    <small>Create templates from existing remotes using the "Make Template" button.</small>
                                </div>
                            ) : (
                                <Table responsive className="table-striped">
                                    <thead>
                                    <tr>
                                        <th>No.</th>
                                        <th>Name</th>
                                        <th>Description</th>
                                        <th>Type</th>
                                        <th>Created</th>
                                        <th>Actions</th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                        {templates.map((template, index) => (
                                            <tr key={template.id}>
                                                <th scope="row">{index + 1}</th>
                                                <td><strong>{template.name}</strong></td>
                                                <td>{template.description || <em style={{color: '#73818f'}}>No description</em>}</td>
                                                <td>
                                                    <span style={{
                                                        backgroundColor: '#20a8d8',
                                                        color: 'white',
                                                        padding: '2px 8px',
                                                        borderRadius: '3px',
                                                        fontSize: '12px'
                                                    }}>
                                                        {template.type}
                                                    </span>
                                                </td>
                                                <td>{new Date(template.createdAt).toLocaleDateString()}</td>
                                                <td>
                                                    <Button 
                                                        color="danger" 
                                                        size="sm"
                                                        onClick={() => this.handleDeleteTemplateClick(template)}
                                                        title="Delete this template">
                                                        <i className="fa fa-trash"></i> Delete
                                                    </Button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            )}
                        </Col>
                    </Row>
                </Collapse>

                {/* Delete Template Confirmation Modal */}
                <ConfirmModal
                    isOpen={showDeleteTemplateModal}
                    toggle={this.toggleDeleteTemplateModal}
                    onConfirm={this.handleConfirmDeleteTemplate}
                    title="Delete Template"
                    message={
                        templateToDelete && (
                            <>
                                <p>Are you sure you want to delete the template <strong>{templateToDelete.name}</strong>?</p>
                                {templateToDelete.description && (
                                    <p className="text-muted mb-2">
                                        <i className="fa fa-info-circle"></i> {templateToDelete.description}
                                    </p>
                                )}
                                <p className="text-danger mb-0">
                                    <i className="fa fa-exclamation-triangle"></i> This action cannot be undone!
                                </p>
                            </>
                        )
                    }
                    confirmText="Delete"
                    cancelText="Cancel"
                    confirmColor="danger"
                    icon="fa-trash"
                    isLoading={deletingTemplate}
                />
            </div>
        )

    }
}

const mapStateToProps = state => ({
    remotes: state.config.configDump,
    hasError: state.config.hasError,
    error: state.config.error,
    version: state.version
});

ShowConfig.propTypes = {
    remotes: PropTypes.object.isRequired,
    hasError: PropTypes.bool,
    error: PropTypes.object
};

export default withRouter(connect(mapStateToProps, {getConfigDump, removeConfigDumpEntry})(ShowConfig));
