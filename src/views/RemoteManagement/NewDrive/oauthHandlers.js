import axiosInstance from "../../../utils/API/API";
import {findFromConfig, isEmpty, supportsOAuth} from "../../../utils/Tools";
import {toast} from "react-toastify";
import urls from "../../../utils/API/endpoint";
import {startOAuthFlow, checkOAuthStatus, getOAuthAccountInfo, revokeOAuth, sendTokenToLocalApp} from "../../../utils/API/director";

export async function handleOAuthAuthenticate() {
        const {driveName, drivePrefix, formValues, oauthPollInterval, oauthAuthenticating, oauthIsLocalMachine} = this.state;
        
        if (!driveName || !drivePrefix) {
            toast.error("Please enter a remote name and select a provider first");
            return;
        }
        
        // Prevent multiple simultaneous OAuth flows
        // Clear any stale intervals first (in case cleanup didn't happen properly)
        if (oauthPollInterval) {
            clearInterval(oauthPollInterval);
        }
        
        // Close any existing OAuth popup window
        if (this.oauthPopupWindow && !this.oauthPopupWindow.closed) {
            console.log('[OAuth] Closing existing OAuth popup');
            this.oauthPopupWindow.close();
            this.oauthPopupWindow = null;
        }
        
        if (oauthAuthenticating) {
            toast.warning("OAuth authentication already in progress. Please wait.");
            return;
        }
        
        // === PORT CHECK BEFORE OAUTH ===
        // For REMOTE users (not on the same machine as Director), we need to verify
        // that RcloneAuthApp is running on their local machine to catch the OAuth callback.
        // For LOCAL users (same machine), the port will be opened by rclone during OAuth.
        if (oauthIsLocalMachine === false) {
            console.log('[OAuth] Remote user detected - checking if RcloneAuthApp is running...');
            
            const portReady = await this.checkOAuthPortReady();
            
            if (!portReady) {
                console.log('[OAuth] Port 53682 not accessible - showing help modal');
                this.setState({ 
                    showOAuthPortModal: true,
                    oauthPortCheckFailed: true 
                });
                return; // Don't proceed with OAuth
            }
            
            console.log('[OAuth] RcloneAuthApp is running - proceeding with OAuth');
        } else if (oauthIsLocalMachine === true) {
            console.log('[OAuth] Local user - proceeding directly (port will be opened by rclone)');
        }
        
        // Clear any stale state and start fresh
        this.setState({ 
            oauthAuthenticating: true,
            oauthAttempts: 0,
            oauthAuthUrl: null,
            oauthPollInterval: null,
            oauthStatusMessages: [{ step: 'starting', message: 'Starting OAuth authentication...' }]
        });
        
        try {
            // Use Director's OAuth endpoint which handles Rclone communication
            const oauthParams = { ...formValues };
            
            // Remove empty client_id and client_secret to use Rclone defaults
            if (!oauthParams.client_id || oauthParams.client_id === '') {
                delete oauthParams.client_id;
            }
            if (!oauthParams.client_secret || oauthParams.client_secret === '') {
                delete oauthParams.client_secret;
            }
            
            // Get selected server ID if available
            const selectedServerId = sessionStorage.getItem('RCLONE_SERVER_ID');
            const serverId = selectedServerId && selectedServerId !== 'null' ? selectedServerId : null;
            
            console.log('[OAuth] Starting OAuth flow via Director API');
            console.log('[OAuth] Trying port 53682...');
            
            // Update status: checking port
            this.setState(prev => ({
                oauthStatusMessages: [...prev.oauthStatusMessages, { step: 'checking-port', message: 'Checking port 53682...' }]
            }));
            
            // Call Director's OAuth endpoint
            const oauthResponse = await startOAuthFlow(
                driveName,
                drivePrefix,
                oauthParams,
                serverId
            );
            
            console.log('[OAuth] Director response:', oauthResponse);
            
            // Update status messages from backend if provided
            if (oauthResponse.status_messages && Array.isArray(oauthResponse.status_messages)) {
                console.log('[OAuth] Status messages from backend:', oauthResponse.status_messages);
                this.setState(prev => ({
                    oauthStatusMessages: [...prev.oauthStatusMessages, ...oauthResponse.status_messages]
                }));
            }
            
            // If we got a callback_token, send it to the local RcloneAuthApp.
            //
            // For LOCAL users this is best-effort (the Director's own callback server
            // on port 53682 will catch the redirect). For REMOTE users this is the
            // ONLY way the OAuth callback can reach the Director, so a failure here
            // must abort the flow — otherwise the popup opens and the user gets a
            // confusing "RcloneAuthApp is not configured" page after authenticating.
            if (oauthResponse.callback_token) {
                try {
                    const serverUrl = this.getServerUrl();
                    console.log('[OAuth] Sending callback token to RcloneAuthApp:', { token: oauthResponse.callback_token.substring(0, 20) + '...', serverUrl });
                    await sendTokenToLocalApp(oauthResponse.callback_token, serverUrl);
                    console.log('[OAuth] Successfully sent token to RcloneAuthApp');
                } catch (error) {
                    console.warn('[OAuth] sendTokenToLocalApp failed:', error.message);

                    if (oauthIsLocalMachine === false) {
                        // Remote user: helper app is required. Abort and explain.
                        toast.error(
                            `Cannot configure RcloneAuthApp: ${error.message} ` +
                            `OAuth aborted — fix the helper app and try again.`,
                            { autoClose: 12000 }
                        );
                        this.setState({
                            oauthAuthenticating: false,
                            oauthPollInterval: null,
                            oauthAuthUrl: null,
                            oauthAttempts: 0,
                            oauthStatusMessages: []
                        });
                        return;
                    }
                    // Local user: keep going — Director's own :53682 listener will catch it.
                }
            }
            
            // Check if already authenticated
            if (oauthResponse.already_authenticated) {
                this.setState({ 
                    oauthAuthenticating: false,
                    oauthStatusMessages: []
                });
                toast.success("✅ Remote already authenticated! Loading configuration...");
                await this.loadRemoteConfig(driveName);
                return;
            }
            
            // Get auth URL from response
            const authUrl = oauthResponse.auth_url;
            
            if (authUrl) {
                // Validate auth URL before opening
                if (!authUrl.startsWith('http://') && !authUrl.startsWith('https://')) {
                    console.error('[OAuth] Invalid auth URL:', authUrl);
                    toast.error("Invalid OAuth URL received. Please try again.");
                    this.setState({ 
                        oauthAuthenticating: false,
                        oauthStatusMessages: []
                    });
                    return;
                }
                
                // Open auth URL in popup with unique window name to force new window
                const windowName = `rclone-oauth-${Date.now()}`;
                const popup = window.open(
                    authUrl,
                    windowName,
                    'width=600,height=700,scrollbars=yes,resizable=yes'
                );
                
                if (!popup || popup.closed || typeof popup.closed === 'undefined') {
                    toast.error("Popup blocked. Please allow popups and try again.");
                    this.setState({ 
                        oauthAuthenticating: false,
                        oauthStatusMessages: []
                    });
                    return;
                }
                
                // Store popup reference for cleanup
                this.oauthPopupWindow = popup;
                
                // Update status: ready to authenticate
                this.setState(prev => ({
                    oauthStatusMessages: [...prev.oauthStatusMessages, { step: 'ready', message: 'Opening authentication window...' }]
                }));
                
                // Security: Remove opener reference to prevent the popup from accessing the parent window
                // Modern browsers do this automatically for cross-origin URLs, but we set it explicitly for safety
                try {
                    popup.opener = null;
                } catch (e) {
                    // Ignore - some browsers may not allow this, but it's not critical
                }
                
                // Store auth URL and start polling
                this.setState({ oauthAuthUrl: authUrl });
                
                // Start polling to check if OAuth completed
                // Use Director's OAuth check endpoint instead of direct config/get
                const pollInterval = setInterval(() => {
                    // Check if component is still mounted before polling
                    if (this.state.oauthPollInterval === pollInterval) {
                        this.checkOAuthStatusViaDirector(pollInterval, driveName, serverId);
                    }
                }, 2000); // Poll every 2 seconds
                
                this.setState({ oauthPollInterval: pollInterval });
                
                toast.info("Please complete authentication in the popup window", {
                    autoClose: 10000
                });
            } else {
                // No auth_url returned
                this.setState({ 
                    oauthAuthenticating: false,
                    oauthStatusMessages: []
                });
                const errorMsg = oauthResponse.error || oauthResponse.details || 'OAuth flow not started';
                const suggestion = oauthResponse.suggestion || '';
                const port = oauthResponse.port;
                
                // Update status messages from error response if available
                if (oauthResponse.status_messages && Array.isArray(oauthResponse.status_messages)) {
                    console.log('[OAuth] Status messages from error response:', oauthResponse.status_messages);
                    this.setState(prev => ({
                        oauthStatusMessages: [...prev.oauthStatusMessages, ...oauthResponse.status_messages]
                    }));
                }
                
                // If it's a port conflict, offer to retry after cleanup
                if (errorMsg.includes('port conflict') || errorMsg.includes('already in use')) {
                    toast.error(
                        `OAuth port conflict: Port ${port || '53682'} is in use. The system will automatically retry...`, 
                        { autoClose: 5000 }
                    );
                    
                    // Auto-retry after a short delay (cleanup happens on backend)
                    setTimeout(() => {
                        if (this._isMounted && !this.state.oauthAuthenticating) {
                            console.log('[OAuth] Retrying after port conflict cleanup...');
                            this.handleOAuthAuthenticate();
                        }
                    }, 2000);
                } else {
                    toast.error(
                        `OAuth error: ${errorMsg}${suggestion ? ' ' + suggestion : ''}`
                    );
                }
                console.error('[OAuth] Failed to start OAuth flow:', oauthResponse);
            }
        } catch (error) {
            console.error('OAuth error:', error);
            const errorMsg = error.response?.data?.error || error.message || 'Unknown error';
            const details = error.response?.data?.details || '';
            const suggestion = error.response?.data?.suggestion || '';
            
            // Check if it's a port conflict (limit retries to prevent infinite loop)
            const isPortConflict = errorMsg.includes('port conflict') || errorMsg.includes('already in use');
            this._oauthRetryCount = (this._oauthRetryCount || 0) + 1;
            
            if (isPortConflict && this._oauthRetryCount <= 3) {
                toast.warn(
                    `OAuth port conflict detected. Retry ${this._oauthRetryCount}/3...`
                );
                
                setTimeout(() => {
                    if (this._isMounted && !this.state.oauthAuthenticating) {
                        this.handleOAuthAuthenticate();
                    }
                }, 2000);
            } else {
                this._oauthRetryCount = 0;
                toast.error(
                    `Failed to start OAuth: ${errorMsg}${details ? ' - ' + details : ''}${suggestion ? ' ' + suggestion : ''}`
                );
            }
            
            // Clean up on error
            if (this.state.oauthPollInterval) {
                clearInterval(this.state.oauthPollInterval);
            }
            this.setState({ 
                oauthAuthenticating: false,
                oauthPollInterval: null,
                oauthAuthUrl: null,
                oauthAttempts: 0,
                oauthStatusMessages: []
            });
        }
    }
    
    /**
     * Check if OAuth authentication completed by polling via Director API
     */
