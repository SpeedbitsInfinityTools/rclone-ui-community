import React from 'react';
import {Alert, Button, Card, CardBody, Col, Collapse, Container, FormGroup, Input, Label, Row, Modal, ModalHeader, ModalBody, ModalFooter, Table} from "reactstrap";
import ConfirmModal from "../../../components/ConfirmModal";
import axiosInstance from "../../../utils/API/API";
import {isEmpty, supportsOAuth} from "../../../utils/Tools";
import { detectSystem } from "../../../utils/detectSystem";
import ProviderAutoSuggest from "./ProviderAutoSuggest";
import {toast} from "react-toastify";
import * as PropTypes from 'prop-types';
import {getProviders} from "../../../actions/configActions";
import {connect} from "react-redux";
import ErrorBoundary from "../../../ErrorHandling/ErrorBoundary";
import urls from "../../../utils/API/endpoint";
import {withRouter} from "../../../utils/withRouter";
import {checkOAuthStatus, testLocalAppConnection as testLocalAppConnectionAPI, discoverOneDriveLocations} from "../../../utils/API/director";
import {DriveParameters, CustomInput} from "./DriveParameters";
import * as oauthHandlers from "./oauthHandlers";
import * as formHandlers from "./formHandlers";
import * as testConnectionHandlers from "./testConnection";
import SharePointLocationPicker from "../SharePointPicker/SharePointLocationPicker";


/**
 * Component to create a new remote configuration.
 */
class NewDrive extends React.Component {

    constructor(props, context) {
        super(props, context);
        this.state = {

            colRconfig: true,
            colSetup: false,
            colAdvanced: false,
            driveName: "",
            driveNameIsEditable: true,
            originalDriveName: null, // Stores original name when editing (for rename validation)

            advancedOptions: false,
            formValues: {},
            formValuesValid: {},
            required: {},
            authModalIsVisible: false,
            showSuccessModal: false,
            successMessage: "",

            drivePrefix: "",
            driveNameIsValid: false,
            formErrors: {driveName: ""},
            optionTypes: {},
            isValid: {},

            currentStepNumber: 1,
            
      testResults: {
                tested: false,
                connectionTest: null,
                readTest: null,
                writeTest: null,
                error: null
      },
      testingConnection: false,

      // Help panel expand state
      providerHelpExpanded: false,
      
      // Encryption options
      addEncryption: false,
      encPassword: "",
      encPasswordRepeat: "",
      useFilenamePassword: false,
      encPassword2: "",
      encPassword2Repeat: "",

      // Template import
      showTemplateModal: false,
      templates: [],
      loadingTemplates: false,

      // Cancel confirmation modal
      showCancelModal: false,

      // Revoke authentication confirmation modal
      showRevokeModal: false,
      revokingAuth: false, // Loading state for revoke operation

      // OAuth authentication
      oauthAuthenticating: false,
      oauthPollInterval: null,
      oauthAuthUrl: null,
      oauthAttempts: 0,
      oauthAccountInfo: null, // { email, name, provider }
      oauthAuthenticated: false,
      oauthIsLocalMachine: null, // null = not checked yet, true/false = detected
      oauthStatusMessages: [], // Array of status messages: [{ step, message }]
      
      // Manual token entry
      showManualTokenEntry: false,
      manualTokenInput: '',

      // Saving state
      saving: false,

      // Connection check
      checkingConnection: false,
      isConnected: null,

      // OAuth port check modal
      showOAuthPortModal: false,
      oauthPortCheckFailed: false,

      // Auth Helper download modal
      showAuthHelperModal: false,

      // Detected system for highlighting downloads
      detectedSystem: detectSystem(),
      
      // Testing RcloneAuthHelper connection
      testingAuthHelper: false,

      // SharePoint location picker (OneDrive only).
      // - sharePointDiscovery: raw response from /onedrive/discover-locations.
      //   Cached so the modal opens instantly the second time without re-fetching.
      // - sharePointDiscoveryLoading / Error: status of that background call.
      // - showSharePointPicker: modal visibility.
      // - sharePointPickerAutoShown: one-shot guard so we only auto-open the
      //   picker once per OAuth completion (closing it shouldn't make it pop
      //   back open on every re-render). The manual button always re-opens it.
      // - sharePointLocationLabel: human-readable label of the currently
      //   selected location (e.g. "OneDrive – Profilbilder" or
      //   "SIM-Privacy » Documents"). Used in the status row in step 2.
      sharePointDiscovery: null,
      sharePointDiscoveryLoading: false,
      sharePointDiscoveryError: null,
      showSharePointPicker: false,
      sharePointPickerAutoShown: false,
      sharePointLocationLabel: null

        };
        this.configCheckInterval = null;
        // Track the server ID for the current connection check to prevent race conditions
        this.pendingCheckServerId = null;
        // Bind extracted prototype methods so they can be used as callbacks safely.
        [...Object.keys(oauthHandlers), ...Object.keys(formHandlers), ...Object.keys(testConnectionHandlers)].forEach((methodName) => {
            if (typeof this[methodName] === 'function') {
                this[methodName] = this[methodName].bind(this);
            }
        });
        // console.log("Params", this.props.match.params);
        this.handleSubmit = this.handleSubmit.bind(this);
        this.toggleAuthModal = this.toggleAuthModal.bind(this);
        this.startAuthentication = this.startAuthentication.bind(this);
        this.checkConfigStatus = this.checkConfigStatus.bind(this);
        this.handleOAuthAuthenticate = this.handleOAuthAuthenticate.bind(this);
        this.toggleManualTokenEntry = this.toggleManualTokenEntry.bind(this);
        this.handleManualTokenSubmit = this.handleManualTokenSubmit.bind(this);
        // checkOAuthStatusViaDirector is an arrow function, no binding needed
    }
    
    componentWillUnmount() {
        // Clean up OAuth polling interval
        if (this.state.oauthPollInterval) {
            clearInterval(this.state.oauthPollInterval);
        }
        // Clean up config check interval
        if (this.configCheckInterval) {
            clearInterval(this.configCheckInterval);
            this.configCheckInterval = null;
        }
        // Remove message listener
        if (this.handleOAuthMessage) {
            window.removeEventListener('message', this.handleOAuthMessage);
        }
        // Remove server change listener
        if (this.serverChangeHandler) {
            window.removeEventListener('rclone-server-changed', this.serverChangeHandler);
        }
        // Set flag to prevent setState calls after unmount
        this._isMounted = false;
    }
    
    /**
     * Check server connection status proactively
     */
    async checkConnectionStatus() {
        // Get the current server ID to track this specific check
        const currentServerId = sessionStorage.getItem('RCLONE_SERVER_ID') || 'default';
        this.pendingCheckServerId = currentServerId;
        
        console.log(`[NewDrive] Starting connection check for server: ${currentServerId}`);
        
        // Set checking state
        if (this._isMounted) {
            this.setState({ checkingConnection: true });
        }
        
        try {
            // Make a direct API call to check connection (not Redux action)
            const { getAllProviders } = require('rclone-api');
            const response = await getAllProviders();
            
            // Check if we're still on the same server (prevent race condition)
            const stillCurrentServer = sessionStorage.getItem('RCLONE_SERVER_ID') || 'default';
            if (stillCurrentServer !== currentServerId) {
                console.log(`[NewDrive] Server changed during check (was ${currentServerId}, now ${stillCurrentServer}). Ignoring stale result.`);
                return; // Ignore this result - we've switched servers
            }
            
            // If we got providers, we're connected
            if (this._isMounted && response && response.providers) {
                console.log(`[NewDrive] Connection check succeeded for server: ${currentServerId}`);
                this.setState({ 
                    checkingConnection: false,
                    isConnected: true
                });
                
                // Now dispatch the Redux action to populate the store (suppress toast - we handle errors with full-page UI)
                this.props.getProviders(true);
            }
        } catch (error) {
            // Check if we're still on the same server (prevent race condition)
            const stillCurrentServer = sessionStorage.getItem('RCLONE_SERVER_ID') || 'default';
            if (stillCurrentServer !== currentServerId) {
                console.log(`[NewDrive] Server changed during check (was ${currentServerId}, now ${stillCurrentServer}). Ignoring stale error.`);
                return; // Ignore this result - we've switched servers
            }
            
            console.error(`[NewDrive] Connection check failed for server: ${currentServerId}`, error);
            
            // Suppress the toast from configActions since we're showing a full-page warning
            // The error will be logged but not shown as a toast
            
            if (this._isMounted) {
                this.setState({ 
                    checkingConnection: false,
                    isConnected: false
                });
            }
        }
    }

