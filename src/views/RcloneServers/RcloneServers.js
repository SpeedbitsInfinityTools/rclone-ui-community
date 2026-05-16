import React, {Component} from 'react';
import {
    Alert,
    Button,
    Col,
    Form,
    FormGroup,
    Input,
    Label,
    Modal,
    ModalBody,
    ModalFooter,
    ModalHeader,
    Row,
    Table,
    Badge
} from 'reactstrap';
import {toast} from 'react-toastify';
import {
    getServers,
    createServer,
    updateServer,
    deleteServer,
    setDefaultServer,
    testServer,
    restartServer
} from '../../utils/API/director';
import ConfirmModal from '../../components/ConfirmModal';

class RcloneServers extends Component {
    constructor(props) {
        super(props);
        this.state = {
            servers: [],
            defaultServerId: null,
            loading: true,
            modal: false,
            editMode: false,
            currentServer: {
                id: null,
                name: '',
                url: 'http://localhost',
                port: '5572',
                username: '',
                password: ''
            },
            testingServer: null,
            deletingServer: null,
            restartingServer: null, // Track which server is being restarted
            restartCountdown: 0, // Countdown timer for restart (in seconds)
            serverStatuses: {}, // Track connection status for each server
            serverErrors: {}, // Track error messages for each server
            testingInModal: false,
            modalTestResult: null, // 'success' or 'error'
            modalTestMessage: null,
            showDeleteModal: false,
            serverToDelete: null,
            errorModalOpen: false,
            errorModalMessage: '',
            showConfigHelp: false, // Show help banner when coming from Configure Server button
            directorConnected: true, // Track if Director backend is reachable
            directorError: null, // Error message if Director is unreachable
            // Edition info
            edition: 'commercial', // 'community' or 'commercial'
            maxServers: -1, // -1 = unlimited
            showUpgradeModal: false
        };
    }

    componentDidMount() {
        this.loadServers();
        
        // Check if we should show config help (coming from Configure Server button)
        const showHelp = sessionStorage.getItem('SHOW_SERVER_CONFIG_HELP');
        if (showHelp === 'true') {
            this.setState({ showConfigHelp: true });
            sessionStorage.removeItem('SHOW_SERVER_CONFIG_HELP');
        }
    }

    loadServers = async () => {
        try {
            this.setState({ loading: true });
            const data = await getServers();
            this.setState({
                servers: data.servers || [],
                defaultServerId: data.defaultServerId,
                loading: false,
                directorConnected: true,
                // Edition info from backend
                edition: data.edition || 'commercial',
                maxServers: data.maxServers !== undefined ? data.maxServers : -1
            });
            
            // Automatically test all servers to get their status (silently)
            if (data.servers && data.servers.length > 0) {
            this.testAllServers(data.servers);
            }
        } catch (error) {
            // Director backend is down - show error but keep UI functional
            console.error('Failed to load servers from Director:', error.message);
            this.setState({ 
                loading: false,
                directorConnected: false,
                directorError: error.response?.data?.message || error.message || 'Cannot connect to Rclone Director backend'
            });
        }
    };

    testAllServers = async (servers) => {
        // Test all servers in parallel without showing toasts
        const testPromises = servers.map(async (server) => {
            try {
                const result = await testServer(server.id);
                this.setState(prevState => ({
                    serverStatuses: { 
                        ...prevState.serverStatuses, 
                        [server.id]: result.success ? 'connected' : 'failed' 
                    },
                    serverErrors: {
                        ...prevState.serverErrors,
                        [server.id]: result.success ? null : (result.details || result.error || 'Connection failed')
                    }
                }));
            } catch (error) {
                const errorMsg = error.response?.data?.details || error.response?.data?.error || error.message || 'Connection failed';
                this.setState(prevState => ({
                    serverStatuses: { 
                        ...prevState.serverStatuses, 
                        [server.id]: 'failed' 
                    },
                    serverErrors: {
                        ...prevState.serverErrors,
                        [server.id]: errorMsg
                    }
                }));
            }
        });
        
        await Promise.all(testPromises);
    };