export async function checkOAuthStatusViaDirector(pollInterval, driveName, serverId) {
        // Check if component is still mounted
        if (!this._isMounted) {
            clearInterval(pollInterval);
            return;
        }
        
        // Verify this is still the active polling interval
        if (this.state.oauthPollInterval !== pollInterval) {
            // This interval is stale, don't proceed
            clearInterval(pollInterval);
            return;
        }
        
        const {oauthAttempts} = this.state;
        const maxAttempts = 30; // 1 minute max (30 * 2 seconds) - reduced from 150 for better UX
        const attempts = (oauthAttempts || 0) + 1;
        
        // Update attempts counter immediately to prevent race conditions
        // Only if component is still mounted
        if (this._isMounted) {
            this.setState({ oauthAttempts: attempts });
        }
        
        try {
            // Use Director's OAuth check endpoint
            const statusResponse = await checkOAuthStatus(driveName, serverId);
            
            if (statusResponse.success && statusResponse.authenticated) {
                // OAuth completed successfully!
                clearInterval(pollInterval);
                
                // Close the OAuth popup window
                if (this.oauthPopupWindow && !this.oauthPopupWindow.closed) {
                    console.log('[OAuth] Closing OAuth popup after successful authentication');
                    this.oauthPopupWindow.close();
                    this.oauthPopupWindow = null;
                }
                
                if (this._isMounted) {
                    this.setState({
                        oauthPollInterval: null,
                        oauthAuthenticating: false,
                        oauthAuthUrl: null,
                        oauthAttempts: 0,
                        oauthStatusMessages: []
                    });
                    
                    toast.success("✅ OAuth authentication successful!");
                    
                    // Load the created config into the form
                    await this.loadRemoteConfig(driveName);
                }
            } else {
                // Still waiting...
                if (attempts >= maxAttempts) {
                    clearInterval(pollInterval);
                    
                    // Close the OAuth popup window on timeout
                    if (this.oauthPopupWindow && !this.oauthPopupWindow.closed) {
                        console.log('[OAuth] Closing OAuth popup after timeout');
                        this.oauthPopupWindow.close();
                        this.oauthPopupWindow = null;
                    }
                    
                    if (this._isMounted) {
                        this.setState({
                            oauthPollInterval: null,
                            oauthAuthenticating: false,
                            oauthAuthUrl: null,
                            oauthAttempts: 0,
                            oauthStatusMessages: []
                        });
                        toast.error("OAuth authentication timed out. Please try again.");
                    }
                }
            }
        } catch (error) {
            // Error checking status - continue polling unless timed out
            if (attempts >= maxAttempts) {
                clearInterval(pollInterval);
                
                // Close the OAuth popup window on error timeout
                if (this.oauthPopupWindow && !this.oauthPopupWindow.closed) {
                    console.log('[OAuth] Closing OAuth popup after error timeout');
                    this.oauthPopupWindow.close();
                    this.oauthPopupWindow = null;
                }
                
                if (this._isMounted) {
                    this.setState({
                        oauthPollInterval: null,
                        oauthAuthenticating: false,
                        oauthAuthUrl: null,
                        oauthAttempts: 0
                    });
                    toast.error("OAuth authentication timed out. Please try again.");
                }
            }
            // Otherwise, continue polling (error is expected if config doesn't exist yet)
        }
    }
    
    /**
     * Load remote configuration into form after OAuth success
     */