    componentDidMount() {
        // Set flag to track if component is mounted
        this._isMounted = true;
        
        // Check connection status first
        this.checkConnectionStatus();
        
        // Detect environment on mount so banner shows immediately on all steps
        this.detectOAuthEnvironment();
        
        // Listen for OAuth popup messages
        this.handleOAuthMessage = (event) => {
            // Security: Only accept messages from same origin or trusted OAuth callback
            // In production, you might want to check event.origin
            if (event.data === 'oauth-success' || event.data === 'oauth-error') {
                console.log(`[OAuth] Received message from popup: ${event.data}`);
                
                // Clear polling interval if active
                if (this.state.oauthPollInterval) {
                    clearInterval(this.state.oauthPollInterval);
                }
                
                // Re-enable the authenticate button
                if (this._isMounted) {
                        this.setState({ 
                            oauthAuthenticating: false,
                            oauthPollInterval: null,
                            oauthAuthUrl: null,
                            oauthAttempts: 0,
                            oauthStatusMessages: []
                        });
                }
                
                if (event.data === 'oauth-error') {
                    toast.error("OAuth authentication failed. Please try again.", { autoClose: 5000 });
                } else if (event.data === 'oauth-success') {
                    // Check status one more time to be sure
                    const {driveName} = this.state;
                    const selectedServerId = sessionStorage.getItem('RCLONE_SERVER_ID');
                    const serverId = selectedServerId && selectedServerId !== 'null' ? selectedServerId : null;
                    
                    // Small delay to ensure backend has processed the callback
                    setTimeout(async () => {
                        if (this._isMounted) {
                            try {
                                const statusResponse = await checkOAuthStatus(driveName, serverId);
                                if (statusResponse.success && statusResponse.authenticated) {
                                    toast.success("✅ OAuth authentication successful!");
                                    await this.loadRemoteConfig(driveName);
                                } else {
                                    // Still polling, let the polling handle it
                                    console.log('[OAuth] Success message received but config not ready yet, continuing to poll...');
                                }
                            } catch (error) {
                                console.error('[OAuth] Error checking status after success message:', error);
                            }
                        }
                    }, 1000);
                }
            }
        };
        
        window.addEventListener('message', this.handleOAuthMessage);
        
        // Listen for server changes
        this.serverChangeHandler = () => {
            console.log('[NewDrive] Server changed, re-checking connection...');
            // Re-run connection check when server changes
            this.checkConnectionStatus();
            // Also re-detect OAuth environment since server changed
            this.detectOAuthEnvironment();
        };
        window.addEventListener('rclone-server-changed', this.serverChangeHandler);
        
        // Check if the provider list is empty else request new providers list
        // NOTE: This is handled by checkConnectionStatus() now
        const {drivePrefix} = this.props.match.params;

        if (drivePrefix) {
            //Edit Mode - store original name for rename validation
            this.setState({driveName: drivePrefix, driveNameIsValid: true, driveNameIsEditable: true, originalDriveName: drivePrefix});
            axiosInstance.post(urls.getConfigForRemote, {name: drivePrefix}).then(
                async (res) => {
                    console.log(res);
                    // Store the loaded config data temporarily
                    const loadedConfig = res.data;
                    
                    // Set formValues first, then change drive type (which will validate them)
                    const remoteName = drivePrefix; // Save remote name before it gets overwritten
                    this.setState({formValues: loadedConfig}, async () => {
                        this.changeDriveType(undefined, {newValue: loadedConfig.type});
                        
                        // Check OAuth status after loading config
                        // Wait a bit for state to settle (changeDriveType sets drivePrefix)
                        setTimeout(async () => {
                            // Use the remote name and type from loaded config
                            await this.checkOAuthStatusAndAccountInfo(remoteName, loadedConfig.type);

                            // Edit mode for OneDrive: pre-load discovery so the
                            // status row can show "Connected to: <current>" and
                            // the manual button works without a fetch latency
                            // on first click. We deliberately set
                            // sharePointPickerAutoShown=true here so editing an
                            // existing remote doesn't surprise users with a
                            // modal — they explicitly chose this location at
                            // creation time.
                            if (loadedConfig.type === 'onedrive' && this._isMounted) {
                                this.setState({ sharePointPickerAutoShown: true }, () => {
                                    this.triggerSharePointDiscovery({ autoOpen: false });
                                });
                            }
                        }, 500);
                    });
                }
            )
        }
    }

    /**
     *
     * @param e {$ObjMap} Event of the toggle event.
     */
    toggle = (e) => {
        let name = e.target.name;

        this.setState({[name]: !this.state[name]})
    };

    // Returns true or false based on whether the config is created
    // NOTE: This function is no longer used in the new flow - success is handled via success modal
    async checkConfigStatus() {
        const {driveName} = this.state;

        try {
            let res = await axiosInstance.post(urls.getConfigForRemote, {name: driveName});
            // console.log(res);

            if (!isEmpty(res.data)) {
                // Config is created, clear the interval and hide modal
                if (this.configCheckInterval) {
                    clearInterval(this.configCheckInterval);
                    this.configCheckInterval = null;
                }
                this.stopAuthentication();
                // Don't redirect here - let handleSubmit show the success modal instead
                // The success modal will handle the redirect to /showconfig
            }
        } catch (e) {
            // console.log(`Error occurred while checking for config: ${e}`);
            // Only show error if we're still in the old authentication flow
            if (this.state.authModalIsVisible) {
                toast.error(`Error creating config. ${e}`);
            }
        }
    }
    
    /**
     * Handle OAuth authentication for remotes that support it
     */
    /**
     * Test connection to RcloneAuthApp
     */
    testLocalAppConnection = async () => {
        this.setState({ testingAuthHelper: true });
        try {
            await testLocalAppConnectionAPI();
            toast.success(`✅ Rclone Auth Helper App is running and connected!`, { autoClose: 3000 });
            return true;
        } catch (error) {
            toast.error(`❌ Rclone Auth Helper App is not running or not reachable. Please start the app first.`, { autoClose: 5000 });
            return false;
        } finally {
            this.setState({ testingAuthHelper: false });
        }
    };

    /**
     * Get current server URL from browser location
     */
    getServerUrl = () => {
        const { protocol, hostname, port } = window.location;
        // Use current browser location as server URL
        // Remove /#/hash if present
        const baseUrl = `${protocol}//${hostname}${port ? ':' + port : ''}`;
        return baseUrl;
    };

    /**
     * Build a human-readable "Connected to..." label from a discovery response
     * and the currently-selected drive_id / drive_type in formValues.
     */
    _computeSharePointLabel = (discovery, formValues) => {
        if (!discovery) return null;
        const driveId = formValues?.drive_id;
        if (!driveId) return null;
        const personal = (discovery.personal?.drives || []).find(d => d.drive_id === driveId);
        if (personal) return `OneDrive – ${personal.name || 'Personal'}`;
        // We may not have the matching SharePoint drive name without a second
        // round-trip; if we do (because the user picked it in this session),
        // it'll be stamped into state by handleSharePointConfirm directly.
        return 'SharePoint document library';
    };

    /**
     * Trigger SharePoint location discovery for the currently-loaded OneDrive
     * remote. Caches the result on the component so the picker opens instantly
     * the second time.
     *
     * @param {Object} options
     * @param {boolean} options.autoOpen - If true and the account can see >=1
     *   SharePoint sites, automatically open the picker modal. Guarded by
     *   `sharePointPickerAutoShown` so it only happens once per OAuth session.
     */
    triggerSharePointDiscovery = async ({ autoOpen = false } = {}) => {
        if (!this._isMounted) return;
        const { drivePrefix, driveName } = this.state;
        if (drivePrefix !== 'onedrive' || !driveName) return;
        // Avoid concurrent in-flight calls.
        if (this.state.sharePointDiscoveryLoading) return;

        this.setState({ sharePointDiscoveryLoading: true, sharePointDiscoveryError: null });
        try {
            const result = await discoverOneDriveLocations(driveName);
            if (!this._isMounted) return;
            this.setState(prev => {
                const next = {
                    sharePointDiscoveryLoading: false,
                    sharePointDiscoveryError: null,
                    sharePointDiscovery: result,
                    sharePointLocationLabel:
                        prev.sharePointLocationLabel ||
                        this._computeSharePointLabel(result, prev.formValues)
                };
                if (autoOpen && !prev.sharePointPickerAutoShown && Array.isArray(result?.sites) && result.sites.length >= 1) {
                    next.showSharePointPicker = true;
                    next.sharePointPickerAutoShown = true;
                }
                return next;
            });
        } catch (e) {
            if (!this._isMounted) return;
            console.warn('[NewDrive] SharePoint discovery failed:', e.message);
            // Non-fatal: silently leave the manual button enabled so the user
            // can still try to open the picker themselves (and see the same
            // error inside the modal, where it has more room to breathe).
            this.setState({ sharePointDiscoveryLoading: false, sharePointDiscoveryError: e.message || 'Failed' });
        }
    };

    openSharePointPicker = () => {
        // Manual open: trigger a fresh discovery if we have no cached result,
        // otherwise reuse the cache (the picker itself re-discovers on mount
        // anyway, so this is just so the discovery error — if any — clears).
        this.setState({ showSharePointPicker: true });
    };

    closeSharePointPicker = () => {
        this.setState({ showSharePointPicker: false });
    };