    toggleModal = () => {
        const { edition, maxServers, servers, modal } = this.state;
        
        // If trying to open modal (not close) and in Community edition, show upgrade modal
        if (!modal && edition === 'community' && maxServers === 1 && servers.length >= 1) {
            this.setState({ showUpgradeModal: true });
            return;
        }
        
        this.setState(prevState => ({
            modal: !prevState.modal,
            editMode: false,
            currentServer: {
                id: null,
                name: '',
                url: 'http://localhost',
                port: '5572',
                username: '',
                password: ''
            },
            modalTestResult: null,
            modalTestMessage: null
        }));
    };

    toggleUpgradeModal = () => {
        this.setState(prevState => ({
            showUpgradeModal: !prevState.showUpgradeModal
        }));
    };

    openEditModal = (server) => {
        // Parse URL to extract host and port
        let url = server.url;
        let port = '5572';
        
        const match = url.match(/^(https?:\/\/[^:]+):(\d+)$/);
        if (match) {
            url = match[1];
            port = match[2];
        }

        this.setState({
            modal: true,
            editMode: true,
            currentServer: {
                id: server.id,
                name: server.name,
                url: url,
                port: port,
                username: server.username,
                password: '' // Don't populate password for security
            },
            modalTestResult: null,
            modalTestMessage: null
        });
    };

    handleInputChange = (e) => {
        const { name, value } = e.target;
        this.setState(prevState => ({
            currentServer: {
                ...prevState.currentServer,
                [name]: value
            }
        }));
    };

    handleSubmit = async (e) => {
        e.preventDefault();
        const { editMode, currentServer, servers } = this.state;

        try {
            const serverData = {
                name: currentServer.name,
                url: currentServer.url,
                port: currentServer.port,
                username: currentServer.username,
                password: currentServer.password || undefined  // Only send if provided
            };

            // Check for duplicate URL+port (but allow editing the same server)
            const fullUrl = `${currentServer.url}:${currentServer.port}`;
            const duplicate = servers.find(s => 
                s.id !== currentServer.id && 
                s.url === fullUrl
            );
            
            if (duplicate) {
                toast.error(`A server with URL "${fullUrl}" already exists: ${duplicate.name}`);
                return;
            }

            if (editMode) {
                await updateServer(currentServer.id, serverData);
                toast.success('Server updated successfully');
            } else {
                await createServer(serverData);
                toast.success('Server created successfully');
            }

            this.toggleModal();
            this.loadServers();
        } catch (error) {
            toast.error('Failed to save server: ' + (error.response?.data?.error || error.message));
        }
    };

    handleDeleteClick = (server) => {
        this.setState({
            showDeleteModal: true,
            serverToDelete: server
        });
    };

    toggleDeleteModal = () => {
        this.setState(prevState => ({
            showDeleteModal: !prevState.showDeleteModal,
            serverToDelete: prevState.showDeleteModal ? null : prevState.serverToDelete
        }));
    };

    handleConfirmDelete = async () => {
        const {serverToDelete} = this.state;
        if (!serverToDelete) return;

        try {
            this.setState({ deletingServer: serverToDelete.id });
            await deleteServer(serverToDelete.id);
            
            // Close modal
            this.toggleDeleteModal();
            
            toast.success('Server deleted successfully');
            this.loadServers();
        } catch (error) {
            toast.error('Failed to delete server: ' + (error.response?.data?.error || error.message));
        } finally {
            this.setState({ deletingServer: null });
        }
    };

    handleSetDefault = async (serverId) => {
        try {
            await setDefaultServer(serverId);
            toast.success('Default server updated');
            this.loadServers();
        } catch (error) {
            toast.error('Failed to set default server: ' + (error.response?.data?.error || error.message));
        }
    };