export async function loadRemoteConfig(remoteName) {
        // Check if component is still mounted before updating state
        if (!this._isMounted) {
            return;
        }
        
        try {
            const res = await axiosInstance.post(urls.getConfigForRemote, {name: remoteName});
            if (res.data && !isEmpty(res.data)) {
                const config = res.data;
                const {providers} = this.props;
                
                // Get option types and required flags
                const currentConfig = findFromConfig(providers, config.type);
                const optionTypes = {};
                const required = {};
                const availableOptions = {};
                
                if (currentConfig) {
                    currentConfig.Options.forEach(item => {
                        if (item.Hide === 0) {
                            availableOptions[item.Name] = item.DefaultStr || '';
                            optionTypes[item.Name] = item.Type;
                            required[item.Name] = item.Required;
                        }
                    });
                }
                
                // Merge config parameters with defaults
                const mergedFormValues = { ...availableOptions, ...config.parameters };
                
                // Validate the merged values
                const validation = this.validateFormValues(mergedFormValues, optionTypes, required);
                
                // Only update state if component is still mounted
                if (this._isMounted) {
                    this.setState({
                        formValues: mergedFormValues,
                        isValid: validation.isValid,
                        formErrors: validation.errors,
                        formValuesValid: validation.isValid,
                        optionTypes: optionTypes,
                        required: required
                    });
                }
                
                // Check OAuth status and fetch account info if authenticated
                await this.checkOAuthStatusAndAccountInfo(remoteName);

                // For OneDrive remotes that just completed OAuth, kick off
                // SharePoint location discovery in the background. If the user
                // can see >=1 SharePoint sites the picker auto-opens so they
                // can switch from the auto-picked personal drive to the
                // SharePoint library they actually want. Personal-only
                // accounts see no modal.
                if (config.type === 'onedrive' && typeof this.triggerSharePointDiscovery === 'function') {
                    this.triggerSharePointDiscovery({ autoOpen: true });
                }
            }
        } catch (error) {
            console.error('Error loading remote config:', error);
            if (this._isMounted) {
                toast.error("Failed to load remote configuration");
            }
        }
    }
    
    /**
     * Detect if browser is on same machine as server
     */