    /**
     * Called by the picker when the user confirms a selection (in-form mode).
     * Writes drive_id / drive_type into formValues so the wizard's normal
     * submit path picks them up via config/create or config/update.
     */
    handleSharePointConfirm = (selection) => {
        if (!selection?.drive) {
            this.setState({ showSharePointPicker: false });
            return;
        }
        const driveId = selection.drive.drive_id;
        const driveType = selection.drive.drive_type;
        const label = selection.kind === 'site'
            ? `${selection.site?.displayName || 'SharePoint'} » ${selection.drive.name}`
            : `OneDrive – ${selection.drive.name || 'Personal'}`;

        this.setState(prev => {
            const newFormValues = {
                ...prev.formValues,
                drive_id: driveId,
                drive_type: driveType
            };
            // Re-run validation so the wizard's Next button reflects the new
            // form state. validateFormValues lives on the prototype via the
            // formHandlers mixin.
            let validation = { isValid: prev.formValuesValid, errors: prev.formErrors };
            if (typeof this.validateFormValues === 'function') {
                try {
                    validation = this.validateFormValues(newFormValues, prev.optionTypes, prev.required);
                } catch (e) {
                    console.warn('[NewDrive] validateFormValues threw after SharePoint pick:', e.message);
                }
            }
            return {
                formValues: newFormValues,
                isValid: validation.isValid,
                formErrors: validation.errors,
                formValuesValid: validation.isValid,
                sharePointLocationLabel: label,
                showSharePointPicker: false
            };
        });
        toast.success(`Connected to: ${label}`, { autoClose: 4000 });
    };



    StepShowCase = ({currentStepNumber}) => {
        const buttonActiveClassName = "step-active";
        const stepTitles = [
            "Choose Remote",
            "Configure Remote",
            "Advanced Options",
            "Test Remote"
        ];

        return (
            <Container className="timeline">
                <Row className="justify-content-center">
                    {stepTitles.map((item, idx) => {
                        idx += 1;
                        return (
                            <React.Fragment key={idx}>
                                <Col
                                    className={"text-center " + ((currentStepNumber === idx) ? buttonActiveClassName : "")}
                                    style={{maxWidth: '140px', padding: '0 5px'}}>
                                    <button className="btn btn-step-count" style={{margin: '0 auto'}}
                                            onClick={() => this.setCurrentStep(idx)}>{idx}</button>
                                    <h4 style={{fontSize: '13px', marginTop: '10px'}}>{item}</h4>
                                </Col>
                                {idx !== stepTitles.length && <Col md={2} sm={2} className={"d-none d-md-block"} style={{padding: '0', minWidth: '80px', maxWidth: '120px'}}>
                                    <div className="timeline-divider align-middle"></div>

                                </Col>}
                            </React.Fragment>
                        )
                    })}

                </Row>
            </Container>
        )

    }

    /* return (
            <div className="timeline">
                <span className="li complete">
                    <button className="btn btn-primary btn-step-count">1</button>
                    <div class="status">
                        <h4> Shift Created </h4>
                    </div>    
                </span> 
                <div className="timeline-divider"></div>  
                <li className="li complete">
                    <div class="status">
                        <h4> Shift Created </h4>
                    </div>    
                </li>   
                <li className="li complete">
                    <div class="status">
                        <h4> Shift Created </h4>
                    </div>    
                </li>    
            </div>
       ) */