    handleTestConnection = async (serverId) => {
        try {
            this.setState({ testingServer: serverId });
            const result = await testServer(serverId);
            
            if (result.success) {
                // No toast - status badge shows green "Connected"
                this.setState(prevState => ({
                    serverStatuses: { ...prevState.serverStatuses, [serverId]: 'connected' },
                    serverErrors: { ...prevState.serverErrors, [serverId]: null }
                }));
            } else {
                // No toast - status badge shows red "Failed" with error details
                this.setState(prevState => ({
                    serverStatuses: { ...prevState.serverStatuses, [serverId]: 'failed' },
                    serverErrors: { ...prevState.serverErrors, [serverId]: result.details || result.error || 'Connection failed' }
                }));
            }
        } catch (error) {
            // No toast - status badge shows red "Failed" with error details
            const errorMsg = error.response?.data?.details || error.response?.data?.error || error.message || 'Connection failed';
            this.setState(prevState => ({
                serverStatuses: { ...prevState.serverStatuses, [serverId]: 'failed' },
                serverErrors: { ...prevState.serverErrors, [serverId]: errorMsg }
            }));
        } finally {
            this.setState({ testingServer: null });
        }
    };

    handleRestartServer = async (serverId) => {
        try {
            this.setState({ restartingServer: serverId, restartCountdown: 10 });
            
            const result = await restartServer(serverId);
            
            if (result.success) {
                toast.success('Restart signal sent. RCD will restart in ~10 seconds.');
                
                // Start countdown timer
                const countdownInterval = setInterval(() => {
                    this.setState(prevState => {
                        const newCountdown = prevState.restartCountdown - 1;
                        if (newCountdown <= 0) {
                            clearInterval(countdownInterval);
                            // Auto-test connection after restart
                            this.handleTestConnection(serverId);
                            return { restartingServer: null, restartCountdown: 0 };
                        }
                        return { restartCountdown: newCountdown };
                    });
                }, 1000);
            } else {
                toast.error(`Failed to restart: ${result.details || result.error || 'Unknown error'}`);
                this.setState({ restartingServer: null, restartCountdown: 0 });
            }
        } catch (error) {
            const errorMsg = error.response?.data?.details || error.response?.data?.error || error.message || 'Failed to restart RCD';
            toast.error(errorMsg);
            this.setState({ restartingServer: null, restartCountdown: 0 });
        }
    };

    showErrorModal = (errorMessage) => {
        this.setState({
            errorModalOpen: true,
            errorModalMessage: errorMessage
        });
    };

    closeErrorModal = () => {
        this.setState({
            errorModalOpen: false,
            errorModalMessage: ''
        });
    };

    handleTestInModal = async () => {
        const { currentServer } = this.state;
        
        if (!currentServer.name || !currentServer.url || !currentServer.port || !currentServer.username || !currentServer.password) {
            // Show warning for incomplete form only
            toast.warning('⚠️ Please fill in all fields before testing');
            return;
        }

        try {
            this.setState({ testingInModal: true });
            
            // Create a temporary server object to test
            const testData = {
                name: currentServer.name,
                url: currentServer.url,
                port: currentServer.port,
                username: currentServer.username,
                password: currentServer.password
            };

            // Send test request to backend with temporary credentials
            const response = await fetch('/api/director/servers/test-temp', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Key': sessionStorage.getItem('sessionKey')
                },
                body: JSON.stringify(testData)
            });

            const result = await response.json();
            
