import React from 'react';
import RemoteListAutoSuggest from "./RemoteListAutoSuggest";
import {connect} from "react-redux";
import {getFsInfo, getRemoteNames} from "../../../actions/explorerActions";
import PropTypes from 'prop-types'
import {changeRemoteName} from "../../../actions/explorerStateActions";
import {Button, Col, Form} from "reactstrap";
import {PROP_CURRENT_PATH} from "../../../utils/RclonePropTypes";

class RemotesList extends React.Component {

    constructor(props) {
        super(props);
        this.state = {
            isEmpty: false,
            remoteName: props.remoteName,
            openEnabled: false,
            openButtonText: "Open",
            checkingConnection: true, // Start with checking state
            connectionFailed: false // Track if connection check failed
        };
        // Track the server ID for the current connection check to prevent race conditions
        this.pendingCheckServerId = null;
    }

    componentDidMount() {
        // Check connection before allowing actions
        this.checkInitialConnection();
        
        // Listen for server changes
        this.serverChangeHandler = () => {
            console.log('[Explorer] Server changed, re-checking connection...');
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
        
        console.log(`[Explorer] Starting connection check for server: ${currentServerId}`);
        
        // Set checking state to show spinner
        this.setState({ 
            checkingConnection: true,
            connectionFailed: false 
        });
        
        try {
            // Make a direct API call to check connection (not Redux action)
            const { getAllRemoteNames } = require('rclone-api');
            await getAllRemoteNames();
            
            // Check if we're still on the same server (prevent race condition)
            const stillCurrentServer = sessionStorage.getItem('RCLONE_SERVER_ID') || 'default';
            if (stillCurrentServer !== currentServerId) {
                console.log(`[Explorer] Server changed during check (was ${currentServerId}, now ${stillCurrentServer}). Ignoring stale result.`);
                return; // Ignore this result - we've switched servers
            }
            
            // If successful, dispatch Redux action to populate store
            this.props.getRemoteNames();
            
            console.log(`[Explorer] Connection check succeeded for server: ${currentServerId}`);
            this.setState({ 
                checkingConnection: false,
                connectionFailed: false 
            });
        } catch (error) {
            // Check if we're still on the same server (prevent race condition)
            const stillCurrentServer = sessionStorage.getItem('RCLONE_SERVER_ID') || 'default';
            if (stillCurrentServer !== currentServerId) {
                console.log(`[Explorer] Server changed during check (was ${currentServerId}, now ${stillCurrentServer}). Ignoring stale error.`);
                return; // Ignore this result - we've switched servers
            }
            
            console.log(`[Explorer] Connection check failed for server: ${currentServerId}`, error);
            this.setState({ 
                checkingConnection: false,
                connectionFailed: true 
            });
        }
    };

    shouldUpdateRemoteName = (event, {newValue}) => {
        if (newValue.indexOf('/') === 0) {
            this.setState({
                remoteName: newValue,
                openButtonText: "Open local path",
            });
        } else {
            this.setState({
                remoteName: newValue,
                openButtonText: "Open"
            });
        }
        
        // If immediateUpdate prop is true, call handleChangeRemoteName immediately
        if (this.props.immediateUpdate) {
            this.props.handleChangeRemoteName(newValue);
        }
    };

    openRemote = (e) => {
        e.preventDefault();
        const {handleChangeRemoteName} = this.props;
        const {remoteName} = this.state;

        handleChangeRemoteName(remoteName);

    };


    render() {
        const {isEmpty, remoteName, checkingConnection, connectionFailed} = this.state;
        const {remotes} = this.props;
        const {hasError} = this.props;
        // const {updateRemoteNameHandle} = this.props;

        // Check if remotes are loaded (indicates server connection)
        const remotesLoaded = remotes && Array.isArray(remotes) && remotes.length > 0;
        
        // Show loading spinner while checking connection
        if (checkingConnection) {
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

        // Show full-page warning if not connected (check local state first, then Redux state)
        if (connectionFailed || hasError) {
            return (
                <div className="animated fadeIn">
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
                                You cannot browse files or access remotes without an active connection to an Rclone server.
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
                            onClick={() => window.location.hash = '#/rclone-servers'}
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
                </div>
            );
        } else if (isEmpty || !remotesLoaded) {
            return (
                <div style={{textAlign: 'center', padding: '20px'}}>
                    {!remotesLoaded ? (
                        <div style={{
                            padding: '20px',
                            backgroundColor: '#e7f3ff',
                            border: '1px solid #b3d9ff',
                            borderRadius: '6px'
                        }}>
                            <i className="fa fa-info-circle" style={{fontSize: '24px', color: '#0066cc', marginBottom: '10px'}}></i>
                            <p style={{color: '#0066cc', marginBottom: 0}}>
                                No remotes found. Create a remote in <strong>Menu → Create New Remote</strong> to get started.
                            </p>
                        </div>
                    ) : (
                <div>
                    Add some remotes to see them here <span role="img" aria-label="sheep">🐑</span>.
                        </div>
                    )}
                </div>
            );
        } else {

            return (
                <Form onSubmit={this.openRemote} className="row">
                    
                    <Col xs={12} sm={this.props.immediateUpdate ? 12 : 10} lg={this.props.immediateUpdate ? 12 : 10}>
                        <RemoteListAutoSuggest value={remoteName} onChange={this.shouldUpdateRemoteName}
                                                suggestions={remotes}
                                                alwaysRenderSuggestions={this.props.alwaysRenderSuggestions !== undefined ? this.props.alwaysRenderSuggestions : true}/>
                    </Col>
                    {!this.props.immediateUpdate && (
                        <Col xs={12} sm={2} lg={2}>
                            <Button className={"btn-lg"} color="success">{this.state.openButtonText}</Button>
                        </Col>
                    )}
                    
                </Form>

            );
        }
    }
}

const mapStateToProps = (state, ownProps) => ({
    remotes: state.remote.remotes,
    hasError: false,
    error: state.remote.error,
    currentPath: state.explorer.currentPaths[ownProps.containerID],
});

const propTypes = {
    remotes: PropTypes.array.isRequired,
    error: PropTypes.object,
    hasError: PropTypes.bool,
    currentPath: PROP_CURRENT_PATH,
    handleChangeRemoteName: PropTypes.func.isRequired,
    alwaysRenderSuggestions: PropTypes.bool,
    immediateUpdate: PropTypes.bool,
};


const defaultProps = {};

RemotesList.propTypes = propTypes;
RemotesList.defaultProps = defaultProps;


export default connect(mapStateToProps, {
    getRemoteNames,
    getFsInfo,
    changeRemoteName,

})(RemotesList);