    render() {
        const {drivePrefix, driveName, driveNameIsValid, currentStepNumber, oauthIsLocalMachine} = this.state;
        const {providers, version} = this.props;
        
        // Check if providers are loaded (indicates server connection)
        const providersLoaded = providers && Array.isArray(providers) && providers.length > 0;
        
        // Determine if current remote type supports OAuth
        const isOAuthRemote = drivePrefix && providers && supportsOAuth(providers, drivePrefix);
        
        // Use Redux version state as primary connection indicator
        const reduxConnected = version && (version.version || version.decomposed) && !version.hasError;
        const isConnected = reduxConnected || this.state.isConnected || providersLoaded;
        
        // Show loading spinner only during active local check AND no Redux data yet
        if (this.state.checkingConnection && !reduxConnected && !providersLoaded) {
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

        // Show warning if not connected (only after check completes or Redux reports error)
        if (!isConnected && (this.state.isConnected === false || version.hasError)) {
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
                                        You cannot create or edit remotes without an active connection to an Rclone server. 
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
                                    onClick={() => this.props.history.push('/rclone-servers')}
                                    style={{marginRight: '10px'}}
                                >
                                    <i className="fa fa-server"></i> Manage Servers
                                </Button>
                                <Button 
                                    color="secondary" 
                                    onClick={() => this.checkConnectionStatus()}
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
            <div data-test="newDriveComponent">
                <ErrorBoundary>
                    
                    {/* Environment detection banner - shown on all steps */}
                    <div style={{
                        marginBottom: '15px',
                        padding: '10px 15px',
                        backgroundColor: oauthIsLocalMachine === null ? '#e7f3ff' : (oauthIsLocalMachine ? '#d4edda' : '#fff3cd'),
                        border: `1px solid ${oauthIsLocalMachine === null ? '#b3d9ff' : (oauthIsLocalMachine ? '#c3e6cb' : '#ffc107')}`,
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center'
                    }}>
                        <i className={`fa ${oauthIsLocalMachine === null ? 'fa-spinner fa-spin' : (oauthIsLocalMachine ? 'fa-desktop' : 'fa-globe')}`} 
                           style={{marginRight: '10px', color: oauthIsLocalMachine === null ? '#0066cc' : (oauthIsLocalMachine ? '#155724' : '#856404'), fontSize: '18px'}}></i>
                        <div>
                            <strong style={{color: oauthIsLocalMachine === null ? '#0066cc' : (oauthIsLocalMachine ? '#155724' : '#856404')}}>
                                {oauthIsLocalMachine === null ? 'Detecting Access Type...' : (oauthIsLocalMachine ? 'Local Access' : 'Remote Access')}
                            </strong>
                            <div style={{fontSize: '13px', color: oauthIsLocalMachine === null ? '#0066cc' : (oauthIsLocalMachine ? '#155724' : '#856404'), marginTop: '2px'}}>
                                {oauthIsLocalMachine === null 
                                    ? 'Determining if you are accessing from the same computer...'
                                    : oauthIsLocalMachine 
                                        ? 'You are accessing Rclone Director from the same computer where Rclone is running.'
                                        : 'You are accessing Rclone Director from a remote computer.'}
                            </div>
                        </div>
                    </div>
                    
                    <p>This 4 step process will guide you through creating a new remote.</p>
                    <this.StepShowCase currentStepNumber={currentStepNumber}/>
                    <Collapse isOpen={currentStepNumber === 1}>
                        <Card>
                            <CardBody>
                                <div className="clearfix mb-3">
                                    <div className="float-right">
                                        <Button className="btn-no-background" onClick={this.handleCancel}>Cancel</Button>
                                        <Button className="ml-3 btn-blue" onClick={this.gotoNextStep}>Next</Button>
                                    </div>
                                </div>
                                
                                <CustomInput label="Name of Remote (For your reference)"
                                             changeHandler={this.changeName} value={driveName}
                                             placeholder={"Enter a name"} name="name" id="driveName"
                                             isValid={driveNameIsValid}/>

                                {/* Import from Template Button */}
                                <FormGroup row>
                                    <Col sm={12}>
                                        <Button 
                                            color="success" 
                                            outline 
                                            onClick={this.toggleTemplateModal}
                                            style={{marginBottom: '15px'}}>
                                            <i className="fa fa-folder-open"></i> Import from Template...
                                        </Button>
                                        <small className="form-text text-muted" style={{marginTop: '-10px'}}>
                                            Import a pre-configured remote template to speed up setup
                                        </small>
                                    </Col>
                                </FormGroup>

                                <FormGroup row>
                                    <Label for="driveType" sm={5}>Select Remote Provider</Label>
                                    <Col sm={7}>
                                        <ProviderAutoSuggest suggestions={providers} value={drivePrefix || ""}
                                                             onChange={this.changeDriveType}
                                                             onClear={() => this.changeDriveType(undefined, {newValue: ""})}/>
                                    </Col>
                                </FormGroup>
                                <FormGroup row>
                                    <Col sm={3}>
                                        <Label for="inputDriveName">Docs are available at </Label>{' '}
                                        <a href="https://rclone.org/commands/rclone_config/" target="_blank" rel="noopener noreferrer">Rclone Config</a>
                                    </Col>
                                </FormGroup>
                            </CardBody>

                        </Card>
                    </Collapse>
                    <Collapse isOpen={currentStepNumber === 2}>
                        <Card>
                            {/*div for Scrolling to here*/}
                            {/* <div ref={(el) => this.setupDriveDiv = el}/> */}
                            <CardBody>
                                <div className="clearfix mb-3">
                                    <div className="float-right">
                                        <Button className="btn-no-background" onClick={this.handleCancel}>Cancel</Button>
                                        <Button className="ml-3 btn-no-background" onClick={this.gotoPrevStep}>Back</Button>
                                        <Button className="ml-3 btn-blue" onClick={this.gotoNextStep}>Next</Button>
                            </div>
                        </div>
                        
                        {/* OAuth authentication explanation for step 2 */}
                        {isOAuthRemote && currentStepNumber === 2 && (
                            <div style={{
                                marginBottom: '20px',
                                padding: '12px 15px',
                                backgroundColor: '#e7f3ff',
                                border: '1px solid #b3d9ff',
                                borderRadius: '4px',
                                fontSize: '14px'
                            }}>
                                <i className="fa fa-info-circle" style={{marginRight: '8px', color: '#0066cc'}}></i>
                                <strong>OAuth Authentication:</strong> You can authenticate using the button "Authenticate with...". 
                                {oauthIsLocalMachine === true ? (
                                    <span> Since you're using the browser on the same computer where Rclone runs, no additional setup is needed.</span>
                                ) : oauthIsLocalMachine === false ? (
                                    <span>
                                        {' '}Since you're accessing from a remote computer, you need either to authenticate using the text fields (Client ID and Client Secret) or install the{' '}
                                        <strong>
                                            <button
                                                type="button"
                                                onClick={this.toggleAuthHelperModal}
                                                style={{color: '#0066cc', textDecoration: 'underline', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 'bold'}}
                                            >
                                                Rclone Auth Helper App
                                            </button>
                                        </strong>{' '}
                                        on your local machine to catch the OAuth redirect.
                                    </span>
                                ) : (
                                    <span> You can authenticate using the button above or manually enter your Client ID and Client Secret in the text fields below.</span>
                                )}
                            </div>
                        )}
                        
                        {/* SharePoint / OneDrive location status row */}
                        {drivePrefix === 'onedrive' && currentStepNumber === 2 && this.state.oauthAuthenticated && (
                            <div style={{
                                marginBottom: '20px',
                                padding: '12px 15px',
                                backgroundColor: '#f8f9fa',
                                border: '1px solid #dee2e6',
                                borderRadius: '4px',
                                fontSize: '13px',
                                display: 'flex',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                gap: '8px'
                            }}>
                                <i className="fa fa-cloud" style={{color: '#0a82be'}}></i>
                                <span><strong>Connected to:</strong>{' '}
                                    {this.state.sharePointLocationLabel || (
                                        this.state.sharePointDiscoveryLoading
                                            ? <em style={{color: '#777'}}>discovering locations...</em>
                                            : (this.state.formValues.drive_type
                                                ? (this.state.formValues.drive_type === 'documentLibrary'
                                                    ? 'SharePoint document library'
                                                    : this.state.formValues.drive_type === 'business'
                                                        ? 'OneDrive for Business'
                                                        : 'Personal OneDrive')
                                                : <em style={{color: '#777'}}>auto-detected</em>)
                                    )}
                                </span>
                                <Button
                                    color="link"
                                    size="sm"
                                    style={{padding: '0', marginLeft: 'auto'}}
                                    onClick={this.openSharePointPicker}
                                    disabled={this.state.sharePointDiscoveryLoading}
                                >
                                    {this.state.sharePointDiscoveryLoading
                                        ? <><i className="fa fa-spinner fa-spin"/> Loading...</>
                                        : <>Choose different location...</>}
                                </Button>
                                {this.state.sharePointDiscoveryError && (
                                    <div style={{flexBasis: '100%', color: '#856404', fontSize: '12px', marginTop: '4px'}}>
                                        <i className="fa fa-exclamation-triangle"/>{' '}
                                        Could not load locations: {this.state.sharePointDiscoveryError}. Click "Choose different location..." to retry.
                                    </div>
                                )}
                            </div>
                        )}

                        {/* SSH Port Forwarding Info for localhost connections */}
                        {isOAuthRemote && currentStepNumber === 2 && oauthIsLocalMachine === true && (
                            <div style={{
                                marginBottom: '20px',
                                padding: '12px 15px',
                                backgroundColor: '#fff3cd',
                                border: '1px solid #ffc107',
                                borderRadius: '4px',
                                fontSize: '14px'
                            }}>
                                <i className="fa fa-terminal" style={{marginRight: '8px', color: '#856404'}}></i>
                                <strong>SSH Port Forwarding:</strong> If you're connecting to the server via SSH with localhost mapping, ensure the following ports are forwarded:
                                <ul style={{marginTop: '8px', marginBottom: '0', paddingLeft: '20px', fontSize: '13px'}}>
                                    <li><strong>Port 53682</strong> - OAuth callback (for Rclone Auth Helper)</li>
                                    <li><strong>Port 8450</strong> - Rclone Director backend</li>
                                    <li><strong>Port 5572</strong> - Rclone RCD (Remote Control)</li>
                                </ul>
                                <div style={{marginTop: '8px', fontSize: '13px', color: '#856404'}}>
                                    Example: <code style={{backgroundColor: '#f8f9fa', padding: '2px 6px', borderRadius: '3px'}}>ssh -L 53682:localhost:53682 -L 8450:localhost:8450 -L 5572:localhost:5572 user@server</code>
                                </div>
                            </div>
                        )}
                        
                        {drivePrefix === "local" && (
                            <p style={{marginBottom: "15px"}}>
                                <strong>You can skip these settings and they will be auto-configured.</strong> For auto config, leave the parameters as they are.
                            </p>
                        )}
                        
                        {drivePrefix === "s3" && !this.state.formValues.provider && (
                            <div style={{marginBottom: "15px", padding: "10px", backgroundColor: "#fff3cd", border: "1px solid #ffc107", borderRadius: "4px"}}>
                                <i className="fa fa-hand-o-right" style={{marginRight: "8px", color: "#856404"}}></i>
                                <strong>Please select your S3 provider from the dropdown above to continue.</strong>
                            </div>
                        )}
                        
                        {drivePrefix === "s3" && this.state.formValues.provider && (
                            <Row style={{marginBottom: "15px"}}>
                                <Col md={7}>
                                    <div style={{padding: "10px", backgroundColor: "#e7f3ff", border: "1px solid #b3d9ff", borderRadius: "4px", height: "100%"}}>
                                        <div 
                                            style={{cursor: "pointer", display: "flex", alignItems: "center"}} 
                                            onClick={() => this.setState(prev => ({providerHelpExpanded: !prev.providerHelpExpanded}))}
                                        >
                                            <i className={`fa fa-chevron-${this.state.providerHelpExpanded ? 'down' : 'right'}`} style={{marginRight: "8px", color: "#0066cc", fontSize: "12px", width: "12px"}}></i>
                                            <i className="fa fa-info-circle" style={{marginRight: "8px", color: "#0066cc"}}></i>
                                            <strong>{this.state.formValues.provider === "AWS" ? "AWS S3" : "S3-Compatible Storage"} - How to connect</strong>
                                        </div>
                                        {this.state.providerHelpExpanded && (
                                            <div style={{marginTop: "8px", fontSize: "13px"}}>
                                                {this.state.formValues.provider === "AWS" ? (
                                                    <>
                                                        <p style={{marginBottom: "6px"}}>In the AWS Console, go to <strong>IAM &rarr; Users &rarr; your user &rarr; Security credentials</strong>:</p>
                                                        <ol style={{paddingLeft: "20px", marginBottom: "6px"}}>
                                                            <li>Click <strong>Create access key</strong></li>
                                                            <li>Copy the <strong>Access Key ID</strong> &rarr; paste into the field below</li>
                                                            <li>Copy the <strong>Secret Access Key</strong> &rarr; paste into the field below</li>
                                                        </ol>
                                                        <p style={{marginBottom: "4px"}}><strong>Region:</strong> Select the region where your S3 buckets are (e.g., <code>eu-central-1</code> for Frankfurt)</p>
                                                        <p style={{marginBottom: "0", fontSize: "12px", color: "#555"}}>
                                                            <strong>Tip:</strong> Leave the Endpoint field empty for AWS - it's auto-configured from the region.
                                                        </p>
                                                    </>
                                                ) : (
                                                    <>
                                                        <p style={{marginBottom: "6px"}}>Find these 3 values in your provider's dashboard:</p>
                                                        <table style={{width: "100%", fontSize: "12px", borderCollapse: "collapse"}}>
                                                            <tbody>
                                                                <tr style={{borderBottom: "1px solid #ddd"}}>
                                                                    <td style={{padding: "4px 8px", fontWeight: "bold", whiteSpace: "nowrap"}}>Access Key ID</td>
                                                                    <td style={{padding: "4px 8px"}}>Your provider's access key</td>
                                                                </tr>
                                                                <tr style={{borderBottom: "1px solid #ddd"}}>
                                                                    <td style={{padding: "4px 8px", fontWeight: "bold", whiteSpace: "nowrap"}}>Secret Access Key</td>
                                                                    <td style={{padding: "4px 8px"}}>Your provider's secret key (shown once at creation)</td>
                                                                </tr>
                                                                <tr style={{borderBottom: "1px solid #ddd"}}>
                                                                    <td style={{padding: "4px 8px", fontWeight: "bold", whiteSpace: "nowrap"}}>Endpoint</td>
                                                                    <td style={{padding: "4px 8px"}}>e.g., <code>fsn1.your-objectstorage.com</code> (Hetzner) or <code>s3.us-east-1.wasabisys.com</code> (Wasabi)</td>
                                                                </tr>
                                                            </tbody>
                                                        </table>
                                                        <p style={{marginTop: "6px", marginBottom: "0", fontSize: "12px", color: "#555"}}>
                                                            <strong>Region:</strong> Can usually be left blank, or match your location code (e.g., <code>fsn1</code> for Hetzner Falkenstein).
                                                        </p>
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </Col>
                                <Col md={5}>
                                    <div style={{padding: "10px", backgroundColor: "#f8f9fa", border: "1px solid #dee2e6", borderRadius: "4px", height: "100%"}}>
                                        <strong><i className="fa fa-check-circle" style={{marginRight: "6px", color: "#28a745"}}></i>Test Connection</strong>
                                        <p style={{fontSize: "12px", color: "#666", marginTop: "8px", marginBottom: "10px"}}>
                                            Verify your credentials work before proceeding.
                                        </p>
                                        <Button 
                                            color="primary" 
                                            size="sm"
                                            onClick={this.testRemoteConnection} 
                                            disabled={this.state.testingConnection || !this.state.formValues.access_key_id || !this.state.formValues.secret_access_key || (this.state.formValues.provider !== "AWS" && !this.state.formValues.endpoint)}
                                            style={{width: "100%"}}>
                                            {this.state.testingConnection ? (
                                                <><i className="fa fa-spinner fa-spin"/> Testing...</>
                                            ) : (
                                                <><i className="fa fa-plug"/> Test Config</>
                                            )}
                                        </Button>
                                        {this.state.testResults.tested && (() => {
                                            const {connectionTest, readTest, writeTest, error} = this.state.testResults;
                                            const isWriteOnlyFailure = connectionTest === true && readTest === true && writeTest === false;
                                            return (
                                                <div style={{marginTop: "10px", fontSize: "12px"}}>
                                                    {connectionTest === true && (
                                                        <div className="text-success"><i className="fa fa-check-circle"/> Connection OK</div>
                                                    )}
                                                    {connectionTest === false && (
                                                        <div className="text-danger"><i className="fa fa-times-circle"/> Connection failed</div>
                                                    )}
                                                    {error && (
                                                        <div
                                                            className={isWriteOnlyFailure ? "text-warning" : "text-danger"}
                                                            style={{marginTop: "5px", fontSize: "11px"}}
                                                        >
                                                            {isWriteOnlyFailure
                                                                ? <>Write access is not allowed (read-only credentials). Details: {error}</>
                                                                : error}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </Col>
                            </Row>
                        )}
                        
                        {drivePrefix === "azureblob" && (
                            <Row style={{marginBottom: "15px"}}>
                                <Col md={7}>
                                    <div style={{padding: "10px", backgroundColor: "#e7f3ff", border: "1px solid #b3d9ff", borderRadius: "4px", height: "100%"}}>
                                        <div 
                                            style={{cursor: "pointer", display: "flex", alignItems: "center"}} 
                                            onClick={() => this.setState(prev => ({providerHelpExpanded: !prev.providerHelpExpanded}))}
                                        >
                                            <i className={`fa fa-chevron-${this.state.providerHelpExpanded ? 'down' : 'right'}`} style={{marginRight: "8px", color: "#0066cc", fontSize: "12px", width: "12px"}}></i>
                                            <i className="fa fa-info-circle" style={{marginRight: "8px", color: "#0066cc"}}></i>
                                            <strong>Azure Blob Storage - How to connect</strong>
                                        </div>
                                        {this.state.providerHelpExpanded && (
                                            <div style={{marginTop: "8px", fontSize: "13px"}}>
                                                <p style={{marginBottom: "8px", fontWeight: "bold"}}>Choose one of these two methods:</p>

                                                <div style={{padding: "8px 10px", backgroundColor: "#d4edda", border: "1px solid #c3e6cb", borderRadius: "4px", marginBottom: "8px"}}>
                                                    <strong style={{color: "#155724"}}>Method 1: Account + Key (easiest, full access)</strong>
                                                    <div style={{fontSize: "12px", marginTop: "4px"}}>
                                                        In Azure Portal &rarr; your Storage Account &rarr; <strong>Access keys</strong>:
                                                        <ol style={{paddingLeft: "20px", marginBottom: "0", marginTop: "4px"}}>
                                                            <li><strong>Account</strong> field &rarr; your account name (e.g., <code>martintest3</code>)</li>
                                                            <li><strong>Key</strong> field &rarr; copy <strong>key1</strong> (the long base64 string, not the connection string!)</li>
                                                        </ol>
                                                        <div style={{marginTop: "4px", color: "#555"}}>This gives full access. Leave "SAS URL" empty.</div>
                                                    </div>
                                                </div>

                                                <div style={{padding: "8px 10px", backgroundColor: "#f8f9fa", border: "1px solid #dee2e6", borderRadius: "4px", marginBottom: "8px"}}>
                                                    <strong>Method 2: SAS URL (time-limited access)</strong>
                                                    <div style={{fontSize: "12px", marginTop: "4px"}}>
                                                        In Azure Portal &rarr; your Storage Account &rarr; <strong>Shared access signature</strong> &rarr; Generate SAS. Azure shows 3 values:
                                                        <table style={{width: "100%", fontSize: "12px", borderCollapse: "collapse", marginTop: "4px"}}>
                                                            <tbody>
                                                                <tr style={{borderBottom: "1px solid #ddd"}}>
                                                                    <td style={{padding: "3px 6px", color: "#999"}}>Connection string</td>
                                                                    <td style={{padding: "3px 6px", color: "#999"}}>&#10060; ignore (you can paste it here though - we auto-detect it)</td>
                                                                </tr>
                                                                <tr style={{borderBottom: "1px solid #ddd"}}>
                                                                    <td style={{padding: "3px 6px", color: "#999"}}>SAS token</td>
                                                                    <td style={{padding: "3px 6px", color: "#999"}}>&#10060; ignore</td>
                                                                </tr>
                                                                <tr style={{backgroundColor: "#d4edda"}}>
                                                                    <td style={{padding: "3px 6px", fontWeight: "bold"}}>Blob service SAS URL</td>
                                                                    <td style={{padding: "3px 6px"}}>&#10004; paste into <strong>"SAS URL"</strong> below</td>
                                                                </tr>
                                                            </tbody>
                                                        </table>
                                                        <div style={{marginTop: "4px", color: "#555"}}>Leave "Account" and "Key" empty. SAS expires on the date you set.</div>
                                                    </div>
                                                </div>

                                                <div style={{padding: "8px 10px", backgroundColor: "#fff3cd", border: "1px solid #ffc107", borderRadius: "4px"}}>
                                                    <strong style={{color: "#856404"}}><i className="fa fa-exclamation-triangle" style={{marginRight: "4px"}}></i>SAS Permissions - Important!</strong>
                                                    <div style={{fontSize: "12px", marginTop: "4px", color: "#856404"}}>
                                                        When generating the SAS, under <strong>Allowed resource types</strong> make sure to check <strong>all three</strong>:
                                                        <ul style={{paddingLeft: "20px", marginBottom: "0", marginTop: "4px"}}>
                                                            <li>&#9745; Service</li>
                                                            <li>&#9745; Container</li>
                                                            <li>&#9745; <strong>Object</strong> &larr; often missed! Required to list and access files</li>
                                                        </ul>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </Col>
                                <Col md={5}>
                                    <div style={{padding: "10px", backgroundColor: "#f8f9fa", border: "1px solid #dee2e6", borderRadius: "4px", height: "100%"}}>
                                        <strong><i className="fa fa-check-circle" style={{marginRight: "6px", color: "#28a745"}}></i>Test Connection</strong>
                                        <p style={{fontSize: "12px", color: "#666", marginTop: "8px", marginBottom: "10px"}}>
                                            Verify your credentials work before proceeding.
                                        </p>
                                        <Button 
                                            color="primary" 
                                            size="sm"
                                            onClick={this.testRemoteConnection} 
                                            disabled={this.state.testingConnection || (!this.state.formValues.account && !this.state.formValues.sas_url)}
                                            style={{width: "100%"}}>
                                            {this.state.testingConnection ? (
                                                <><i className="fa fa-spinner fa-spin"/> Testing...</>
                                            ) : (
                                                <><i className="fa fa-plug"/> Test Config</>
                                            )}
                                        </Button>
                                        {this.state.testResults.tested && (() => {
                                            const {connectionTest, readTest, writeTest, error} = this.state.testResults;
                                            const isWriteOnlyFailure = connectionTest === true && readTest === true && writeTest === false;
                                            return (
                                                <div style={{marginTop: "10px", fontSize: "12px"}}>
                                                    {connectionTest === true && (
                                                        <div className="text-success"><i className="fa fa-check-circle"/> Connection OK</div>
                                                    )}
                                                    {connectionTest === false && (
                                                        <div className="text-danger"><i className="fa fa-times-circle"/> Connection failed</div>
                                                    )}
                                                    {error && (
                                                        <div
                                                            className={isWriteOnlyFailure ? "text-warning" : "text-danger"}
                                                            style={{marginTop: "5px", fontSize: "11px"}}
                                                        >
                                                            {isWriteOnlyFailure
                                                                ? <>Write access is not allowed (read-only credentials). Details: {error}</>
                                                                : error}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })()}
                                    </div>
                                </Col>
                            </Row>
                        )}
                        
                        <DriveParameters drivePrefix={drivePrefix} loadAdvanced={false}
                                                 changeHandler={this.handleInputChange}
                                                 errorsMap={this.state.formErrors}
                                                 isValidMap={this.state.isValid}
                                                 currentValues={this.state.formValues} 
                                                 config={providers}
                                                 onOAuthAuthenticate={this.handleOAuthAuthenticate}
                                                 oauthAuthenticating={this.state.oauthAuthenticating}
                                                 oauthAccountInfo={this.state.oauthAccountInfo}
                                                 oauthAuthenticated={this.state.oauthAuthenticated}
                                                 onRevokeAuth={this.handleRevokeAuth}
                                                 oauthIsLocalMachine={this.state.oauthIsLocalMachine}
                                                 onTestLocalApp={this.testLocalAppConnection}
                                                 oauthStatusMessages={this.state.oauthStatusMessages}
                                                 onOpenAuthHelper={this.toggleAuthHelperModal}
                                                 testingAuthHelper={this.state.testingAuthHelper}
                                                 showManualTokenEntry={this.state.showManualTokenEntry}
                                                 manualTokenInput={this.state.manualTokenInput}
                                                 onToggleManualToken={this.toggleManualTokenEntry}
                                                 onManualTokenChange={(e) => this.setState({ manualTokenInput: e.target.value })}
                                                 onManualTokenSubmit={this.handleManualTokenSubmit}/>
                            </CardBody>
                        </Card>
                    </Collapse>
                    <Collapse isOpen={currentStepNumber === 3}>
                        <Card>
                            <CardBody>
                                <div className="clearfix mb-3">
                                    <div className="float-right">
                                        <Button className="btn-no-background" onClick={this.handleCancel}>Cancel</Button>
                                        <Button className="ml-3 btn-no-background" onClick={this.gotoPrevStep}>Back</Button>
                                        <Button className="ml-3 btn-blue" onClick={this.gotoNextStep}>Next</Button>
                                    </div>
                                </div>
                                
                                {/* Encryption block */}
                                <div className="mb-3" style={{padding: "15px", border: "5px solid rgb(10, 130, 190)", borderRadius: "14px"}}>
                                    <div className="form-check">
                                        <input
                                            className="form-check-input"
                                            type="checkbox"
                                            id="addEncryption"
                                            checked={this.state.addEncryption}
                                            onChange={e => this.setState({addEncryption: e.target.checked})}
                                        />
                                        <label className="form-check-label" htmlFor="addEncryption">
                                            <strong>Add Encryption</strong>
                                        </label>
                                    </div>

                                    {this.state.addEncryption && (
                                        <div className="mt-3">
                                            <span className="text-danger" style={{fontSize: "0.9rem"}}>
                                                Please be aware that if you lose the password you will not be able to access your files!
                                                Once you have set the password, you should not change it again as this will bring inconsistency in your files.
                                            </span>
                                            <FormGroup row>
                                                <Label sm={5}><strong>File encryption password</strong></Label>
                                                <Col sm={7}>
                                                    <Input type="password" value={this.state.encPassword}
                                                           onChange={e => this.setState({encPassword: e.target.value})}
                                                           placeholder="Enter password"/>
                                                    <Input className="mt-2" type="password" value={this.state.encPasswordRepeat}
                                                           onChange={e => this.setState({encPasswordRepeat: e.target.value})}
                                                           placeholder="Repeat password"/>
                                                </Col>
                                            </FormGroup>

                                            <div className="form-check mt-2">
                                                <input
                                                    className="form-check-input"
                                                    type="checkbox"
                                                    id="useFilenamePassword"
                                                    checked={this.state.useFilenamePassword}
                                                    onChange={e => this.setState({useFilenamePassword: e.target.checked})}
                                                />
                                                <label className="form-check-label" htmlFor="useFilenamePassword">
                                                    Optional: separate password for filenames
                                                </label>
                                            </div>

                                            {this.state.useFilenamePassword && (
                                                <FormGroup row className="mt-2">
                                                    <Label sm={5}><strong>Filename password</strong></Label>
                                                    <Col sm={7}>
                                                        <Input type="password" value={this.state.encPassword2}
                                                               onChange={e => this.setState({encPassword2: e.target.value})}
                                                               placeholder="Enter filename password"/>
                                                        <Input className="mt-2" type="password" value={this.state.encPassword2Repeat}
                                                               onChange={e => this.setState({encPassword2Repeat: e.target.value})}
                                                               placeholder="Repeat filename password"/>
                                                    </Col>
                                                </FormGroup>
                                            )}

                                            <div className="text-muted" style={{fontSize: "0.9rem"}}>
                                                We will create the provider remote internally and wrap it with a Crypt remote using
                                                Standard filename encryption and encrypted directory names.
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div style={{padding: "12px 15px", marginBottom: "15px", backgroundColor: "#d4edda", border: "1px solid #c3e6cb", borderRadius: "6px"}}>
                                    <i className="fa fa-forward" style={{marginRight: "8px", color: "#155724"}}></i>
                                    <strong style={{color: "#155724"}}>You can skip this step!</strong>
                                    <p style={{marginTop: "6px", marginBottom: "0", fontSize: "13px", color: "#155724"}}>
                                        These are expert-level settings that most users don't need to change. 
                                        Click <strong>Next</strong> to proceed with the defaults. Only modify these if you know what you're doing.
                                    </p>
                                </div>
                                
                                <DriveParameters drivePrefix={drivePrefix} loadAdvanced={true}
                                                 changeHandler={this.handleInputChange}
                                                 errorsMap={this.state.formErrors}
                                                 isValidMap={this.state.isValid}
                                                 currentValues={this.state.formValues} 
                                                 config={providers}
                                                 onOAuthAuthenticate={this.handleOAuthAuthenticate}
                                                 oauthAuthenticating={this.state.oauthAuthenticating}
                                                 oauthStatusMessages={this.state.oauthStatusMessages}
                                                 testingAuthHelper={this.state.testingAuthHelper}/>
                            </CardBody>
                        </Card>
                    </Collapse>
                    <Collapse isOpen={currentStepNumber === 4}>
                        <Card>
                            <CardBody>
                                <div className="clearfix mb-3">
                                    <div className="float-right">
                                        <Button className="btn-no-background" onClick={this.handleCancel}>Cancel</Button>
                                        <Button className="ml-3 btn-no-background" onClick={this.gotoPrevStep}>Back</Button>
                                        <Button 
                                            className="ml-3 btn-blue" 
                                            onClick={this.gotoNextStep}
                                            disabled={this.state.saving}
                                        >
                                            {this.state.saving ? (
                                                <>
                                                    <i className="fa fa-spinner fa-spin" style={{marginRight: '5px'}}></i>
                                                    Saving...
                                                </>
                                            ) : (
                                                'Save & Finish'
                                            )}
                                        </Button>
                                    </div>
                                </div>
                                
                                <Alert color="info" style={{ fontSize: '13px', marginBottom: '20px' }}>
                                    <i className="fa fa-info-circle"></i> <strong>Configuration Changes</strong>
                                    <p style={{ marginTop: '8px', marginBottom: 0 }}>
                                        ✅ Changes made via this wizard are <strong>applied immediately</strong> when you click "Save & Finish" - no restart required!
                                    </p>
                                    <p style={{ marginTop: '5px', marginBottom: 0, fontSize: '12px', color: '#666' }}>
                                        <em>Note: Only manual edits to rclone.conf require a restart (Menu → Rclone Servers → ⟳ button)</em>
                                    </p>
                                </Alert>
                                
                                <h5 className="mb-3">Test Your Remote Configuration</h5>
                                <p>Test the remote connection before saving to ensure everything is configured correctly.</p>
                                
                                <div className="mb-4">
                                    <Button color="primary" onClick={this.testRemoteConnection} disabled={this.state.testingConnection}>
                                        {this.state.testingConnection ? (
                                            <><i className="fa fa-spinner fa-spin"/> Testing...</>
                                        ) : (
                                            <><i className="fa fa-check-circle"/> Test Remote Config</>
                                        )}
                                    </Button>
                                </div>
                                
                                {this.state.testResults.tested && (
                                    <div className="border rounded p-3" style={{backgroundColor: "#f8f9fa"}}>
                                        <h6><strong>Test Results:</strong></h6>
                                        <table className="table table-sm mb-0">
                                            <tbody>
                                                <tr>
                                                    <td width="30%"><strong>Connection</strong></td>
                                                    <td>
                                                        {this.state.testingConnection && <span className="text-info"><i className="fa fa-spinner fa-spin"/> Testing...</span>}
                                                        {!this.state.testingConnection && this.state.testResults.connectionTest === true && <span className="text-success"><i className="fa fa-check-circle"/> Success</span>}
                                                        {!this.state.testingConnection && this.state.testResults.connectionTest === false && <span className="text-danger"><i className="fa fa-times-circle"/> Failed</span>}
                                                        {!this.state.testingConnection && this.state.testResults.connectionTest === null && <span className="text-muted">Not tested</span>}
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td><strong>Read Test</strong></td>
                                                    <td>
                                                        {this.state.testResults.readTest === true && <span className="text-success"><i className="fa fa-check-circle"/> Success</span>}
                                                        {this.state.testResults.readTest === false && <span className="text-danger"><i className="fa fa-times-circle"/> Failed</span>}
                                                        {this.state.testResults.readTest === null && <span className="text-muted">Not tested</span>}
                                                    </td>
                                                </tr>
                                                <tr>
                                                    <td><strong>Write Test</strong></td>
                                                    <td>
                                                        {this.state.testResults.writeTest === true && <span className="text-success"><i className="fa fa-check-circle"/> Success</span>}
                                                        {this.state.testResults.writeTest === false && <span className="text-danger"><i className="fa fa-times-circle"/> Failed</span>}
                                                        {this.state.testResults.writeTest === null && <span className="text-muted">Not tested</span>}
                                                    </td>
                                                </tr>
                                                {this.state.testResults.error && (() => {
                                                    const {connectionTest, readTest, writeTest} = this.state.testResults;
                                                    // Write-only failure (connection + read OK) = read-only remote, not a hard failure
                                                    const isWriteOnlyFailure = connectionTest === true && readTest === true && writeTest === false;
                                                    const alertClass = isWriteOnlyFailure ? "alert alert-warning mb-0 mt-2" : "alert alert-danger mb-0 mt-2";
                                                    const heading = isWriteOnlyFailure
                                                        ? <span><strong>Connection works, but writing is not allowed.</strong> The remote appears to be read-only. This is fine for sync/mount sources; you just won't be able to upload or delete. Details:</span>
                                                        : <strong>Error:</strong>;
                                                    return (
                                                        <tr>
                                                            <td colSpan="2">
                                                                <div className={alertClass}>
                                                                    {heading}{' '}{this.state.testResults.error}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })()}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                                
                                <p className="text-muted mt-3">
                                    <small><i className="fa fa-info-circle"/> Testing is optional. You can skip this and save the remote directly.</small>
                                </p>
                            </CardBody>
                        </Card>
                    </Collapse>
                    {/* <div className="clearfix" ref={(el) => {
                            this.configEndDiv = el
                        }}>
                            <div className="float-right mb-3">
                                <Button color="info" type="reset" onClick={() => this.clearForm()}>Clear</Button>
                                <Button color="success" type="submit">Create Config</Button>

                            </div>
                        </div> */}
                    {/* Old authentication modal - disabled, using success modal instead */}
                    {/* <NewDriveAuthModal isVisible={this.state.authModalIsVisible} closeModal={this.toggleAuthModal}/> */}
                    
                    {/* Success Modal */}
                    <Modal isOpen={this.state.showSuccessModal} toggle={() => {}} backdrop="static" keyboard={false}>
                        <ModalHeader>
                            <i className="fa fa-check-circle text-success" style={{marginRight: '10px'}}></i>
                            Success
                        </ModalHeader>
                        <ModalBody>
                            <p>{this.state.successMessage}</p>
                            <Alert color="info" style={{ marginTop: '15px', marginBottom: 0, fontSize: '13px' }}>
                                <i className="fa fa-info-circle"></i> <strong>Configuration Applied</strong>
                                <p style={{ marginTop: '8px', marginBottom: 0 }}>
                                    ✅ Your remote configuration has been saved and is <strong>active immediately</strong> - no restart required!
                                </p>
                                <p style={{ marginTop: '8px', marginBottom: 0, fontSize: '12px', color: '#666' }}>
                                    <em>Note: Only manual edits to rclone.conf require a restart using Menu → Rclone Servers → ⟳ button</em>
                                </p>
                            </Alert>
                        </ModalBody>
                        <ModalFooter>
                            <Button color="primary" onClick={() => {
                                this.setState({ showSuccessModal: false });
                                // Redirect to Remotes page (showconfig route)
                                this.props.history.push('/showconfig');
                            }}>
                                OK
                            </Button>
                        </ModalFooter>
                    </Modal>
                    
                    {/* Template Selection Modal */}
                    <Modal isOpen={this.state.showTemplateModal} toggle={this.toggleTemplateModal} size="lg">
                        <ModalHeader toggle={this.toggleTemplateModal}>
                            <i className="fa fa-folder-open"></i> Import Remote Template
                        </ModalHeader>
                        <ModalBody>
                            {this.state.loadingTemplates ? (
                                <div className="text-center p-4">
                                    <i className="fa fa-spinner fa-spin fa-2x"></i>
                                    <p className="mt-2">Loading templates...</p>
                                </div>
                            ) : this.state.templates.length === 0 ? (
                                <div className="text-center p-4">
                                    <i className="fa fa-info-circle fa-2x" style={{color: '#73818f'}}></i>
                                    <p className="mt-2">No templates available.</p>
                                    <small className="text-muted">
                                        Create templates from existing remotes using the "Make Template" button in the Remotes page.
                                    </small>
                                </div>
                            ) : (
                                <>
                                    <p>Select a template to import its configuration:</p>
                                    <Table responsive hover className="table-striped">
                                        <thead>
                                            <tr>
                                                <th>Name</th>
                                                <th>Description</th>
                                                <th>Type</th>
                                                <th>Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {this.state.templates.map((template) => (
                                                <tr key={template.id}>
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
                                                    <td>
                                                        <Button 
                                                            color="primary" 
                                                            size="sm"
                                                            onClick={() => this.handleImportTemplate(template)}>
                                                            <i className="fa fa-download"></i> Import
                                                        </Button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </Table>
                                </>
                            )}
                        </ModalBody>
                        <ModalFooter>
                            <Button color="secondary" onClick={this.toggleTemplateModal}>Cancel</Button>
                        </ModalFooter>
                    </Modal>
                    
                    {/* SharePoint / OneDrive Location Picker */}
                    {drivePrefix === 'onedrive' && driveName && (
                        <SharePointLocationPicker
                            isOpen={this.state.showSharePointPicker}
                            sourceRemote={driveName}
                            mode="in-form"
                            onConfirm={this.handleSharePointConfirm}
                            onCancel={this.closeSharePointPicker}
                        />
                    )}

                    {/* Cancel Confirmation Modal */}
                    <ConfirmModal
                        isOpen={this.state.showCancelModal}
                        toggle={this.toggleCancelModal}
                        onConfirm={this.confirmCancel}
                        title="Cancel Remote Setup"
                        message={
                            <>
                                <p>Are you sure you want to cancel?</p>
                                <p className="text-warning mb-0">
                                    <i className="fa fa-exclamation-triangle"></i> Any unsaved changes will be lost.
                                </p>
                            </>
                        }
                        confirmText="Yes, Cancel"
                        cancelText="Continue Editing"
                        confirmColor="warning"
                        icon="fa-times-circle"
                    />
                    
                    {/* Revoke Authentication Confirmation Modal */}
                    <ConfirmModal
                        isOpen={this.state.showRevokeModal}
                        toggle={this.toggleRevokeModal}
                        onConfirm={this.confirmRevokeAuth}
                        title="Revoke Authentication"
                        message={
                            <>
                                <p>Are you sure you want to revoke authentication?</p>
                                <p className="text-danger mb-0">
                                    <i className="fa fa-exclamation-triangle"></i> This will delete the remote configuration and you will need to authenticate again.
                                </p>
                            </>
                        }
                        confirmText="Yes, Revoke"
                        cancelText="Cancel"
                        confirmColor="danger"
                        icon="fa-trash"
                        isLoading={this.state.revokingAuth}
                    />
                    
                    {/* OAuth Port Not Accessible Modal */}
                    <Modal isOpen={this.state.showOAuthPortModal} toggle={this.toggleOAuthPortModal} size="lg">
                        <ModalHeader toggle={this.toggleOAuthPortModal}>
                            <i className="fa fa-exclamation-triangle text-warning" style={{marginRight: '10px'}}></i>
                            OAuth Authentication Setup Required
                        </ModalHeader>
                        <ModalBody>
                            <div style={{marginBottom: '20px'}}>
                                <h5 style={{color: '#856404', marginBottom: '15px'}}>
                                    <i className="fa fa-info-circle" style={{marginRight: '8px'}}></i>
                                    Remote Access Detected
                                </h5>
                                <p>
                                    You are accessing Rclone Director from a <strong>remote computer</strong>. 
                                    OAuth authentication (like Microsoft, Google, Dropbox) requires a special setup 
                                    because the authentication callback needs to reach your local browser.
                                </p>
                            </div>
                            
                            <div style={{
                                backgroundColor: '#fff3cd', 
                                border: '1px solid #ffc107', 
                                borderRadius: '8px', 
                                padding: '20px',
                                marginBottom: '20px'
                            }}>
                                <h6 style={{color: '#856404', marginBottom: '15px'}}>
                                    <i className="fa fa-download" style={{marginRight: '8px'}}></i>
                                    Solution: Install Rclone Auth Helper
                                </h6>
                                <p style={{marginBottom: '15px'}}>
                                    <strong>Rclone Auth Helper</strong> is a small helper application that runs on your local 
                                    computer and catches the OAuth callback on port <code>53682</code>.
                                </p>
                                <ol style={{marginBottom: '15px', paddingLeft: '20px'}}>
                                    <li style={{marginBottom: '8px'}}>
                                        <button
                                           type="button"
                                           onClick={() => { this.toggleOAuthPortModal(); this.toggleAuthHelperModal(); }}
                                           style={{color: '#0066cc', fontWeight: 'bold', textDecoration: 'underline', background: 'none', border: 'none', padding: 0, cursor: 'pointer'}}>
                                            Download Rclone Auth Helper
                                        </button>
                                        <span style={{color: '#666', marginLeft: '8px'}}>
                                            (Windows, macOS, or Linux)
                                        </span>
                                    </li>
                                    <li style={{marginBottom: '8px'}}>
                                        Install and run Rclone Auth Helper on <strong>this computer</strong>
                                    </li>
                                    <li style={{marginBottom: '8px'}}>
                                        Click "Authenticate" again - it will now work!
                                    </li>
                                </ol>
                            </div>
                            
                            <div style={{
                                backgroundColor: '#d4edda', 
                                border: '1px solid #c3e6cb', 
                                borderRadius: '8px', 
                                padding: '20px',
                                marginBottom: '20px'
                            }}>
                                <h6 style={{color: '#155724', marginBottom: '15px'}}>
                                    <i className="fa fa-desktop" style={{marginRight: '8px'}}></i>
                                    Alternative: Use Local Access
                                </h6>
                                <p style={{marginBottom: '0'}}>
                                    If you can access Rclone Director from the <strong>same computer</strong> where 
                                    the Docker container or Rclone server is running, OAuth will work automatically 
                                    without any additional setup. Access via <code>http://localhost:3000</code> 
                                    or <code>http://127.0.0.1:3000</code>.
                                </p>
                            </div>
                            
                            <div style={{
                                backgroundColor: '#f8f9fa', 
                                border: '1px solid #dee2e6', 
                                borderRadius: '8px', 
                                padding: '15px'
                            }}>
                                <h6 style={{color: '#495057', marginBottom: '10px'}}>
                                    <i className="fa fa-question-circle" style={{marginRight: '8px'}}></i>
                                    Why is this needed?
                                </h6>
                                <p style={{fontSize: '13px', color: '#666', marginBottom: '0'}}>
                                    When you authenticate with Microsoft, Google, or other OAuth providers, they redirect 
                                    your browser to <code>http://localhost:53682</code> with an authorization code. 
                                    Since you're on a remote computer, this localhost address points to YOUR computer, 
                                    not the Rclone server. RcloneAuthApp listens on this port and forwards the code 
                                    to the remote Rclone Director.
                                </p>
                            </div>
                        </ModalBody>
                        <ModalFooter>
                            <Button color="secondary" onClick={this.toggleOAuthPortModal}>
                                Close
                            </Button>
                            <Button 
                                color="primary" 
                                onClick={() => {
                                    this.toggleOAuthPortModal();
                                    this.toggleAuthHelperModal();
                                }}
                            >
                                <i className="fa fa-download" style={{marginRight: '8px'}}></i>
                                Download RcloneAuthApp
                            </Button>
                        </ModalFooter>
                    </Modal>

                    {/* Auth Helper Download Modal */}
                    <Modal isOpen={this.state.showAuthHelperModal} toggle={this.toggleAuthHelperModal} size="lg">
                        <ModalHeader toggle={this.toggleAuthHelperModal}>
                            <i className="fa fa-download text-primary" style={{marginRight: '10px'}}></i>
                            Download Rclone Auth Helper
                        </ModalHeader>
                        <ModalBody>
                            <p style={{marginBottom: '20px'}}>
                                The <strong>Rclone Auth Helper</strong> enables OAuth authentication (Google Drive, OneDrive, Dropbox, etc.) 
                                when accessing Rclone Director remotely. Download and run it on your local machine before authenticating.
                            </p>
                            
                            <Table striped responsive>
                                <thead>
                                    <tr>
                                        <th>Platform</th>
                                        <th>Download</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(() => {
                                        const highlightStyle = {
                                            backgroundColor: '#e7f3ff',
                                            border: '3px solid #0066cc',
                                            fontWeight: 'bold'
                                        };
                                        return (
                                            <>
                                                <tr style={(this.isMatchingPlatform('windows-x64') || this.isMatchingPlatform('windows-arm64')) ? highlightStyle : {}}>
                                                    <td>
                                                        <i className="fa fa-windows" style={{marginRight: '8px', color: '#0078d4'}}></i>
                                                        Windows Installer (x64 & ARM64)
                                                        <div style={{fontSize: '0.85em', color: '#666', marginTop: '3px'}}>
                                                            165.79 MB • Setup wizard
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <a href="https://fsn1.your-objectstorage.com/speedbitspublic/rcloneauthhelper/Rclone.Auth.Helper.Setup.exe" 
                                                           target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-primary">
                                                            <i className="fa fa-download" style={{marginRight: '5px'}}></i>Download
                                                        </a>
                                                    </td>
                                                </tr>
                                                <tr style={(this.isMatchingPlatform('windows-x64') || this.isMatchingPlatform('windows-arm64')) ? highlightStyle : {}}>
                                                    <td>
                                                        <i className="fa fa-windows" style={{marginRight: '8px', color: '#0078d4'}}></i>
                                                        Windows Portable (x64 & ARM64)
                                                        <div style={{fontSize: '0.85em', color: '#666', marginTop: '3px'}}>
                                                            165.45 MB • No installation
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <a href="https://fsn1.your-objectstorage.com/speedbitspublic/rcloneauthhelper/Rclone.Auth.Helper-Portable.exe" 
                                                           target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-primary">
                                                            <i className="fa fa-download" style={{marginRight: '5px'}}></i>Download
                                                        </a>
                                                    </td>
                                                </tr>
                                                <tr style={this.isMatchingPlatform('macos-universal') ? highlightStyle : {}}>
                                                    <td>
                                                        <i className="fa fa-apple" style={{marginRight: '8px', color: '#555'}}></i>
                                                        macOS Universal
                                                        <div style={{fontSize: '0.85em', color: '#666', marginTop: '3px'}}>
                                                            185.32 MB • Intel & Apple Silicon
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <a href="https://fsn1.your-objectstorage.com/speedbitspublic/rcloneauthhelper/Rclone.Auth.Helper-universal.dmg" 
                                                           target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-primary">
                                                            <i className="fa fa-download" style={{marginRight: '5px'}}></i>Download
                                                        </a>
                                                    </td>
                                                </tr>
                                                <tr style={this.isMatchingPlatform('linux-x64') ? highlightStyle : {}}>
                                                    <td>
                                                        <i className="fa fa-linux" style={{marginRight: '8px', color: '#333'}}></i>
                                                        Linux x64
                                                        <div style={{fontSize: '0.85em', color: '#666', marginTop: '3px'}}>
                                                            107.09 MB • Portable archive
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <a href="https://fsn1.your-objectstorage.com/speedbitspublic/rcloneauthhelper/RcloneAuthApp-Linux-x64.tar.gz" 
                                                           target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-primary">
                                                            <i className="fa fa-download" style={{marginRight: '5px'}}></i>Download
                                                        </a>
                                                    </td>
                                                </tr>
                                                <tr style={this.isMatchingPlatform('linux-arm64') ? highlightStyle : {}}>
                                                    <td>
                                                        <i className="fa fa-linux" style={{marginRight: '8px', color: '#333'}}></i>
                                                        Linux ARM64
                                                        <div style={{fontSize: '0.85em', color: '#666', marginTop: '3px'}}>
                                                            107.23 MB • Portable archive
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <a href="https://fsn1.your-objectstorage.com/speedbitspublic/rcloneauthhelper/RcloneAuthApp-Linux-ARM64.tar.gz" 
                                                           target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-primary">
                                                            <i className="fa fa-download" style={{marginRight: '5px'}}></i>Download
                                                        </a>
                                                    </td>
                                                </tr>
                                            </>
                                        );
                                    })()}
                                </tbody>
                            </Table>

                            <div style={{marginTop: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '6px'}}>
                                <h6 style={{marginBottom: '10px'}}>
                                    <i className="fa fa-info-circle text-info" style={{marginRight: '8px'}}></i>
                                    How to use
                                </h6>
                                <ol style={{marginBottom: '0', paddingLeft: '20px', fontSize: '13px'}}>
                                    <li>Download and extract the app for your platform</li>
                                    <li>Run the Rclone Auth Helper on your local machine</li>
                                    <li>Return here and click "Authenticate" - the helper will catch the OAuth callback</li>
                                </ol>
                            </div>
                        </ModalBody>
                        <ModalFooter>
                            <Button color="secondary" onClick={this.toggleAuthHelperModal}>
                                Close
                            </Button>
                        </ModalFooter>
                    </Modal>
                </ErrorBoundary>
            </div>);
    }
}

// Attach extracted method groups to the class prototype
Object.assign(NewDrive.prototype, oauthHandlers);
Object.assign(NewDrive.prototype, formHandlers);
Object.assign(NewDrive.prototype, testConnectionHandlers);

const mapStateToProps = state => ({
    /**
     * The list of all providers.
     */
    providers: state.config.providers,
    version: state.version
});

NewDrive.propTypes = {
    providers: PropTypes.array.isRequired,
    getProviders: PropTypes.func.isRequired,
    isEdit: PropTypes.bool.isRequired,
    driveName: PropTypes.string
};

NewDrive.defaultProps = {
    isEdit: false,
};

export default withRouter(connect(mapStateToProps, {getProviders})(NewDrive));
