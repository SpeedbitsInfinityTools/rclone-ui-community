import React from "react";
import { Button, UncontrolledDropdown, DropdownToggle, DropdownMenu, DropdownItem, Modal, ModalHeader, ModalBody, ModalFooter, Alert } from "reactstrap";
import { connect } from "react-redux";
import { toast } from "react-toastify";
import { getServers, testServer } from "../../../utils/API/director";

/**
 * Component for selecting and connecting to Rclone servers
 */
class ServerSelector extends React.Component {
    state = {
        servers: [],
        selectedServer: null,
        connectionStatus: 'unknown', // 'connected', 'not_connected', 'unknown'
        loading: false,
        showRecoveryModal: false,
        backendDown: false,
        retryCount: 0,
        lastError: null,
        bannerDismissed: false, // User manually dismissed the banner
        // Edition info
        edition: 'commercial',
        maxServers: -1
    };

    // Retry configuration
    maxAutoRetries = 3;
    baseBackoffMs = 1000; // Start with 1 second

    componentDidMount() {
        this.loadServers();
        // Reload servers every 5 seconds to catch changes from Rclone Servers page
        this.reloadInterval = setInterval(() => {
            this.loadServersQuietly();
        }, 15000);
    }

    componentWillUnmount() {
        if (this.reloadInterval) {
            clearInterval(this.reloadInterval);
        }
    }

    loadServers = async () => {
        try {
            const data = await getServers();
            const servers = data.servers || [];
            const edition = data.edition || 'commercial';
            const maxServers = data.maxServers !== undefined ? data.maxServers : -1;
            const isCommunity = edition === 'community' && maxServers === 1;
            
            this.setState({ 
                servers,
                // Store edition info
                edition,
                maxServers
            });
            
            let serverToSelect = null;
            
            // In Community edition, always use the first/only server (ignore localStorage)
            if (isCommunity) {
                serverToSelect = servers[0]; // Use the only server available
            } else {
                // Commercial: Try to restore last selected server from localStorage
                const lastSelectedServerId = localStorage.getItem('RCLONE_LAST_SERVER_ID');
                
                if (lastSelectedServerId) {
                    // Check if the last selected server still exists
                    serverToSelect = servers.find(s => s.id === lastSelectedServerId);
                }
                
                // Fallback to default server if last selected doesn't exist
                if (!serverToSelect) {
                    serverToSelect = servers.find(s => s.isDefault);
                }
            }
            
            if (serverToSelect) {
                this.selectServer(serverToSelect, true); // true = silent mode
            }
        } catch (error) {
            console.error("Failed to load servers:", error);
        }
    };

    loadServersQuietly = async () => {
        try {
            const data = await getServers();
            const servers = data.servers || [];
            const { selectedServer } = this.state;
            const edition = data.edition || 'commercial';
            const maxServers = data.maxServers !== undefined ? data.maxServers : -1;
            const isCommunity = edition === 'community' && maxServers === 1;
            
            // Success - reset retry counter and clear error state
            this.setState({ 
                servers,
                retryCount: 0,
                backendDown: false,
                lastError: null,
                // Update edition info
                edition,
                maxServers
            });
            
            // In Community edition, always ensure we're using the first/only server
            if (isCommunity && servers.length > 0) {
                const correctServer = servers[0];
                if (!selectedServer || selectedServer.id !== correctServer.id) {
                    this.selectServer(correctServer, true);
                }
                return;
            }
            
            // Commercial: If current selected server was deleted, clear selection
            if (selectedServer && !servers.find(s => s.id === selectedServer.id)) {
                this.setState({ 
                    selectedServer: null, 
                    connectionStatus: 'unknown' 
                });
                localStorage.removeItem('RCLONE_LAST_SERVER_ID');
                sessionStorage.removeItem('RCLONE_SERVER_ID');
                
                // Try to select default server
                const defaultServer = servers.find(s => s.isDefault);
                if (defaultServer) {
                    this.selectServer(defaultServer, true);
                }
            }
        } catch (error) {
            this.handleBackendError(error);
        }
    };