            if (response.ok && result.success) {
                // Success - button will show success state
                this.setState({ modalTestResult: 'success', modalTestMessage: `Connected! Rclone v${result.version.version}` });
            } else {
                // Failed - button will show error state
                this.setState({ modalTestResult: 'error', modalTestMessage: result.details || 'Connection failed' });
            }
        } catch (error) {
            // Failed - button will show error state
            this.setState({ modalTestResult: 'error', modalTestMessage: error.message });
        } finally {
            this.setState({ testingInModal: false });
            // Clear the result after 3 seconds
            setTimeout(() => {
                this.setState({ modalTestResult: null, modalTestMessage: null });
            }, 3000);
        }
    };

    render() {
        const { servers, defaultServerId, loading, modal, editMode, currentServer, testingServer, deletingServer, restartingServer, restartCountdown, serverStatuses, serverErrors, testingInModal, modalTestResult, modalTestMessage, errorModalOpen, errorModalMessage, showConfigHelp, directorConnected, directorError, edition } = this.state;
        
        const isCommunity = edition === 'community';
        
        // Helper function to get first word of error
        const getErrorPreview = (errorMsg) => {
            if (!errorMsg) return '';
            const firstWord = errorMsg.split(/[\s:,]/).filter(w => w.length > 0)[0];
            return firstWord || 'Error';
        };

        return (
            <div className="animated fadeIn">
                {/* Director Backend Disconnected Warning */}
                {!directorConnected && (
                    <Alert color="danger" style={{ marginBottom: '20px' }}>
                        <h5><i className="fa fa-exclamation-circle"></i> Director Backend Disconnected</h5>
                        <p className="mb-2">
                            Cannot connect to the Rclone Director backend. Server management is unavailable.
                        </p>
                        <p className="mb-0">
                            <strong>Error:</strong> {directorError || 'Unknown error'}
                        </p>
                        <p className="mb-0 mt-2" style={{ fontSize: '13px' }}>
                            Make sure the Rclone Director backend is running on port 5573 (check <code>start-dev-windows.ps1</code> or <code>start-all.sh</code>).
                        </p>
                    </Alert>
                )}
                
                {/* Configuration Help Banner */}
                {showConfigHelp && (
                    <Alert color="info" isOpen={showConfigHelp} toggle={() => this.setState({ showConfigHelp: false })} style={{ marginBottom: '20px' }}>
                        <h5><i className="fa fa-info-circle"></i> Configure Your Rclone Servers</h5>
                        <p className="mb-2">
                            The Rclone Director backend couldn't connect to any rclone servers. Here's what you can do:
                        </p>
                        <ul className="mb-2" style={{ paddingLeft: '20px' }}>
                            <li><strong>For Local Setup:</strong> Start rclone on your machine with: <code>rclone rcd --rc-addr=127.0.0.1:5572 --rc-user=admin --rc-pass=admin</code></li>
                            <li><strong>For Remote Setup:</strong> Edit the "Local Rclone" server below to point to your remote rclone instance</li>
                            <li><strong>Add More Servers:</strong> Click "Add Server" to connect to additional rclone backends</li>
                        </ul>
                        <p className="mb-0 text-muted" style={{ fontSize: '13px' }}>
                            <i className="fa fa-lightbulb-o"></i> Tip: Use the "Try Connection" button in the server form to test your configuration before saving.
                        </p>
                    </Alert>
                )}

                {/* Getting Started Banner - shown when no servers are connected */}
                {!loading && servers.length > 0 && Object.values(serverStatuses).every(status => status !== 'connected') && !showConfigHelp && (
                    <Alert color="warning" style={{ marginBottom: '20px' }}>
                        <h5><i className="fa fa-exclamation-triangle"></i> No Connected Servers</h5>
                        <p className="mb-2">
                            You have configured servers, but none are currently connected. Please:
                        </p>
                        <ul className="mb-0" style={{ paddingLeft: '20px' }}>
                            <li>Verify that your rclone instances are running</li>
                            <li>Check the server URLs, ports, and credentials</li>
                            <li>Click the <i className="fa fa-plug"></i> icon to test individual servers</li>
                        </ul>
                    </Alert>
                )}

                {/* Community Edition Banner */}
                {isCommunity && (
                    <Alert color="warning" style={{ marginBottom: '20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div>
                                <i className="fa fa-info-circle"></i> <strong>Community Edition</strong> - 
                                You can manage 1 Rclone server. Multi-server support is available in the Commercial edition.
                            </div>
                            <Button 
                                color="primary" 
                                size="sm"
                                onClick={() => window.open('https://www.speedbits.io', '_blank')}
                            >
                                <i className="fa fa-external-link"></i> Upgrade
                            </Button>
                        </div>
                    </Alert>
                )}

                {/* Restart Info Banner */}
                <Alert color="info" style={{ marginBottom: '20px', fontSize: '14px' }}>
                    <i className="fa fa-info-circle"></i> <strong>About Configuration Changes:</strong>
                    <ul style={{ marginBottom: 0, marginTop: '8px', paddingLeft: '20px' }}>
                        <li>✅ <strong>Changes via UI are applied immediately</strong> - No restart needed when adding/editing remotes through the Remotes page</li>
                        <li>⚠️ <strong>Manual config edits require restart</strong> - If you manually edit <code>rclone.conf</code>, click the <i className="fa fa-refresh"></i> button to restart RCD</li>
                    </ul>
                </Alert>

                <Row>
                    <Col lg={8} className={"mb-4"} style={{marginTop: "10px"}}>
                        <Button 
                            color={isCommunity && servers.length >= 1 ? "secondary" : "primary"} 
                            className={"float-left"}
                            onClick={this.toggleModal}
                            title={isCommunity && servers.length >= 1 ? "Upgrade to Commercial edition for multi-server support" : "Add a new Rclone server"}
                        >
                            {isCommunity && servers.length >= 1 ? (
                                <><i className="fa fa-lock"></i> Add Server</>
                            ) : (
                                <><i className="fa fa-plus"></i> Add Server</>
                            )}
                        </Button>
                        {isCommunity && servers.length >= 1 && (
                            <span style={{ marginLeft: '10px', color: '#856404', fontSize: '13px' }}>
                                <i className="fa fa-info-circle"></i> Multi-server requires Commercial edition
                            </span>
                        )}
                    </Col>
                    <Col lg={4}>
                        
                    </Col>
                </Row>
                <Row>
                    <Col xs="12">
                        {loading ? (
                            <div className="text-center">
                                <i className="fa fa-spinner fa-spin fa-2x"></i>
                                <p>Loading servers...</p>
                            </div>
                        ) : servers.length === 0 ? (
                            <div className="text-center" style={{ padding: '40px' }}>
                                <i className="fa fa-server fa-3x text-muted"></i>
                                <h4 style={{ marginTop: '20px', color: '#999' }}>No servers configured</h4>
                                <p className="text-muted">Add your first rclone backend server to get started</p>
                                <Button color="primary" onClick={this.toggleModal}>
                                    <i className="fa fa-plus"></i> Add Server
                                </Button>
                            </div>
                        ) : (
                            <Table responsive hover className="table-striped">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>URL</th>
                                        <th>Username</th>
                                        <th>Status</th>
                                        <th className="text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                            {servers.map(server => (
                                                <tr key={server.id}>
                                                    <td>
                                                        <strong>{server.name}</strong>
                                                        {' '}
                                                        {server.id === defaultServerId && (
                                                            <Badge 
                                                                color={serverStatuses[server.id] === 'connected' ? 'success' : 'warning'}
                                                                title={serverStatuses[server.id] === 'connected' ? 'Default server (connected)' : 'Default server (not connected - start rclone or edit configuration)'}
                                                            >
                                                                <i className="fa fa-star"></i> Default
                                                            </Badge>
                                                        )}
                                                    </td>
                                                    <td>
                                                        <code>{server.url}</code>
                                                    </td>
                                                    <td>{server.username}</td>
                                                    <td>
                                                        {testingServer === server.id ? (
                                                            <Badge color="info">
                                                                <i className="fa fa-spinner fa-spin"></i> Testing...
                                                            </Badge>
                                                        ) : serverStatuses[server.id] === 'connected' ? (
                                                            <Badge color="success">
                                                                <i className="fa fa-check"></i> Connected
                                                            </Badge>
                                                        ) : serverStatuses[server.id] === 'failed' ? (
                                                            <Badge 
                                                                color="danger" 
                                                                title={serverErrors[server.id] || 'Connection failed'}
                                                                style={{ cursor: 'pointer' }}
                                                                onClick={() => this.showErrorModal(serverErrors[server.id] || 'Connection failed')}
                                                            >
                                                                <i className="fa fa-times"></i> Failed ({getErrorPreview(serverErrors[server.id])}...)
                                                            </Badge>
                                                        ) : (
                                                            <Badge color="secondary">Unknown</Badge>
                                                        )}
                                                    </td>
                                                    <td className="text-right">
                                                        <Button
                                                            color="info"
                                                            size="sm"
                                                            onClick={() => this.handleTestConnection(server.id)}
                                                            disabled={testingServer === server.id}
                                                            title="Test connection"
                                                        >
                                                            <i className="fa fa-plug"></i>
                                                        </Button>
                                                        {' '}
                                                        <Button
                                                            color="warning"
                                                            size="sm"
                                                            onClick={() => this.handleRestartServer(server.id)}
                                                            disabled={restartingServer === server.id}
                                                            title={restartingServer === server.id ? `Restarting... ${restartCountdown}s` : "Restart RCD service"}
                                                        >
                                                            {restartingServer === server.id ? (
                                                                <>
                                                                    <i className="fa fa-spinner fa-spin"></i> {restartCountdown}s
                                                                </>
                                                            ) : (
                                                                <i className="fa fa-refresh"></i>
                                                            )}
                                                        </Button>
                                                        {' '}
                                                        {/* Hide set-default in Community edition (only 1 server) */}
                                                        {!isCommunity && server.id !== defaultServerId && (
                                                            <>
                                                                <Button
                                                                    color="success"
                                                                    size="sm"
                                                                    onClick={() => this.handleSetDefault(server.id)}
                                                                    title="Set as default"
                                                                >
                                                                    <i className="fa fa-star"></i>
                                                                </Button>
                                                                {' '}
                                                            </>
                                                        )}
                                                        <Button
                                                            color="primary"
                                                            size="sm"
                                                            onClick={() => this.openEditModal(server)}
                                                            title="Edit"
                                                        >
                                                            <i className="fa fa-edit"></i>
                                                        </Button>
                                                        {' '}
                                                        {/* Hide delete in Community edition (only 1 server allowed) */}
                                                        {!isCommunity && (
                                                            <Button
                                                                color="danger"
                                                                size="sm"
                                                                onClick={() => this.handleDeleteClick(server)}
                                                                disabled={deletingServer === server.id}
                                                                title="Delete"
                                                            >
                                                                {deletingServer === server.id ? (
                                                                    <i className="fa fa-spinner fa-spin"></i>
                                                                ) : (
                                                                    <i className="fa fa-trash"></i>
                                                                )}
                                                            </Button>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                </tbody>
                            </Table>
                        )}
                    </Col>
                </Row>

                {/* Add/Edit Modal */}
                <Modal isOpen={modal} toggle={this.toggleModal} size="lg" backdrop="static">
                    <ModalHeader toggle={this.toggleModal}>
                        {editMode ? 'Edit Server' : 'Add New Server'}
                    </ModalHeader>
                    <Form onSubmit={this.handleSubmit}>
                        <ModalBody>
                            <FormGroup row>
                                <Label for="name" sm={3}>Server Name *</Label>
                                <Col sm={9}>
                                    <Input
                                        type="text"
                                        name="name"
                                        id="name"
                                        placeholder="e.g., Production Rclone, Office Server"
                                        value={currentServer.name}
                                        onChange={this.handleInputChange}
                                        required
                                    />
                                    <small className="form-text text-muted">
                                        A friendly name to identify this server
                                    </small>
                                </Col>
                            </FormGroup>

                            <FormGroup row>
                                <Label for="url" sm={3}>URL *</Label>
                                <Col sm={9}>
                                    <Input
                                        type="text"
                                        name="url"
                                        id="url"
                                        placeholder="https://192.168.1.100 or http://localhost"
                                        value={currentServer.url}
                                        onChange={this.handleInputChange}
                                        required
                                    />
                                    <small className="form-text text-muted">
                                        Server URL without port (e.g., https://192.168.1.100)
                                    </small>
                                    {currentServer.url && currentServer.url.startsWith('http://') && !currentServer.url.includes('localhost') && !currentServer.url.includes('127.0.0.1') && (
                                        <small className="form-text" style={{ color: '#9c3971' }}>
                                            <i className="fa fa-exclamation-triangle"></i> <strong>Warning:</strong> Running over http:// is insecure - https:// is strongly recommended for remote connections
                                        </small>
                                    )}
                                </Col>
                            </FormGroup>

                            <FormGroup row>
                                <Label for="port" sm={3}>Port *</Label>
                                <Col sm={9}>
                                    <Input
                                        type="number"
                                        name="port"
                                        id="port"
                                        placeholder="5572"
                                        value={currentServer.port}
                                        onChange={this.handleInputChange}
                                        required
                                    />
                                    <small className="form-text text-muted">
                                        Rclone RCD port (default: 5572)
                                    </small>
                                </Col>
                            </FormGroup>

                            <FormGroup row>
                                <Label for="username" sm={3}>Username *</Label>
                                <Col sm={9}>
                                    <Input
                                        type="text"
                                        name="username"
                                        id="username"
                                        placeholder="admin"
                                        value={currentServer.username}
                                        onChange={this.handleInputChange}
                                        required
                                        autoComplete="off"
                                    />
                                    <small className="form-text text-muted">
                                        Rclone RCD username (--rc-user)
                                    </small>
                                </Col>
                            </FormGroup>

                            <FormGroup row>
                                <Label for="password" sm={3}>Password *</Label>
                                <Col sm={9}>
                                    <Input
                                        type="password"
                                        name="password"
                                        id="password"
                                        placeholder={editMode ? "Leave empty to keep current password" : "Enter password"}
                                        value={currentServer.password}
                                        onChange={this.handleInputChange}
                                        required={!editMode}
                                        autoComplete="off"
                                    />
                                    <small className="form-text text-muted">
                                        {editMode 
                                            ? "Leave empty to keep the current password" 
                                            : "Rclone RCD password (--rc-pass)"
                                        }
                                    </small>
                                </Col>
                            </FormGroup>
                        </ModalBody>
                        <ModalFooter>
                            <div style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <Button 
                                    color={modalTestResult === 'success' ? 'success' : modalTestResult === 'error' ? 'danger' : 'info'}
                                    onClick={this.handleTestInModal}
                                    disabled={testingInModal}
                                >
                                    {testingInModal ? (
                                        <><i className="fa fa-spinner fa-spin"></i> Testing...</>
                                    ) : modalTestResult === 'success' ? (
                                        <><i className="fa fa-check"></i> Connected</>
                                    ) : modalTestResult === 'error' ? (
                                        <><i className="fa fa-times"></i> Failed</>
                                    ) : (
                                        <><i className="fa fa-plug"></i> Try Connection</>
                                    )}
                                </Button>
                                {modalTestMessage && (
                                    <small style={{ color: modalTestResult === 'success' ? '#28a745' : '#dc3545' }}>
                                        {modalTestMessage}
                                    </small>
                                )}
                            </div>
                            <Button color="secondary" onClick={this.toggleModal}>Cancel</Button>
                            <Button color="primary" type="submit">
                                {editMode ? 'Update' : 'Add'} Server
                            </Button>
                        </ModalFooter>
                    </Form>
                </Modal>

                {/* Error Details Modal */}
                <Modal isOpen={errorModalOpen} toggle={this.closeErrorModal}>
                    <ModalHeader toggle={this.closeErrorModal}>
                        <i className="fa fa-exclamation-triangle text-danger"></i> Connection Error Details
                    </ModalHeader>
                    <ModalBody>
                        <p><strong>Error:</strong></p>
                        <pre style={{ 
                            backgroundColor: '#f8f9fa', 
                            padding: '10px', 
                            borderRadius: '4px',
                            border: '1px solid #dee2e6',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word'
                        }}>
                            {errorModalMessage}
                        </pre>
                    </ModalBody>
                    <ModalFooter>
                        <Button color="secondary" onClick={this.closeErrorModal}>Close</Button>
                    </ModalFooter>
                </Modal>

                {/* Delete Server Confirmation Modal */}
                <ConfirmModal
                    isOpen={this.state.showDeleteModal}
                    toggle={this.toggleDeleteModal}
                    onConfirm={this.handleConfirmDelete}
                    title="Delete Rclone Server"
                    message={
                        this.state.serverToDelete && (
                            <>
                                <p>Are you sure you want to delete the server <strong>{this.state.serverToDelete.name}</strong>?</p>
                                <p className="text-muted mb-0">
                                    <i className="fa fa-info-circle"></i> URL: {this.state.serverToDelete.url}:{this.state.serverToDelete.port}
                                </p>
                                <p className="text-danger mt-2 mb-0">
                                    <i className="fa fa-exclamation-triangle"></i> This action cannot be undone!
                                </p>
                            </>
                        )
                    }
                    confirmText="Delete"
                    cancelText="Cancel"
                    confirmColor="danger"
                    icon="fa-trash"
                    isLoading={this.state.deletingServer === (this.state.serverToDelete && this.state.serverToDelete.id)}
                />

                {/* Upgrade Modal - Community Edition */}
                <Modal isOpen={this.state.showUpgradeModal} toggle={this.toggleUpgradeModal} size="lg">
                    <ModalHeader toggle={this.toggleUpgradeModal}>
                        <i className="fa fa-lock text-warning"></i> Multi-Server Feature
                    </ModalHeader>
                    <ModalBody>
                        <div className="text-center" style={{ padding: '20px' }}>
                            <i className="fa fa-server fa-4x text-muted" style={{ marginBottom: '20px' }}></i>
                            <h4>Multi-Server Management</h4>
                            <p className="text-muted" style={{ fontSize: '16px', marginTop: '15px' }}>
                                Adding multiple Rclone servers is only available in the <strong>Commercial edition</strong>.
                            </p>
                            <p style={{ marginTop: '20px' }}>
                                The Community edition supports managing a single Rclone server. 
                                Upgrade to the Commercial edition to connect and manage multiple Rclone backends from a single UI.
                            </p>
                            <Alert color="info" style={{ marginTop: '25px', textAlign: 'left' }}>
                                <h6><i className="fa fa-star"></i> Commercial Edition Benefits:</h6>
                                <ul style={{ marginBottom: 0 }}>
                                    <li>Connect unlimited Rclone servers</li>
                                    <li>Switch between servers with one click</li>
                                    <li>Centralized management of all your cloud storage</li>
                                    <li>Priority support</li>
                                </ul>
                            </Alert>
                        </div>
                    </ModalBody>
                    <ModalFooter>
                        <Button color="secondary" onClick={this.toggleUpgradeModal}>
                            Close
                        </Button>
                        <Button 
                            color="primary" 
                            onClick={() => window.open('https://www.speedbits.io', '_blank')}
                        >
                            <i className="fa fa-external-link"></i> Get Commercial Edition
                        </Button>
                    </ModalFooter>
                </Modal>
            </div>
        );
    }
}

export default RcloneServers;

