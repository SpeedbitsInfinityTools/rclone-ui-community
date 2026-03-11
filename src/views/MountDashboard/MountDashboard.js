import React from 'react';
import {connect} from "react-redux";
import {Button, Col, Row, Table} from "reactstrap";
import * as PropTypes from "prop-types";
import {addMount, getMountList, unmount, unmountAll} from "../../actions/mountActions";
import NewMountModal from "./NewMountModal";

/**
 * MountDashboard is the main page for mounting and unmounting drives.
 */
class MountDashboard extends React.Component {

	constructor(props, context) {
		super(props, context);
		this.state = {
			showNewMountCard: false,
			isRefreshing: false,
			checkingConnection: true, // Start with checking state
			connectionFailed: false // Track if connection check failed
		}
		// Track the server ID for the current connection check to prevent race conditions
		this.pendingCheckServerId = null;
	}

	componentDidMount() {
		// Check connection before allowing actions
		this.checkInitialConnection();
		
		// Listen for server changes
		this.serverChangeHandler = () => {
			console.log('[MountDashboard] Server changed, re-checking connection...');
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
		const {getMountList} = this.props;
		
		// Get the current server ID to track this specific check
		const currentServerId = sessionStorage.getItem('RCLONE_SERVER_ID') || 'default';
		this.pendingCheckServerId = currentServerId;
		
		console.log(`[MountDashboard] Starting connection check for server: ${currentServerId}`);
		
		// Set checking state to show spinner
		this.setState({ 
			checkingConnection: true,
			connectionFailed: false 
		});
		
		try {
			// Make a direct API call to check connection (not Redux action)
			const axiosInstance = require('../../utils/API/API').default;
			await axiosInstance.post('mount/listmounts');
			
			// Check if we're still on the same server (prevent race condition)
			const stillCurrentServer = sessionStorage.getItem('RCLONE_SERVER_ID') || 'default';
			if (stillCurrentServer !== currentServerId) {
				console.log(`[MountDashboard] Server changed during check (was ${currentServerId}, now ${stillCurrentServer}). Ignoring stale result.`);
				return; // Ignore this result - we've switched servers
			}
			
			// If successful, dispatch Redux action to populate store
			getMountList();
			
			console.log(`[MountDashboard] Connection check succeeded for server: ${currentServerId}`);
			this.setState({ 
				checkingConnection: false,
				connectionFailed: false 
			});
		} catch (error) {
			// Check if we're still on the same server (prevent race condition)
			const stillCurrentServer = sessionStorage.getItem('RCLONE_SERVER_ID') || 'default';
			if (stillCurrentServer !== currentServerId) {
				console.log(`[MountDashboard] Server changed during check (was ${currentServerId}, now ${stillCurrentServer}). Ignoring stale error.`);
				return; // Ignore this result - we've switched servers
			}
			
			console.log(`[MountDashboard] Connection check failed for server: ${currentServerId}`, error);
			this.setState({ 
				checkingConnection: false,
				connectionFailed: true 
			});
		}
	};

	handleRefresh = async () => {
		const {getMountList} = this.props;
		this.setState({ isRefreshing: true });
		try {
			// Make a direct API call to refresh
			const axiosInstance = require('../../utils/API/API').default;
			await axiosInstance.post('mount/listmounts');
			
			// If successful, dispatch Redux action to populate store
			getMountList();
		} catch (error) {
			console.error('[MountDashboard] Refresh failed:', error);
			// Error will be shown via toast from mountActions
		} finally {
			// Show spinner for at least 500ms for visual feedback
			setTimeout(() => {
				this.setState({ isRefreshing: false });
			}, 500);
		}
	};


	handleRemoveMount = (item) => {
		const {unmount} = this.props;
		unmount(item.MountPoint);
	}

	handleCreateNewMount = (mountFs, mountPoint, vfsOptions, mountOptions) => {
		const {addMount} = this.props;
		addMount(mountFs, mountPoint, "", vfsOptions, mountOptions);
	}

	handleUnmountAll = () => {
		const {unmountAll} = this.props;
		unmountAll();
	}


	render() {
		const {currentMounts, getMountList, hasError} = this.props;
		const {isRefreshing, checkingConnection, connectionFailed} = this.state;
		
		// Check if mounts are loaded
		const mountsLoaded = currentMounts && Array.isArray(currentMounts);
		const hasMounts = mountsLoaded && currentMounts.length > 0;
		
		// Disable actions if checking connection or has error (check local state first, then Redux state)
		const isDisconnected = checkingConnection || connectionFailed || hasError;
		
		// Show loading spinner while checking connection
		if (checkingConnection) {
			return (
				<div className="animated fadeIn" data-test="mountDashboardComponent">
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
				<div className="animated fadeIn" data-test="mountDashboardComponent">
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
								You cannot create or manage mounts without an active connection to an Rclone server. 
								Mount operations require direct communication with the RCD backend.
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
		}
		
		return (
			<div data-test="mountDashboardComponent">
				
				<Row>
					<Col lg={12} className="mb-4 d-flex justify-content-between" style={{marginTop: "10px"}}>
						<NewMountModal 
							buttonLabel={checkingConnection ? "Checking..." : hasError ? "Create new mount (Server Disconnected)" : "Create new mount"} 
							okHandle={this.handleCreateNewMount} 
							refreshList={getMountList} 
							disabled={isDisconnected}
						/>
						<div>
							<Button className={"mr-2"} color="secondary" onClick={this.handleRefresh} disabled={isRefreshing || isDisconnected}>
								{isRefreshing ? (
									<><i className="fa fa-spinner fa-spin"></i> Refreshing...</>
								) : (
									<><i className="fa fa-refresh"></i> Refresh</>
								)}
							</Button>
							<Button className={"float-right"} color="danger" onClick={this.handleUnmountAll} disabled={isDisconnected}>
								{isDisconnected ? (
									<><i className="fa fa-ban"></i> Unmount all</>
								) : (
									<>Unmount all</>
								)}
							</Button>
						</div>
					</Col>
				</Row>
				<Table responsive className="table-striped">
					<thead>
					<tr>
						<th>No.</th>
						<th>Mount Point</th>
						<th>Mounted since</th>
						<th>Remote (Fs)</th>
						<th>Actions</th>
					</tr>
					</thead>
					<tbody>
					{
						currentMounts && currentMounts.map((item, index) => {
								return (<tr key={item.MountPoint}>
									<td>{index}</td>
									<td>{item.MountPoint}</td>
									<td>{new Date(item.MountedOn).toLocaleTimeString()}</td>
									<td>{item.Fs}</td>
									<td>
										<Button color="danger" onClick={() => this.handleRemoveMount(item)} disabled={isDisconnected}>
											{isDisconnected ? <><i className="fa fa-ban"></i> Unmount</> : <>Unmount</>}
										</Button>
									</td>
								</tr>);
							}
						)

					}
					</tbody>
				</Table>

			</div>);
	}
}

const mapStateToProps = state => ({
	currentMounts: state.mount.currentMounts,
	hasError: state.mount.error !== null && state.mount.error !== undefined,
});

MountDashboard.propTypes = {
	// currentMounts: PropTypes.object.isRequired,
	currentMounts: PropTypes.arrayOf(PropTypes.object).isRequired,
	getMountList: PropTypes.func.isRequired,
	addMount: PropTypes.func.isRequired,
	unmount: PropTypes.func.isRequired
};

export default connect(mapStateToProps, {getMountList, addMount, unmount, unmountAll})(MountDashboard);