    handleBackendError = (error) => {
        const { retryCount, showRecoveryModal } = this.state;
        
        console.debug(`Backend connection failed (attempt ${retryCount + 1}/${this.maxAutoRetries}):`, error);
        
        const newRetryCount = retryCount + 1;
        
        if (newRetryCount >= this.maxAutoRetries && !showRecoveryModal) {
            // Max retries reached - stop polling and show recovery modal
            console.warn('⚠️ Backend connection failed after max retries. Showing recovery options.');
            
            clearInterval(this.reloadInterval);
            this.reloadInterval = null;
            
            this.setState({
                backendDown: true,
                showRecoveryModal: true,
                lastError: error.response?.data?.error || error.message || 'Connection failed',
                retryCount: newRetryCount
            });
        } else {
            // Increment retry counter for exponential backoff
            this.setState({ 
                retryCount: newRetryCount,
                lastError: error.message
            });
        }
    };

    selectServer = async (server, silent = false) => {
        this.setState({ selectedServer: server, loading: true });
        
        // Store selected server ID in both localStorage (persists) and sessionStorage (for current session)
        localStorage.setItem('RCLONE_LAST_SERVER_ID', server.id);
        sessionStorage.setItem('RCLONE_SERVER_ID', server.id);
        
        // Try to connect
        try {
            const result = await testServer(server.id);
            if (result.success) {
                this.setState({ connectionStatus: 'connected' });
                
                // Keep loading spinner visible for 2 seconds to allow page reload
                setTimeout(() => {
                    this.setState({ loading: false });
                }, 2000);
                
                // Trigger page reload/refresh for all components
                // Dispatch a custom event that other components can listen to
                window.dispatchEvent(new CustomEvent('rclone-server-changed', { 
                    detail: { serverId: server.id, serverName: server.name } 
                }));
                
                // Only show toast if not in silent mode (manual selection)
                if (!silent) {
                    toast.success(`✅ Connected to server "${server.name}"`);
                }
            } else {
                this.setState({ connectionStatus: 'not_connected', loading: false });
                // Only show error toast if not in silent mode
                if (!silent) {
                    toast.error(`❌ Failed to connect to server "${server.name}"`);
                }
            }
        } catch (error) {
            this.setState({ connectionStatus: 'not_connected', loading: false });
            // Only show error toast if not in silent mode
            if (!silent) {
                const errorMsg = error.response?.data?.error || error.message || 'Unknown error';
                toast.error(`❌ Connection failed to server "${server.name}": ${errorMsg}`);
            }
        }
    };

    retryConnection = () => {
        const { selectedServer } = this.state;
        if (selectedServer) {
            this.selectServer(selectedServer);
        }
    };

    handleManualRetry = () => {
        // Reset state and restart polling
        this.setState({
            showRecoveryModal: false,
            backendDown: false,
            retryCount: 0,
            lastError: null,
            bannerDismissed: false // Re-enable banner in case connection fails again
        });
        
        // Restart polling interval
        if (!this.reloadInterval) {
            this.reloadInterval = setInterval(() => {
                this.loadServersQuietly();
            }, 5000);
        }
        
        // Immediate retry
        this.loadServersQuietly();
    };

    handleDismissModal = () => {
        // Dismiss both modal and banner
        this.setState({ 
            showRecoveryModal: false,
            bannerDismissed: true,
            backendDown: false 
        });
    };

    handleConfigureManually = () => {
        // Close modal, dismiss banner, and navigate to server configuration
        this.setState({ 
            showRecoveryModal: false,
            bannerDismissed: true,
            backendDown: false 
        });
        
        // Set flag in sessionStorage to show help message on Rclone Servers page
        sessionStorage.setItem('SHOW_SERVER_CONFIG_HELP', 'true');
        
        window.location.hash = '#/rclone-servers';
    };