export async function detectOAuthEnvironment() {
        try {
            // IMPORTANT: Detection is based on where the Director UI is accessed from (browser URL),
            // NOT on where the RCD server is located!
            // 
            // Why? Because OAuth callback goes to the Director (port 3000), not RCD (port 5572).
            // If browser is on localhost → Director receives callback directly (no RcloneAuthApp needed)
            // If browser is remote → Director can't receive callback (RcloneAuthApp needed)
            
            const hostname = window.location.hostname;
            const isLocalhost = hostname === 'localhost' || 
                              hostname === '127.0.0.1' ||
                              hostname.startsWith('127.') ||
                              hostname === '[::1]';
            
            if (isLocalhost) {
                console.log('[OAuth] Browser is on localhost - OAuth callback will work directly (no RcloneAuthApp needed)');
                this.setState({ oauthIsLocalMachine: true });
                return true;
            } else {
                console.log(`[OAuth] Browser is on ${hostname} (remote) - RcloneAuthApp needed for OAuth callback`);
                this.setState({ oauthIsLocalMachine: false });
                return false;
            }
        } catch (error) {
            console.error('[OAuth] Error detecting environment:', error);
            // Default to false (remote) on error
            this.setState({ oauthIsLocalMachine: false });
            return false;
        }
    }
    
    /**
     * Check if OAuth port (53682) is ready/accessible from the browser.
     * This checks if RcloneAuthApp is running on the user's local machine.
     * @returns {Promise<boolean>} True if port is accessible, false otherwise
     */
export async function checkOAuthPortReady() {
        console.log('[OAuth] Checking if port 53682 is accessible...');
        
        try {
            // Try to ping RcloneAuthApp's test endpoint
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout
            
            const response = await fetch('http://localhost:53682/api/test', {
                method: 'GET',
                signal: controller.signal,
                mode: 'cors'
            });
            
            clearTimeout(timeoutId);
            
            if (response.ok) {
                console.log('[OAuth] Port 53682 is accessible - RcloneAuthApp is running');
                return true;
            } else {
                console.log('[OAuth] Port 53682 responded but with error:', response.status);
                return false;
            }
        } catch (error) {
            // Network error means nothing is listening on the port
            console.log('[OAuth] Port 53682 is not accessible:', error.message);
            return false;
        }
    }
    
    /**
     * Toggle OAuth port error modal
     */
export function toggleOAuthPortModal() {
        this.setState(prev => ({ showOAuthPortModal: !prev.showOAuthPortModal }));
    }

    /**
     * Toggle Auth Helper download modal
     */
export function toggleAuthHelperModal() {
        this.setState(prev => ({ showAuthHelperModal: !prev.showAuthHelperModal }));
    }

    /**
     * Check if a platform matches the detected system
     */
export function isMatchingPlatform(platform) {
        const { detectedSystem } = this.state;
        const { os, arch } = detectedSystem;
        
        // macOS Universal matches all macOS systems
        if (platform === 'macos-universal' && os === 'macos') {
            return true;
        }
        
        // Check exact match
        const platformParts = platform.split('-');
        const platformOS = platformParts[0];
        const platformArch = platformParts[1];
        
        if (platformOS !== os) {
            return false;
        }
        
        // For Windows: Highlight both x64 and ARM64 (Firefox on Windows ARM is unreliable)
        if (os === 'windows') {
            // Only highlight ARM64 if we have high confidence it's ARM
            const ua = navigator.userAgent;
            const hasConfidentARM = /ARM64|Windows.*ARM64/i.test(ua) || 
                                     (navigator.userAgentData && navigator.userAgentData.platform && 
                                      navigator.userAgentData.platform.toLowerCase().includes('arm'));
            
            if (hasConfidentARM && arch === 'arm64') {
                return platformArch === 'arm64';
            }
            
            // Otherwise, highlight both Windows options
            return platformArch === 'x64' || platformArch === 'arm64';
        }
        
        // For Linux, check architecture
        if (os === 'linux') {
            return platformArch === arch || (platformArch === 'x64' && arch !== 'arm64');
        }
        
        return false;
    }
    
    /**
     * Check OAuth status when entering step 2
     */