    render() {
        const { servers, selectedServer, connectionStatus, loading, showRecoveryModal, backendDown, lastError, bannerDismissed, edition, maxServers } = this.state;

        // Check if Community edition (single server only)
        const isCommunity = edition === 'community' && maxServers === 1;

        // Status badge styling
        const statusColors = {
            connected: '#28a745',
            not_connected: '#dc3545',
            unknown: '#6c757d'
        };
        
        const statusLabels = {
            connected: 'Connected',
            not_connected: 'Not Connected',
            unknown: 'No Server'
        };

        return (
            <>
                {/* Warning Banner - shown when backend is down and not dismissed */}
                {backendDown && !showRecoveryModal && !bannerDismissed && (
                    <Alert color="warning" style={{ 
                        margin: '0', 
                        borderRadius: '0', 
                        borderLeft: 'none', 
                        borderRight: 'none',
                        borderTop: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                    }}>
                        <span>
                            <i className="fa fa-exclamation-triangle"></i> <strong>Backend Disconnected</strong> - Limited functionality. The Rclone Director cannot reach the backend server.
                        </span>
                        <div>
                            <Button color="light" size="sm" onClick={this.handleConfigureManually} style={{ marginRight: '10px' }}>
                                Configure Server
                            </Button>
                            <Button color="warning" size="sm" onClick={this.handleManualRetry} style={{ marginRight: '10px' }}>
                                <i className="fa fa-refresh"></i> Retry
                            </Button>
                            <Button color="light" size="sm" onClick={this.handleDismissModal}>
                                Dismiss
                            </Button>
                        </div>
                    </Alert>
                )}

                {/* Recovery Modal - shown after max retries */}
                <Modal isOpen={showRecoveryModal} toggle={this.handleDismissModal} size="lg">
                    <ModalHeader toggle={this.handleDismissModal}>
                        <i className="fa fa-exclamation-triangle text-warning"></i> Cannot Connect to Rclone Backend
                    </ModalHeader>
                    <ModalBody>
                        <Alert color="danger">
                            <strong>Connection Failed</strong>
                            <p className="mb-0" style={{ marginTop: '10px' }}>
                                The Rclone Director cannot reach the backend server after {this.maxAutoRetries} attempts.
                            </p>
                            {lastError && (
                                <p className="mb-0" style={{ marginTop: '5px', fontSize: '0.9em', fontFamily: 'monospace' }}>
                                    Error: {lastError}
                                </p>
                            )}
                        </Alert>

                        <h5>This might be because:</h5>
                        <ul>
                            <li><strong>Backend service is not running</strong> - Check if <code>rclone-ui-backend</code> systemd service is active</li>
                            <li><strong>Network connectivity issue</strong> - Verify Docker networking and <code>host.docker.internal</code> resolution</li>
                            <li><strong>Configuration problem</strong> - Check server URL and credentials in Rclone Servers settings</li>
                        </ul>

                        <h5>Troubleshooting Commands:</h5>
                        <pre style={{ backgroundColor: '#f5f5f5', padding: '10px', borderRadius: '4px' }}>
{`# Check backend service status
sudo systemctl status rclone-ui-backend

# Check Docker logs
docker logs rclone-director

# Test connectivity
docker exec rclone-director wget --spider --no-check-certificate https://host.docker.internal:5572`}
                        </pre>
                    </ModalBody>
                    <ModalFooter>
                        <Button color="primary" onClick={this.handleManualRetry}>
                            <i className="fa fa-refresh"></i> Retry Now
                        </Button>
                        <Button color="info" onClick={this.handleConfigureManually}>
                            <i className="fa fa-cog"></i> Configure Server
                        </Button>
                        <Button color="secondary" onClick={this.handleDismissModal}>
                            Dismiss
                        </Button>
                    </ModalFooter>
                </Modal>

            <div className="d-flex align-items-center" style={{ marginRight: '20px' }}>
                {/* Label - hidden on mobile */}
                <span className="d-none d-lg-inline" style={{ marginRight: '10px', fontWeight: '500', color: '#23282c' }}>
                    Rclone server:
                </span>
                
                {/* Community Edition: Simple server display (no dropdown) */}
                {isCommunity ? (
                    <div 
                        style={{
                            backgroundColor: 'white',
                            border: '2px solid #20a8d8',
                            color: '#23282c',
                            fontWeight: '500',
                            fontSize: '15px',
                            padding: '8px 16px',
                            borderRadius: '4px',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                            marginRight: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            height: '42px'
                        }}
                        title={selectedServer ? `${selectedServer.name} (${selectedServer.url})` : 'No server configured'}
                    >
                        {selectedServer ? (
                            <>
                                <i className="fa fa-server" style={{ marginRight: '8px' }}></i>
                                {selectedServer.name}
                            </>
                        ) : (
                            <span style={{ color: '#dc3545' }}>
                                <i className="fa fa-exclamation-triangle"></i> No Server
                            </span>
                        )}
                    </div>
                ) : (
                    /* Commercial Edition: Server Dropdown */
                    <UncontrolledDropdown style={{ marginRight: '10px' }}>
                        <DropdownToggle
                            caret
                            className="server-dropdown-toggle"
                            style={{
                                backgroundColor: 'white',
                                border: '2px solid #20a8d8',
                                color: servers.length === 0 ? '#dc3545' : '#23282c',
                                textAlign: 'left',
                                fontWeight: '500',
                                fontSize: '15px',
                                padding: '8px 16px',
                                paddingRight: '35px',
                                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                                whiteSpace: 'nowrap',
                                display: 'flex',
                                alignItems: 'center',
                                height: '42px'
                            }}
                            title={selectedServer ? `${selectedServer.name} (${selectedServer.url})` : ''}
                        >
                            {servers.length === 0 ? (
                                <span style={{ color: '#dc3545' }}>
                                    <i className="fa fa-exclamation-triangle"></i> No Rclone Server configured
                                </span>
                            ) : selectedServer ? (
                                <span style={{ 
                                    display: 'block',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                }}>
                                    <i className="fa fa-server"></i> {selectedServer.name} <span style={{ color: '#6c757d', fontSize: '13px' }}>({selectedServer.url})</span>
                                </span>
                            ) : (
                                <span>Select Server...</span>
                            )}
                        </DropdownToggle>
                        <DropdownMenu>
                            {servers.length === 0 ? (
                                <DropdownItem disabled>
                                    No servers configured. Go to Menu → Rclone Servers
                                </DropdownItem>
                            ) : (
                                servers.map(server => (
                                    <DropdownItem
                                        key={server.id}
                                        onClick={() => this.selectServer(server, true)}
                                        active={selectedServer?.id === server.id}
                                        title={`${server.name} (${server.url})`}
                                    >
                                        <i className="fa fa-server"></i> {server.name} <span style={{ color: '#6c757d', fontSize: '12px' }}>({server.url})</span>
                                        {server.isDefault && <span className="badge badge-primary ml-2">Default</span>}
                                    </DropdownItem>
                                ))
                            )}
                        </DropdownMenu>
                    </UncontrolledDropdown>
                )}

                {/* Loading Spinner - shown next to dropdown during server switch */}
                {loading && (
                    <i 
                        className="fa fa-spinner fa-spin" 
                        style={{ 
                            marginRight: '15px', 
                            fontSize: '20px', 
                            color: '#20a8d8' 
                        }}
                    ></i>
                )}

                {/* Try Button */}
                <Button
                    color="secondary"
                    size="sm"
                    onClick={this.retryConnection}
                    disabled={!selectedServer || loading}
                    style={{ marginRight: '15px', minWidth: '60px' }}
                >
                    {loading ? <i className="fa fa-spinner fa-spin"></i> : 'Try'}
                </Button>

                {/* Connection Status Badge */}
                <span
                    className="badge badge-pill px-3 py-2"
                    style={{
                        backgroundColor: statusColors[connectionStatus],
                        color: 'white',
                        fontSize: '14px',
                        fontWeight: '500'
                    }}
                >
                    {statusLabels[connectionStatus]}
                </span>
            </div>
            </>
        );
    }
}

const mapStateToProps = state => ({
    isConnected: state.status.isConnected
});

export default connect(mapStateToProps, {})(ServerSelector);