export async function checkOAuthStatusOnStep2() {
        const {driveName, drivePrefix} = this.state;
        console.log('[OAuth] checkOAuthStatusOnStep2 called', { driveName, drivePrefix });
        
        if (!driveName || !drivePrefix) {
            console.log('[OAuth] Skipping check - missing driveName or drivePrefix', {
                driveName: driveName || 'MISSING',
                drivePrefix: drivePrefix || 'MISSING'
            });
            return;
        }
        
        // Check if this is an OAuth remote
        const {providers} = this.props;
        if (!providers || providers.length === 0) {
            console.log('[OAuth] Providers not loaded yet, skipping check');
            return;
        }
        
        const isOAuthRemote = supportsOAuth(providers, drivePrefix);
        console.log('[OAuth] Is OAuth remote?', isOAuthRemote, 'for prefix:', drivePrefix);
        
        if (!isOAuthRemote) {
            console.log('[OAuth] Skipping check - not an OAuth remote');
            return;
        }
        
        // Detect environment if not already detected
        if (this.state.oauthIsLocalMachine === null) {
            await this.detectOAuthEnvironment();
        }
        
        console.log('[OAuth] Starting OAuth status check for:', driveName);
        await this.checkOAuthStatusAndAccountInfo(driveName);
    }
    
    /**
     * Check OAuth status and fetch account info if authenticated
     */
export async function checkOAuthStatusAndAccountInfo(remoteName, remoteType = null) {
        if (!this._isMounted) {
            console.log('[OAuth] Component not mounted, skipping check');
            return;
        }
        
        console.log('[OAuth] Checking OAuth status for remote:', remoteName, 'type:', remoteType || 'unknown');
        
        try {
            const selectedServerId = sessionStorage.getItem('RCLONE_SERVER_ID');
            const serverId = selectedServerId && selectedServerId !== 'null' ? selectedServerId : null;
            console.log('[OAuth] Using serverId:', serverId);
            
            const statusResponse = await checkOAuthStatus(remoteName, serverId);
            console.log('[OAuth] Status response:', statusResponse);
            
            if (statusResponse.success && statusResponse.authenticated) {
                console.log('[OAuth] Remote is authenticated, fetching account info...');
                this.setState({ oauthAuthenticated: true });
                
                // Try to fetch account info
                try {
                    const accountResponse = await getOAuthAccountInfo(remoteName, serverId);
                    console.log('[OAuth] Account info response:', accountResponse);
                    if (accountResponse && accountResponse.success) {
                        this.setState({ oauthAccountInfo: accountResponse.account });
                        console.log('[OAuth] Account info set:', accountResponse.account);
                    } else {
                        console.log('[OAuth] Account info response not successful:', accountResponse);
                    }
                } catch (error) {
                    console.log('[OAuth] Could not fetch account info:', error.message);
                    console.error('[OAuth] Account info error details:', error);
                    // Not critical, continue without account info
                }
            } else {
                console.log('[OAuth] Remote is not authenticated', statusResponse);
                
                // Check if there's an RCD error (500) which might indicate invalid config
                const rcdError = statusResponse.rcdError;
                if (rcdError) {
                    console.warn('[OAuth] RCD error detected:', rcdError);
                    toast.warning(`⚠️ Unable to verify authentication. ${rcdError}`, { autoClose: 8000 });
                }
                
                this.setState({ 
                    oauthAuthenticated: false,
                    oauthAccountInfo: null
                });
            }
        } catch (error) {
            console.error('[OAuth] Error checking status:', error);
            console.error('[OAuth] Error details:', error.response || error.message);
            
            // If it's a 500 error, it might be an RCD issue
            if (error.response?.status === 500) {
                toast.error('⚠️ Backend error checking authentication. Rclone RCD may be having issues.', { autoClose: 8000 });
            }
            
            this.setState({ 
                oauthAuthenticated: false,
                oauthAccountInfo: null
            });
        }
    }
    
    /**
     * Show revoke authentication confirmation modal
     */
export function handleRevokeAuth() {
        const {driveName, revokingAuth} = this.state;
        if (!driveName || revokingAuth) return;
        this.setState({ showRevokeModal: true, revokingAuth: false });
    }

    /**
     * Toggle revoke modal visibility
     */
export function toggleRevokeModal() {
        // Only allow toggling if not currently revoking
        if (!this.state.revokingAuth) {
            const newState = !this.state.showRevokeModal;
            this.setState({ showRevokeModal: newState });
        }
    }

    /**
     * Confirm and execute revoke OAuth authentication (delete config)
     */
export async function confirmRevokeAuth() {
        const {driveName} = this.state;
        if (!driveName) {
            this.setState({ showRevokeModal: false });
            return;
        }
        
        // Set loading state to prevent modal from closing prematurely
        this.setState({ revokingAuth: true });
        
        try {
            const selectedServerId = sessionStorage.getItem('RCLONE_SERVER_ID');
            const serverId = selectedServerId && selectedServerId !== 'null' ? selectedServerId : null;
            
            await revokeOAuth(driveName, serverId);
            
            toast.success("Authentication revoked successfully");
            
            // Reset state and close modal explicitly
            // Close modal first, then reset other state to prevent any re-render issues
            this.setState({
                showRevokeModal: false, // Close modal first
                revokingAuth: false,
                oauthAuthenticated: false,
                oauthAccountInfo: null,
                formValues: {
                    ...this.state.formValues,
                    client_id: '',
                    client_secret: ''
                }
            });
        } catch (error) {
            console.error('[OAuth] Error revoking authentication:', error);
            toast.error("Failed to revoke authentication: " + (error.response?.data?.error || error.message));
            // Reset loading state but keep modal open on error so user can try again or cancel
            this.setState({ revokingAuth: false });
        }
    }

    /**
     * Toggle manual token entry form
     */
export function toggleManualTokenEntry() {
        this.setState(prevState => ({
            showManualTokenEntry: !prevState.showManualTokenEntry,
            manualTokenInput: ''
        }));
    }

    /**
     * Handle manual token submission
     */
export async function handleManualTokenSubmit() {
        const {manualTokenInput} = this.state;
        
        if (!manualTokenInput || manualTokenInput.trim() === '') {
            toast.error("Please enter a token");
            return;
        }
        
        try {
            // Parse token JSON
            let tokenObject;
            try {
                tokenObject = JSON.parse(manualTokenInput.trim());
            } catch (parseError) {
                toast.error("Invalid token format. Please paste the complete JSON token from rclone authorize.");
                return;
            }
            
            // Validate token has required fields
            if (!tokenObject.access_token && !tokenObject.token) {
                toast.error("Invalid token: missing access_token field");
                return;
            }
            
            // Convert to JSON string for storage (rclone expects JSON string)
            const tokenString = JSON.stringify(tokenObject);
            
            // Store token in formValues
            this.setState(prevState => ({
                formValues: {
                    ...prevState.formValues,
                    token: tokenString
                },
                oauthAuthenticated: true,
                showManualTokenEntry: false,
                manualTokenInput: '',
                oauthAccountInfo: {
                    message: 'Authenticated via manual token entry'
                }
            }));
            
            toast.success("✅ Token added successfully! You can now save the remote.");
            
        } catch (error) {
            console.error('[Manual Token] Error:', error);
            toast.error("Failed to process token: " + error.message);
        }
    }
