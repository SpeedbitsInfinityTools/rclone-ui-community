import React from 'react';
import {Alert, Button, Card, CardBody, Col, Collapse, Container, FormFeedback, FormGroup, Input, InputGroup, InputGroupText, Label, Row, Modal, ModalHeader, ModalBody, ModalFooter, Table} from "reactstrap";
// import {config} from "./config.js";
import NewDriveAuthModal from "../../Base/NewDriveAuthModal";
import ConfirmModal from "../../../components/ConfirmModal";
import axiosInstance from "../../../utils/API/API";
import {
    findFromConfig,
    isEmpty,
    validateDriveName,
    validateDuration,
    validateInt,
    validateSizeSuffix,
    supportsOAuth
} from "../../../utils/Tools";
import { detectSystem } from "../../../utils/detectSystem";
import ProviderAutoSuggest from "./ProviderAutoSuggest";
import {toast} from "react-toastify";
import * as PropTypes from 'prop-types';
import {getProviders} from "../../../actions/configActions";
import {connect} from "react-redux";
import {NEW_DRIVE_CONFIG_REFRESH_TIMEOUT} from "../../../utils/Constants";
import ErrorBoundary from "../../../ErrorHandling/ErrorBoundary";
import urls from "../../../utils/API/endpoint";
import {withRouter} from "../../../utils/withRouter";
import {getTemplates, getTemplate, startOAuthFlow, checkOAuthStatus, getOAuthAccountInfo, revokeOAuth, detectOAuthEnvironment, sendTokenToLocalApp, testLocalAppConnection} from "../../../utils/API/director";

/**
 * Returns a component with set of input, error for the drivePrefix.
 * The input type changes based on config.Options.Type parameter. see code for details.
 * @param drivePrefix   {string}    Name of the remote in the config.
 * @param loadAdvanced  {boolean}   Load or skip the advanced options from the config options.
 * @param changeHandler {function}  This function is called once the value changes
 * @param currentValues {$ObjMap}   This map denotes current updated values for the parameters.
 * @param isValidMap    {$ObjMap}   This map denotes whether the parameter value is valid. This should be set by the changeHandler.
 * @param errorsMap     {$ObjMap}   This map contains string errors of each parameters.
 * @param config        {$ObjMap}   This map contains the actual parameter list and Options for all the providers.
 * @returns             {Array|*}   JSX array with parameter formGroups.
 * @constructor
 */
function DriveParameters({drivePrefix, loadAdvanced, changeHandler, currentValues, isValidMap, errorsMap = {}, config, onOAuthAuthenticate, oauthAuthenticating, oauthAccountInfo, oauthAuthenticated, onRevokeAuth, oauthIsLocalMachine, onTestLocalApp, oauthStatusMessages = [], onOpenAuthHelper, testingAuthHelper, showManualTokenEntry, manualTokenInput, onToggleManualToken, onManualTokenChange, onManualTokenSubmit}) {
    // State for password visibility toggle
    const [visiblePasswords, setVisiblePasswords] = React.useState({});
    
    const togglePasswordVisibility = (fieldName) => {
        setVisiblePasswords(prev => ({
            ...prev,
            [fieldName]: !prev[fieldName]
        }));
    };
    
    // Check if config is valid
    if (!config || !Array.isArray(config) || config.length === 0) {
        return null; // Don't render parameters if config is not loaded
    }
    
    if (drivePrefix !== undefined && drivePrefix !== "") {
        const currentProvider = findFromConfig(config, drivePrefix);
        let outputMap = [];
        const isOAuthRemote = supportsOAuth(config, drivePrefix);
        let oauthButtonAdded = false;
        
        if (currentProvider !== undefined) {
            const inputsMap = currentProvider.Options;

            // console.log("current values" + currentValues);

            /* Options format is as follows
            {
                        "Advanced": true,
                        "Default": -1,
                        "DefaultStr": "off",
                        "Help": "If Object's are greater, use drive v2 API to download.",
                        "Hide": 0,
                        "IsPassword": false,
                        "Name": "v2_download_min_size",
                        "NoPrefix": false,
                        "Provider": "",
                        "Required": false,
                        "ShortOpt": "",
                        "Type": "SizeSuffix",
                        "Value": null,
                        "ValueStr": "off"
                    },

            */

            outputMap = inputsMap.map((attr, idx) => {
                // Check if this field should be shown based on the selected provider
                const selectedProvider = currentValues.provider || "";
                let showField = true;
                
                // For S3, if no provider is selected yet, only show the provider selection field
                if (drivePrefix === "s3" && !selectedProvider && attr.Name !== "provider") {
                    showField = false;
                }
                
                if (attr.Provider && attr.Provider !== "") {
                    if (attr.Provider.startsWith("!")) {
                        // Exclude these providers (e.g., "!AWS,IBMCOS,Alibaba" means show for all EXCEPT these)
                        const excludedProviders = attr.Provider.substring(1).split(",");
                        showField = !excludedProviders.includes(selectedProvider);
                    } else {
                        // Include only these providers (e.g., "AWS,Alibaba" means show only for these)
                        const includedProviders = attr.Provider.split(",");
                        showField = includedProviders.includes(selectedProvider);
                    }
                }
                
                if (attr.Hide === 0 && showField && ((loadAdvanced && attr.Advanced) || (!loadAdvanced && !attr.Advanced))) {
                    // Clean up help text to make it more generic for non-AWS providers
                    let labelValue = `${attr.Help}`;
                    if (selectedProvider && selectedProvider !== "AWS") {
                        // Replace AWS-specific references with generic terms
                        labelValue = labelValue
                            .replace(/Get AWS credentials/g, 'Get credentials')
                            .replace(/AWS Access Key ID/g, 'Access Key ID')
                            .replace(/AWS Secret Access Key/g, 'Secret Access Key')
                            .replace(/AWS S3/g, 'S3')
                            .replace(/\(AWS\)/g, '')
                            .replace(/EC2\/ECS/g, 'runtime environment');
                    }
                    
                    // Add helpful examples for the endpoint field
                    if (attr.Name === "endpoint" && selectedProvider && selectedProvider !== "AWS") {
                        if (selectedProvider === "Other") {
                            labelValue = "🌐 S3 API Endpoint URL (e.g., https://fsn1.your-objectstorage.com for Hetzner)";
                        } else {
                            labelValue = "🌐 S3 API Endpoint URL";
                        }
                    }
                    
                    const requiredValue = ((attr.Required) ? (<i className={"text-red"}>*</i>) : null);

                    const hasExamples = !isEmpty(attr.Examples);
                    let examplesMap = null;

                    let inputType = "";


                    if (attr.IsPassword) {
                        inputType = visiblePasswords[attr.Name] ? "text" : "password";
                    } else if (hasExamples) {
                        // Special handling for endpoint field with "Other" provider
                        // If provider is "Other", show text input instead of dropdown
                        if (attr.Name === "endpoint" && selectedProvider === "Other") {
                            inputType = "text";
                        } else {
                            inputType = "select";
                            // Add a blank option if no value is set yet
                            let placeholderText = attr.Help;
                            if (selectedProvider && selectedProvider !== "AWS") {
                                placeholderText = placeholderText
                                    .replace(/Get AWS credentials/g, 'Get credentials')
                                    .replace(/AWS Access Key ID/g, 'Access Key ID')
                                    .replace(/AWS Secret Access Key/g, 'Secret Access Key')
                                    .replace(/AWS S3/g, 'S3')
                                    .replace(/\(AWS\)/g, '')
                                    .replace(/EC2\/ECS/g, 'runtime environment');
                            }
                            const blankOption = (!currentValues[attr.Name] || currentValues[attr.Name] === "") 
                                ? [<option key="blank" value="">{placeholderText}</option>]
                                : [];
                            examplesMap = [
                                ...blankOption,
                                ...attr.Examples.map((ex1, id1) => {
                                    return (<option key={"option" + id1} value={ex1.Value}>{ex1.Help}</option>);
                                })
                            ];
                        }
                    } else if (attr.Type === "bool") {
                        inputType = "select";
                        examplesMap = [
                            (<option key={1} value="true">Yes</option>),
                            (<option key={2} value="false">No</option>)
                        ];
                    } else {
                        // TODO: Write logic for SizeSuffix, Duration, int
                        if (attr.Type === "int") {
                            inputType = "number";
                        } else if (attr.Type === "string") {
                            inputType = "text";
                        } else {
                            inputType = "text";
                        }

                    }
                    
                    // Add helpful placeholder for endpoint field
                    let placeholder = "";
                    if (attr.Name === "endpoint" && selectedProvider === "Other") {
                        placeholder = "https://your-provider-endpoint.com";
                    } else if (attr.Name === "access_key_id") {
                        placeholder = "Enter your Access Key ID";
                    } else if (attr.Name === "secret_access_key") {
                        placeholder = "Enter your Secret Access Key";
                    }
                    
                    // Add OAuth Authenticate button BEFORE client_id field for OAuth remotes
                    const isClientId = attr.Name === 'client_id';
                    const shouldAddOAuthButton = isOAuthRemote && isClientId && !loadAdvanced && !oauthButtonAdded;
                    
                    if (shouldAddOAuthButton) {
                        oauthButtonAdded = true;
                    }
                    
                    return (
                        <React.Fragment key={idx}>
                            {shouldAddOAuthButton && onOAuthAuthenticate && (
                                <>
                                {onTestLocalApp && oauthIsLocalMachine !== true && (
                                    <FormGroup row key="test-local-app">
                                        <Col sm={12} className="text-center mb-3">
                                            <Button 
                                                color="secondary" 
                                                size="sm"
                                                onClick={onTestLocalApp}
                                                disabled={testingAuthHelper}
                                                style={{marginRight: '10px'}}
                                            >
                                                {testingAuthHelper ? (
                                                    <>
                                                        <i className="fa fa-spinner fa-spin" style={{marginRight: '5px'}}></i>
                                                        Testing...
                                                    </>
                                                ) : (
                                                    <>
                                                        <i className="fa fa-plug" style={{marginRight: '5px'}}></i>
                                                        Test Rclone Auth Helper App Connection
                                                    </>
                                                )}
                                            </Button>
                                        </Col>
                                    </FormGroup>
                                )}
                                </>
                            )}
                            {shouldAddOAuthButton && onOAuthAuthenticate && (
                                <FormGroup row>
                                    <Label sm={5}></Label>
                                    <Col sm={7}>
                                        {oauthAuthenticated ? (
                                            <div style={{marginBottom: '20px', padding: '15px', backgroundColor: '#e7f3ff', border: '1px solid #b3d9ff', borderRadius: '4px'}}>
                                                <div style={{marginBottom: '10px'}}>
                                                    <i className="fa fa-check-circle" style={{marginRight: '8px', color: '#28a745'}}></i>
                                                    <strong>You are already actively authenticated with {currentProvider.Description}</strong>
                                                </div>
                                                {oauthAccountInfo && oauthAccountInfo.email && (
                                                    <div style={{marginBottom: '8px', fontSize: '14px'}}>
                                                        <strong>Account:</strong> {oauthAccountInfo.email}
                                                    </div>
                                                )}
                                                {oauthAccountInfo && oauthAccountInfo.name && (
                                                    <div style={{marginBottom: '8px', fontSize: '14px'}}>
                                                        <strong>Name:</strong> {oauthAccountInfo.name}
                                                    </div>
                                                )}
                                                {!oauthAccountInfo && (
                                                    <div style={{marginBottom: '8px', fontSize: '14px', color: '#666'}}>
                                                        <em>Loading account information...</em>
                                                    </div>
                                                )}
                                                {onRevokeAuth && (
                                                    <Button 
                                                        color="danger" 
                                                        size="sm"
                                                        onClick={onRevokeAuth}
                                                        style={{marginTop: '8px'}}
                                                    >
                                                        Revoke Authentication
                                                    </Button>
                                                )}
                                            </div>
                                        ) : (
                                            <>
                                                {oauthIsLocalMachine === false ? (
                                                    <div style={{marginBottom: '20px', padding: '15px', backgroundColor: '#fff3cd', border: '1px solid #ffc107', borderRadius: '4px'}}>
                                                        <div style={{marginBottom: '10px'}}>
                                                            <i className="fa fa-info-circle" style={{marginRight: '8px', color: '#856404'}}></i>
                                                            <strong>Remote Access Detected</strong>
                                                        </div>
                                                        <div style={{marginBottom: '10px', fontSize: '14px'}}>
                                                            You are accessing Rclone Director from a remote computer. To authenticate with {currentProvider.Description}, you need to install the <strong>Rclone Auth Helper</strong> application on your local machine.
                                                        </div>
                                                        <div style={{marginBottom: '10px', fontSize: '14px'}}>
                                                            <ol style={{marginLeft: '20px', marginBottom: '0'}}>
                                                                <li>Download and install <a href="#" onClick={(e) => { e.preventDefault(); onOpenAuthHelper(); }} style={{color: '#0066cc', textDecoration: 'underline'}}>Rclone Auth Helper</a> on your local computer</li>
                                                                <li>Start the application</li>
                                                                <li>Click the "Authenticate" button below</li>
                                                                <li>The helper app will catch the OAuth redirect and forward it to the server</li>
                                                            </ol>
                                                        </div>
                                                        <div style={{textAlign: 'center', marginTop: '15px'}}>
                                                            <a href="#" onClick={(e) => { e.preventDefault(); onOpenAuthHelper(); }} style={{display: 'inline-block', marginBottom: '10px', color: '#0066cc', textDecoration: 'underline'}}>
                                                                <i className="fa fa-download" style={{marginRight: '5px'}}></i>
                                                                Download Rclone Auth Helper
                                                            </a>
                                                        </div>
                                                        <Button 
                                                            className="btn-blue"
                                                            onClick={onOAuthAuthenticate}
                                                            disabled={oauthAuthenticating}
                                                            style={{width: '100%', marginTop: '15px', marginBottom: '15px'}}
                                                        >
                                                            {oauthAuthenticating ? (
                                                                <>
                                                                    <i className="fa fa-spinner fa-spin" style={{marginRight: '8px'}}></i>
                                                                    Authenticating...
                                                                </>
                                                            ) : (
                                                                <>🔐 Authenticate with {currentProvider.Description}</>
                                                            )}
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <>
                                                        {oauthAuthenticating && oauthStatusMessages.length > 0 && (
                                                            <div style={{marginBottom: '15px', padding: '12px', backgroundColor: '#f0f0f0', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px'}}>
                                                                <div style={{marginBottom: '8px', fontWeight: 'bold', color: '#333'}}>
                                                                    <i className="fa fa-cog fa-spin" style={{marginRight: '8px'}}></i>
                                                                    Setting up OAuth authentication...
                                                                </div>
                                                                <ul style={{marginBottom: '0', paddingLeft: '20px', color: '#666'}}>
                                                                    {oauthStatusMessages.map((msg, idx) => (
                                                                        <li key={idx} style={{marginBottom: '4px'}}>
                                                                            {msg.message}
                                                                        </li>
                                                                    ))}
                                                                </ul>
                                                            </div>
                                                        )}
                                                        <Button 
                                                            className="btn-blue"
                                                            onClick={onOAuthAuthenticate}
                                                            disabled={oauthAuthenticating}
                                                            style={{width: '100%', marginBottom: '10px'}}
                                                        >
                                                            {oauthAuthenticating ? (
                                                                <>
                                                                    <i className="fa fa-spinner fa-spin" style={{marginRight: '8px'}}></i>
                                                                    Authenticating...
                                                                </>
                                                            ) : (
                                                                <>🔐 Authenticate with {currentProvider.Description}</>
                                                            )}
                                                        </Button>
                                                        {onToggleManualToken && (
                                                            <Button 
                                                                color="secondary"
                                                                onClick={onToggleManualToken}
                                                                style={{width: '100%', marginBottom: '10px'}}
                                                            >
                                                                <i className="fa fa-keyboard-o" style={{marginRight: '8px'}}></i>
                                                                Manual Token Entry
                                                            </Button>
                                                        )}
                                                        {showManualTokenEntry && onManualTokenSubmit && (
                                                            <div style={{marginTop: '15px', padding: '15px', backgroundColor: '#f8f9fa', border: '1px solid #dee2e6', borderRadius: '4px'}}>
                                                                <div style={{marginBottom: '10px', fontSize: '14px'}}>
                                                                    <strong>📋 Manual Token Entry</strong>
                                                                </div>
                                                                <div style={{marginBottom: '10px', fontSize: '13px', color: '#666'}}>
                                                                    Run <code>rclone authorize "{drivePrefix}"</code> on your local machine, then paste the complete JSON token here:
                                                                </div>
                                                                <Input 
                                                                    type="textarea"
                                                                    rows="6"
                                                                    value={manualTokenInput}
                                                                    onChange={onManualTokenChange}
                                                                    placeholder='{"access_token":"ya29.xxx...","token_type":"Bearer",...}'
                                                                    style={{fontFamily: 'monospace', fontSize: '12px', marginBottom: '10px'}}
                                                                />
                                                                <div style={{display: 'flex', gap: '10px'}}>
                                                                    <Button 
                                                                        color="primary"
                                                                        size="sm"
                                                                        onClick={onManualTokenSubmit}
                                                                        style={{flex: 1}}
                                                                    >
                                                                        <i className="fa fa-check" style={{marginRight: '5px'}}></i>
                                                                        Submit Token
                                                                    </Button>
                                                                    <Button 
                                                                        color="secondary"
                                                                        size="sm"
                                                                        onClick={onToggleManualToken}
                                                                        style={{flex: 1}}
                                                                    >
                                                                        Cancel
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        )}
                                                        {onOpenAuthHelper && (
                                                            <Button 
                                                                color="link"
                                                                onClick={onOpenAuthHelper}
                                                                style={{width: '100%', fontSize: '13px', padding: '5px'}}
                                                            >
                                                                <i className="fa fa-download" style={{marginRight: '6px'}}></i>
                                                                Get the Rclone Auth Helper App
                                                            </Button>
                                                        )}
                                                    </>
                                                )}
                                            </>
                                        )}
                                    </Col>
                                </FormGroup>
                            )}
                            {/* Add "OR" divider between OAuth button and client_id/client_secret fields */}
                            {shouldAddOAuthButton && isClientId && (
                                <FormGroup row>
                                    <Col sm={12} className="text-center" style={{marginBottom: '15px', marginTop: '10px'}}>
                                        <div style={{color: '#666', fontWeight: 'bold', fontSize: '14px'}}>
                                            OR
                                        </div>
                                    </Col>
                                </FormGroup>
                            )}
                            <FormGroup row>
                                <Label for={attr.Name} sm={5}>{labelValue}{requiredValue}</Label>
                                <Col sm={7}>
                                    {attr.IsPassword ? (
                                        <InputGroup>
                                            <Input type={inputType} value={currentValues[attr.Name]}
                                                   name={attr.Name} valid={isValidMap[attr.Name]} invalid={!isValidMap[attr.Name]}
                                                   id={attr.Name} onChange={changeHandler} required={attr.Required}
                                                   placeholder={placeholder}/>
                                            <InputGroupText 
                                                style={{cursor: 'pointer', backgroundColor: '#f8f9fa'}}
                                                onClick={() => togglePasswordVisibility(attr.Name)}
                                                title={visiblePasswords[attr.Name] ? "Hide password" : "Show password"}>
                                                <i className={visiblePasswords[attr.Name] ? "fa fa-eye-slash" : "fa fa-eye"}></i>
                                            </InputGroupText>
                                        </InputGroup>
                                    ) : (
                                        <Input type={inputType} value={currentValues[attr.Name]}
                                               name={attr.Name} valid={isValidMap[attr.Name]} invalid={!isValidMap[attr.Name]}
                                               id={attr.Name} onChange={changeHandler} required={attr.Required}
                                               placeholder={placeholder}>
                                            {examplesMap}
                                        </Input>
                                    )}
                                    <FormFeedback>{errorsMap && errorsMap[attr.Name] ? errorsMap[attr.Name] : ""}</FormFeedback>
                                </Col>
                            </FormGroup>
                        </React.Fragment>
                    );
                } else {
                    return null;
                }
            });
        }
        return outputMap;
    }
    return (
        <div>Select a drive type to continue</div>
    );
}

// function DriveTypes({config}) {
//     // console.log(config);
//     let configMap = config.map((drive, idx) => (
//         <option key={drive.Prefix} value={idx}>{drive.Description}</option>
//     ));
//     return configMap;
// }


/**
 * Functional Component. Custom input for selecting a new name for the current config.
 * @param key           {string}    Contains the key to be used as the react key parameter in an array
 * @param id            {string}    Id to be used as a HTML id.
 * @param label         {string}    Label of the form input
 * @param changeHandler {function}  Called when the input changes.
 * @param type          {string}    Type of the input (ReactStrap supported). Eg: select, text etc.
 * @param value         {string}    The current value of the input.
 * @param name          {string}    The html name for the input.
 * @param placeholder   {string}    Placeholder text for input.
 * @param isValid       {boolean}   If set, displays positive message, else displays error message.
 * @returns             {*}         Functional component.
 * @constructor
 */
function CustomInput({key, id, label, changeHandler, type, value, name, placeholder, isValid = false}) {
    return (
        <FormGroup key={key} row>
            <Label for={id} sm={5}>{label}</Label>
            <Col sm={7}>
                <Input type={type} value={value} name={name} placeholder={placeholder}
                       id={id} onChange={changeHandler} valid={isValid} invalid={!isValid} required/>
                <FormFeedback valid>Sweet! that name is available</FormFeedback>
                <FormFeedback valid style={{fontSize: 'inherit'}}>Alphabet, numerical and "_" and "-" are allowed</FormFeedback>
                <FormFeedback>Sad! That name is already assigned or empty</FormFeedback>
            </Col>
        </FormGroup>);
}

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
      testingAuthHelper: false

        };
        this.configCheckInterval = null;
        // Track the server ID for the current connection check to prevent race conditions
        this.pendingCheckServerId = null;
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
            await testLocalAppConnection();
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

    handleOAuthAuthenticate = async () => {
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
            
            // If we got a callback_token, try to send it to local RcloneAuthApp
            if (oauthResponse.callback_token) {
                try {
                    const serverUrl = this.getServerUrl();
                    console.log('[OAuth] Sending callback token to RcloneAuthApp:', { token: oauthResponse.callback_token.substring(0, 20) + '...', serverUrl });
                    await sendTokenToLocalApp(oauthResponse.callback_token, serverUrl);
                    console.log('[OAuth] Successfully sent token to RcloneAuthApp');
                } catch (error) {
                    console.warn('[OAuth] Could not send token to RcloneAuthApp (app may not be running):', error.message);
                    // Continue with OAuth flow anyway - the app might not be needed if user is on same machine
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
    checkOAuthStatusViaDirector = async (pollInterval, driveName, serverId) => {
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
    loadRemoteConfig = async (remoteName) => {
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
    detectOAuthEnvironment = async () => {
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
    checkOAuthPortReady = async () => {
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
    toggleOAuthPortModal = () => {
        this.setState(prev => ({ showOAuthPortModal: !prev.showOAuthPortModal }));
    }

    /**
     * Toggle Auth Helper download modal
     */
    toggleAuthHelperModal = () => {
        this.setState(prev => ({ showAuthHelperModal: !prev.showAuthHelperModal }));
    }

    /**
     * Check if a platform matches the detected system
     */
    isMatchingPlatform = (platform) => {
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
    checkOAuthStatusOnStep2 = async () => {
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
    checkOAuthStatusAndAccountInfo = async (remoteName, remoteType = null) => {
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
    handleRevokeAuth = () => {
        const {driveName, revokingAuth} = this.state;
        if (!driveName || revokingAuth) return;
        this.setState({ showRevokeModal: true, revokingAuth: false });
    }

    /**
     * Toggle revoke modal visibility
     */
    toggleRevokeModal = () => {
        // Only allow toggling if not currently revoking
        if (!this.state.revokingAuth) {
            const newState = !this.state.showRevokeModal;
            this.setState({ showRevokeModal: newState });
        }
    }

    /**
     * Confirm and execute revoke OAuth authentication (delete config)
     */
    confirmRevokeAuth = async () => {
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
    toggleManualTokenEntry() {
        this.setState(prevState => ({
            showManualTokenEntry: !prevState.showManualTokenEntry,
            manualTokenInput: ''
        }));
    }

    /**
     * Handle manual token submission
     */
    async handleManualTokenSubmit() {
        const {manualTokenInput, driveName} = this.state;
        
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

    /**
     * Parse Azure connection string, SAS token, or Blob SAS URL into a clean SAS URL.
     * Returns { sasUrl, account, type } or null if not a recognized format.
     */
    parseAzureSasInput = (input) => {
        const trimmed = input.trim();
        
        // Connection string: "BlobEndpoint=https://...;SharedAccessSignature=sv=..."
        if (trimmed.includes('BlobEndpoint=') && trimmed.includes('SharedAccessSignature=')) {
            const parts = {};
            trimmed.split(';').forEach(part => {
                const eq = part.indexOf('=');
                if (eq > 0) {
                    const key = part.substring(0, eq).trim();
                    const val = part.substring(eq + 1).trim();
                    // SharedAccessSignature value contains '=' so we need special handling
                    if (key === 'SharedAccessSignature') {
                        // Everything after "SharedAccessSignature=" up to next known key or end
                        parts[key] = val;
                    } else if (!parts[key]) {
                        parts[key] = val;
                    }
                }
            });
            
            // Re-extract SharedAccessSignature properly (it contains = and ;-delimited params)
            const sasMatch = trimmed.match(/SharedAccessSignature=(.+?)(?:$)/);
            const blobMatch = trimmed.match(/BlobEndpoint=(https?:\/\/[^;]+)/);
            
            if (blobMatch && sasMatch) {
                const blobEndpoint = blobMatch[1].replace(/\/$/, '');
                const sasToken = sasMatch[1];
                const accountMatch = blobEndpoint.match(/https?:\/\/([^.]+)\./);
                return {
                    sasUrl: `${blobEndpoint}?${sasToken}`,
                    account: accountMatch ? accountMatch[1] : '',
                    type: 'Azure connection string'
                };
            }
        }
        
        // Bare SAS token: "sv=2025-11-05&ss=b&srt=sc&sp=..."  (no URL prefix)
        if (trimmed.startsWith('sv=') || trimmed.startsWith('?sv=')) {
            return null; // Can't construct full URL without knowing the account
        }
        
        // Already a proper Blob SAS URL: "https://account.blob.core.windows.net/?sv=..."
        if (trimmed.startsWith('https://') && trimmed.includes('.blob.') && trimmed.includes('sv=')) {
            const accountMatch = trimmed.match(/https?:\/\/([^.]+)\./);
            return {
                sasUrl: trimmed,
                account: accountMatch ? accountMatch[1] : '',
                type: 'Azure Blob SAS URL'
            };
        }
        
        return null;
    }
    
    /**
     * Handle input change and set appropriate errors.
     * @param e
     */
    handleInputChange = (e) => {

        let inputName = e.target.name;
        let inputValue = e.target.value;
        const inputType = this.state.optionTypes[inputName];
        
        // Azure Blob: auto-parse connection strings pasted into ANY field
        if (this.state.drivePrefix === 'azureblob' && inputValue) {
            // Detect connection string in any field (sas_url, key, or account)
            if ((inputName === 'sas_url' || inputName === 'key' || inputName === 'account') 
                && (inputValue.includes('BlobEndpoint=') || inputValue.includes('SharedAccessSignature='))) {
                const parsed = this.parseAzureSasInput(inputValue);
                if (parsed) {
                    this.setState({
                        formValues: {
                            ...this.state.formValues,
                            sas_url: parsed.sasUrl,
                            account: '',
                            key: ''
                        }
                    });
                    toast.success(`Detected ${parsed.type} - auto-configured SAS URL`);
                    return;
                }
            }
            
            // Detect Blob SAS URL pasted into sas_url field
            if (inputName === 'sas_url') {
                const parsed = this.parseAzureSasInput(inputValue);
                if (parsed) {
                    this.setState({
                        formValues: {
                            ...this.state.formValues,
                            sas_url: parsed.sasUrl,
                            account: '',
                            key: ''
                        }
                    });
                    toast.success(`Detected ${parsed.type} - auto-configured SAS URL`);
                    return;
                }
                // Any value in SAS URL clears account + key
                if (inputValue) {
                    this.setState({
                        formValues: { ...this.state.formValues, sas_url: inputValue, account: '', key: '' }
                    });
                    return;
                }
            }
            
            // Filling account or key clears SAS URL
            if ((inputName === 'account' || inputName === 'key') && inputValue && this.state.formValues.sas_url) {
                this.setState({
                    formValues: { ...this.state.formValues, [inputName]: inputValue, sas_url: '' }
                });
                return;
            }
        }
        
        this.setState({
            formValues: {
                ...this.state.formValues,
                [inputName]: inputValue
            }
        });
        let validateResult = true;
        let error = "";
        if (inputType === "SizeSuffix") {
            validateResult = validateSizeSuffix(inputValue);
            if (!validateResult) {
                error = "The valid input is size( off | {unit}{metric} eg: 10G, 100M, 10G100M etc.)"
            }
        } else if (inputType === "Duration") {
            validateResult = validateDuration(inputValue);
            if (!validateResult) {
                error = "The valid input is time ({unit}{metric} eg: 10ms, 100m, 10h15ms etc.)"
            }
        } else if (inputType === "int") {
            validateResult = validateInt(inputValue);
            if (!validateResult) {
                error = "The valid input is int (100,200,300 etc)"
            }
        }

        if (this.state.required[inputName] && (!inputValue || inputValue === "")) {
            validateResult = false;
            if (!validateResult) {
                error += " This field is required";
            }
        }


        this.setState((prevState) => {
            return {
                isValid: {
                    ...prevState.isValid,
                    [inputName]: validateResult
                },
                formErrors: {
                    ...prevState.formErrors,
                    [inputName]: error
                },
            }
        });


    };

    /**
     * Validate form values against their types and requirements
     * @param formValues {object} Current form values
     * @param optionTypes {object} Type mapping for each field
     * @param required {object} Required flag for each field
     * @returns {object} Updated isValid and formErrors objects
     */
    validateFormValues = (formValues, optionTypes, required) => {
        const isValid = {};
        const formErrors = {};
        
        for (const [key, value] of Object.entries(formValues)) {
            const inputType = optionTypes[key];
            const isRequired = required[key];
            let validateResult = true;
            let error = "";
            
            // Type-specific validation
            if (inputType === "SizeSuffix") {
                validateResult = validateSizeSuffix(value);
                if (!validateResult) {
                    error = "The valid input is size( off | {unit}{metric} eg: 10G, 100M, 10G100M etc.)";
                }
            } else if (inputType === "Duration") {
                validateResult = validateDuration(value);
                if (!validateResult) {
                    error = "The valid input is time ({unit}{metric} eg: 10ms, 100m, 10h15ms etc.)";
                }
            } else if (inputType === "int") {
                validateResult = validateInt(value);
                if (!validateResult) {
                    error = "The valid input is int (100,200,300 etc)";
                }
            }
            
            // Required field validation
            if (isRequired && (!value || value === "")) {
                validateResult = false;
                if (error) {
                    error += " This field is required";
                } else {
                    error = "This field is required";
                }
            }
            
            isValid[key] = validateResult;
            formErrors[key] = error;
        }
        
        return { isValid, formErrors };
    };

    /**
     * Update the driveType and then load the equivalent input parameters for that drive.
     * @param event     {$ObjMap} Event to be handled.
     * @param newValue  {string} new Value of the drive type.
     */
    changeDriveType = (event, {newValue}) => {

        const {providers} = this.props;

        let val = newValue;


        let availableOptions = {};
        let optionTypes = {};
        let isValid = {};
        let formErrors = {};
        let required = {};
        // let drivePrefix = "";
        // console.log("driveType change", val);
        if (val !== undefined && val !== "") {

            const currentConfig = findFromConfig(providers, val);
            if (currentConfig !== undefined) {

                currentConfig.Options.forEach(item => {

                    const {DefaultStr, Type, Name, Required, Hide} = item;
                    if (Hide === 0) {
                        availableOptions[Name] = DefaultStr;
                        optionTypes[Name] = Type;
                        required[Name] = Required;

                        isValid[Name] = !(Required && (!DefaultStr || DefaultStr === ""));

                        formErrors[Name] = "";
                    }
                });
            }
            
            // Preserve existing formValues if they exist (e.g., from template import)
            const existingFormValues = this.state.formValues || {};
            const mergedFormValues = { ...availableOptions, ...existingFormValues };
            
            // Validate the merged values
            const validation = this.validateFormValues(mergedFormValues, optionTypes, required);
            
            this.setState({
                drivePrefix: val,
                formValues: mergedFormValues,
                optionTypes: optionTypes,
                isValid: validation.isValid,
                formErrors: validation.formErrors,
                required: required
            });
        } else {
            this.setState({drivePrefix: val})

        }
    };

    /**
     * Open second step of setting up the drive and scroll into view.
     */
    openSetupDrive = (e) => {
        if (e) e.preventDefault();
        this.setState({'colSetup': true});
        // this.setupDriveDiv.scrollIntoView({behavior: "smooth"});
    };

    /**
     *  toggle the step 3: advanced options
     */
    editAdvancedOptions = (e) => {
        this.setState({advancedOptions: !this.state.advancedOptions});
    };

    /**
     * Validate the form and set the appropriate errors in the state.
     * @returns {boolean}
     */
    validateForm() {
        //    Validate driveName and other parameters
        const {driveNameIsValid, drivePrefix, isValid, formValues} = this.state;
        let flag = true;

        if (!driveNameIsValid) {
            flag = false;
        }
        if (drivePrefix === "") {
            flag = false;
        }

        // Special validation for S3: Ensure endpoint is provided for non-AWS providers
        if (drivePrefix === "s3") {
            const provider = formValues.provider || "";
            const endpoint = formValues.endpoint || "";
            
            // If not AWS, IBM, or Alibaba, endpoint is required
            if (provider !== "AWS" && provider !== "IBMCOS" && provider !== "Alibaba" && !endpoint.trim()) {
                toast.error("Endpoint is required for non-AWS S3 providers (e.g., Hetzner, DigitalOcean, etc.)", {
                    autoClose: 8000
                });
                flag = false;
            }
        }

        /*Check for validations based on inputType*/
        for (const [key, value] of Object.entries(isValid)) {
            if (!key || !value) {
                flag = false;
                break;
            }
        }

        return flag;
    }

    /**
     *  Show or hide the auth modal.
     */
    toggleAuthModal() {
        this.setState((state, props) => {
            return {authModalIsVisible: !state.authModalIsVisible}
        });
    }

    /**
     *  Show or hide the authentication modal and start timer for checking if the new config is created.
     */
    startAuthentication() {
        this.toggleAuthModal();
        // Check every second if the config is created
        if (this.configCheckInterval === null) {
            this.configCheckInterval = setInterval(this.checkConfigStatus, NEW_DRIVE_CONFIG_REFRESH_TIMEOUT);
        } else {
            console.error("Interval already running. Should not start a new one");
        }

    }

    /**
     *  Called when the config is successfully created. Clears the timout and hides the authentication modal.
     */
    stopAuthentication() {
        this.setState((state, props) => {
            return {authModalIsVisible: false}
        });
        if (this.configCheckInterval) {
            clearInterval(this.configCheckInterval);
            this.configCheckInterval = null;
        }
    }

    /**
     * Called when form action submit is to be handled.
     * Validate form and submit request.
     * */
    async handleSubmit(e) {
        e && e.preventDefault();
        // console.log("Submitted form");

        // Set saving state
        this.setState({ saving: true });

      const {formValues, drivePrefix} = this.state;
        const {providers} = this.props;


        if (this.validateForm()) {

            if (drivePrefix !== undefined && drivePrefix !== "") {
                const currentProvider = findFromConfig(providers, drivePrefix);
                if (currentProvider !== undefined) {


                    const defaults = currentProvider.Options;

                    // console.log(config, formValues, defaults);

                    let finalParameterValues = {};


                    for (const [key, value] of Object.entries(formValues)) {

                        if (key === "token") {
                            finalParameterValues[key] = value;
                            continue;
                        }
                        const defaultValueObj = defaults.find((ele, idx, array) => {
                            // console.log(key, ele.Name, key === ele.Name);
                            return (key === ele.Name);
                        });
                        if (defaultValueObj) {

                            const {DefaultStr} = defaultValueObj;
                            if (value !== DefaultStr) {
                                // console.log(`${value} !== ${DefaultStr}`);
                                finalParameterValues[key] = value;
                            }
                        }

                    }


          // Build base remote data
          let data = {
            parameters: finalParameterValues,
            name: this.state.driveName,
            type: this.state.drivePrefix
          };


                    // console.log("Validated form");
                    // Note: We no longer use startAuthentication() - success is handled via success modal
          try {
            const {drivePrefix: editingPrefix} = this.props.match.params;

            // If encryption is requested, create an underlying base remote and then a crypt remote with the chosen name
            if (this.state.addEncryption) {
              // Validate encryption passwords
              if (!this.state.encPassword || this.state.encPassword !== this.state.encPasswordRepeat) {
                toast.error("Encryption passwords do not match");
                this.stopAuthentication();
                return;
              }
              if (this.state.useFilenamePassword && (!this.state.encPassword2 || this.state.encPassword2 !== this.state.encPassword2Repeat)) {
                toast.error("Filename encryption passwords do not match");
                this.stopAuthentication();
                return;
              }

              const baseName = `${this.state.driveName}_base`;

              // 1) Create or update the base remote with name '<name>_base'
              const baseData = { ...data, name: baseName };
              await Promise.race([
                axiosInstance.post(urls.createConfig, baseData),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout after 30 seconds')), 30000))
              ]);

              // 2) Create or update the crypt remote with the user facing name '<name>'
              const cryptParams = {
                remote: `${baseName}:`,
                password: this.state.encPassword,
                filename_encryption: "standard",
                directory_name_encryption: true
              };
              if (this.state.useFilenamePassword) {
                cryptParams.password2 = this.state.encPassword2;
              }

              const cryptData = {
                name: this.state.driveName,
                type: "crypt",
                parameters: cryptParams
              };

              // If editing, update; otherwise create
              if (!editingPrefix) {
                await Promise.race([
                  axiosInstance.post(urls.createConfig, cryptData),
                  new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout after 30 seconds')), 30000))
                ]);
                this.stopAuthentication();
                this.setState({
                    saving: false,
                    showSuccessModal: true,
                    successMessage: "Encrypted remote created successfully!"
                });
              } else {
                await Promise.race([
                  axiosInstance.post(urls.updateConfig, cryptData),
                  new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout after 30 seconds')), 30000))
                ]);
                this.stopAuthentication();
                this.setState({
                    saving: false,
                    showSuccessModal: true,
                    successMessage: "Encrypted remote updated successfully!"
                });
              }
              } else {
                // No encryption: normal create/update
                // For OAuth remotes, use delete-then-create to avoid Rclone's token refresh logic in config/update
                const isOAuthRemote = supportsOAuth(this.props.providers || [], this.state.drivePrefix);
                
                if (!editingPrefix) {
                  // Create new remote
                  if (isOAuthRemote) {
                    // For OAuth remotes, config/create can hang/error due to token validation
                    // Make it async and wait a bit, then verify it was created
                    const createPromise = axiosInstance.post(urls.createConfig, data);
                    await Promise.race([
                        createPromise,
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Config create timeout')), 5000))
                    ]).catch(async (err) => {
                        // If create fails or times out, wait a bit and verify config exists
                        console.log('[OAuth] Config create may have timed out, verifying...', err.message);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        // Verify config was created
                        const verifyConfig = await axiosInstance.post(urls.getConfigForRemote, {name: this.state.driveName});
                        if (verifyConfig.data && !isEmpty(verifyConfig.data)) {
                            console.log('[OAuth] Config verified after async create');
                            return; // Config exists, success
                        }
                        throw err; // Re-throw if config doesn't exist
                    });
                    this.stopAuthentication();
                    this.setState({
                        saving: false,
                        showSuccessModal: true,
                        successMessage: "Remote configuration created successfully!"
                    });
                  } else {
                    await Promise.race([
                      axiosInstance.post(urls.createConfig, data),
                      new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout after 30 seconds')), 30000))
                    ]);
                    this.stopAuthentication();
                    this.setState({
                        saving: false,
                        showSuccessModal: true,
                        successMessage: "Remote configuration created successfully!"
                    });
                  }
                } else {
                  // Check if remote is being renamed
                  const isRenaming = this.state.originalDriveName && this.state.originalDriveName !== this.state.driveName;
                  
                  if (isRenaming) {
                    // When renaming, we need to get config from the ORIGINAL name, not the new name
                    console.log(`[Rename] Renaming remote from "${this.state.originalDriveName}" to "${this.state.driveName}"`);
                  }
                  
                  if (isOAuthRemote) {
                    // OAuth remotes: preserve token when updating
                    // Extract token from existing config before deleting
                    // Use originalDriveName if renaming, otherwise use current driveName
                    const configNameToCheck = isRenaming ? this.state.originalDriveName : this.state.driveName;
                    const existingConfigCheck = await axiosInstance.post(urls.getConfigForRemote, {name: configNameToCheck});
                    const existingToken = existingConfigCheck.data?.token || 
                                        (existingConfigCheck.data?.parameters && existingConfigCheck.data?.parameters.token);
                    
                    if (existingToken && existingToken.length > 0) {
                      // Preserve the token in the new config
                      console.log('[OAuth] Preserving existing token when updating config');
                      finalParameterValues.token = existingToken;
                      data.parameters = finalParameterValues;
                    }
                    
                    // OAuth remotes: delete then create to avoid token refresh issues
                    // Use originalDriveName if renaming, otherwise use current driveName
                    const nameToDelete = isRenaming ? this.state.originalDriveName : this.state.driveName;
                    try {
                      await axiosInstance.post(urls.deleteConfig, {name: nameToDelete});
                      // Wait a moment for Rclone to fully process the deletion
                      await new Promise(resolve => setTimeout(resolve, 1000));
                    } catch (deleteErr) {
                      // Ignore delete errors (config might not exist)
                      console.log('[OAuth] Delete before update:', deleteErr.response?.status === 404 ? 'not found (ok)' : deleteErr.message);
                    }
                    // For OAuth remotes, config/create can hang/error due to token validation
                    // Make it async and wait a bit, then verify it was created
                    const createPromise = axiosInstance.post(urls.createConfig, data);
                    await Promise.race([
                        createPromise,
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Config create timeout')), 5000))
                    ]).catch(async (err) => {
                        // If create fails or times out, wait a bit and verify config exists
                        console.log('[OAuth] Config create may have timed out, verifying...', err.message);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        // Verify config was created
                        const verifyConfig = await axiosInstance.post(urls.getConfigForRemote, {name: this.state.driveName});
                        if (verifyConfig.data && !isEmpty(verifyConfig.data)) {
                            console.log('[OAuth] Config verified after async create');
                            return; // Config exists, success
                        }
                        // Don't throw error if config exists - 500 error is expected for OAuth remotes
                        if (err.response?.status === 500) {
                            console.log('[OAuth] 500 error is expected for OAuth remotes, config was verified');
                            return;
                        }
                        throw err; // Re-throw if config doesn't exist
                    });
                    this.stopAuthentication();
                    this.setState({
                        saving: false,
                        showSuccessModal: true,
                        successMessage: isRenaming ? "Remote renamed and updated successfully!" : "Remote configuration updated successfully!"
                    });
                  } else {
                    // Non-OAuth remotes
                    if (isRenaming) {
                      // When renaming, delete old config then create new one
                      console.log(`[Rename] Deleting old config "${this.state.originalDriveName}" and creating new config "${this.state.driveName}"`);
                      try {
                        await axiosInstance.post(urls.deleteConfig, {name: this.state.originalDriveName});
                        await new Promise(resolve => setTimeout(resolve, 500));
                      } catch (deleteErr) {
                        console.log('[Rename] Delete error:', deleteErr.response?.status === 404 ? 'not found (ok)' : deleteErr.message);
                      }
                      await Promise.race([
                        axiosInstance.post(urls.createConfig, data),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout after 30 seconds')), 30000))
                      ]);
                    } else {
                      // Normal update (same name)
                      await Promise.race([
                        axiosInstance.post(urls.updateConfig, data),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout after 30 seconds')), 30000))
                      ]);
                    }
                    this.stopAuthentication();
                    this.setState({
                        saving: false,
                        showSuccessModal: true,
                        successMessage: isRenaming ? "Remote renamed and updated successfully!" : "Remote configuration updated successfully!"
                    });
                  }
                }
              }

          } catch (err) {
            toast.error(`Error creating config. ${err}`);
            this.stopAuthentication();
            this.setState({ saving: false });
          }

                }
            }
        } else {
            // Validation failed - find and report specific errors
            const {driveNameIsValid, drivePrefix, isValid, formErrors, formValues} = this.state;
            const errors = [];
            
            // Check specific validation failures
            if (!driveNameIsValid) {
                errors.push("Remote name is invalid or already exists (Step 1)");
            }
            if (!drivePrefix || drivePrefix === "") {
                errors.push("Please select a provider (Step 1)");
            }
            
            // Check for invalid form fields and determine which step they're in
            const invalidFieldsStep2 = [];
            const invalidFieldsStep3 = [];
            
            // Get provider config to check which fields are advanced
            const {providers} = this.props;
            const currentProvider = drivePrefix ? findFromConfig(providers, drivePrefix) : null;
            const advancedFields = new Set();
            
            if (currentProvider && currentProvider.Options) {
                currentProvider.Options.forEach(opt => {
                    if (opt.Advanced) {
                        advancedFields.add(opt.Name);
                    }
                });
            }
            
            for (const [key, value] of Object.entries(isValid)) {
                if (!value) {
                    const errorMsg = formErrors[key] || "Invalid value";
                    if (advancedFields.has(key)) {
                        invalidFieldsStep3.push(`${key}: ${errorMsg}`);
                    } else {
                        invalidFieldsStep2.push(`${key}: ${errorMsg}`);
                    }
                }
            }
            
            // Special S3 validation
            if (drivePrefix === "s3") {
                const provider = formValues.provider || "";
                const endpoint = formValues.endpoint || "";
                if (provider !== "AWS" && provider !== "IBMCOS" && provider !== "Alibaba" && !endpoint.trim()) {
                    errors.push("Endpoint is required for non-AWS S3 providers (Step 2)");
                }
            }
            
            // Build error message
            let errorMessage = "Please fix the following errors before submitting:\n";
            if (errors.length > 0) {
                errorMessage += errors.map(e => `• ${e}`).join("\n");
            }
            if (invalidFieldsStep2.length > 0) {
                errorMessage += "\n\nInvalid fields in Step 2:\n";
                errorMessage += invalidFieldsStep2.slice(0, 5).map(f => `• ${f}`).join("\n");
                if (invalidFieldsStep2.length > 5) {
                    errorMessage += `\n... and ${invalidFieldsStep2.length - 5} more`;
                }
            }
            if (invalidFieldsStep3.length > 0) {
                errorMessage += "\n\nInvalid fields in Step 3 (Advanced Options):\n";
                errorMessage += invalidFieldsStep3.slice(0, 5).map(f => `• ${f}`).join("\n");
                if (invalidFieldsStep3.length > 5) {
                    errorMessage += `\n... and ${invalidFieldsStep3.length - 5} more`;
                }
            }
            
            toast.error(errorMessage, {
                autoClose: 10000,
                style: { whiteSpace: 'pre-line' }
            });
            
            // Scroll to first invalid field
            setTimeout(() => {
                const firstInvalidInput = document.querySelector('input.invalid, select.invalid');
                if (firstInvalidInput) {
                    firstInvalidInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    firstInvalidInput.focus();
                }
            }, 100);
        }
    }

    /**
     * Clears the entire form.
     * Clearing the driveName and drivePrefix automatically clears the inputs as well.
     * */
    clearForm = _ => {
        this.setState({driveName: "", drivePrefix: ""})
    };


    /**
     * Change the name of the drive. Check if it already exists, if not, allow to be changes, else set error.
     * */
    changeName = e => {
        const {originalDriveName} = this.state;
        const value = e.target.value;
        
        // Allow empty value (for deletion) or validate if not empty
        if (value === "" || validateDriveName(value)) {
            this.setState({driveName: value}, () => {
                if (value === undefined || value === "") {
                    this.setState({driveNameIsValid: false});
                } else {
                    // When editing, if the name equals the original name, it's always valid
                    if (originalDriveName && value === originalDriveName) {
                        this.setState({formErrors: {...this.state.formErrors, driveName: ""}, driveNameIsValid: true});
                        return;
                    }
                    
                    // Check if name already exists (for other remotes)
                    axiosInstance.post(urls.getConfigForRemote, {name: value}).then((response) => {
                        let errors = this.state.formErrors;
                        let isValid = isEmpty(response.data);
                        if (isValid) {
                            errors["driveName"] = "";
                        } else {
                            errors["driveName"] = "Duplicate";
                        }
                        this.setState({formErrors: errors, driveNameIsValid: isValid});
                    });
                }
            });
        } else {
            // Invalid character - don't update state, but show error
            // This prevents invalid characters from being entered
            const errors = {...this.state.formErrors};
            errors["driveName"] = "Invalid characters in remote name";
            this.setState({formErrors: errors});
        }
    };

    /**
     * Open the advanced settings card and scroll into view.
     * @param e
     */
    openAdvancedSettings = e => {
        if (this.state.advancedOptions) {
            this.setState({colAdvanced: true});
        } else {
            this.configEndDiv.scrollIntoView({behavior: "smooth"});
        }
    };



    /**
     * Test the remote connection, read, and write capabilities
     */
    testRemoteConnection = async () => {
        const {driveName, drivePrefix, formValues} = this.state;
        
        // Reset test results and show testing spinner
        this.setState({
            testingConnection: true,
            testResults: {
                tested: true,
                connectionTest: null,
                readTest: null,
                writeTest: null,
                error: null
            }
        });
        
        try {
            // First, save the remote configuration so we can test it
            toast.info("Saving remote configuration for testing...");
            
            // Build the config data (same as in handleSubmit)
            const currentProvider = findFromConfig(this.props.providers, drivePrefix);
            if (!currentProvider) {
                this.setState(prev => ({
                    testResults: {...prev.testResults, connectionTest: false, error: "Provider configuration not found"}
                }));
                toast.error("Provider configuration not found");
                return;
            }
            
            const defaults = currentProvider.Options;
            let finalParameterValues = {};
            
            for (const [key, value] of Object.entries(formValues)) {
                if (key === "token") {
                    finalParameterValues[key] = value;
                    continue;
                }
                
                const defaultValueObj = defaults.find((ele) => key === ele.Name);
                if (defaultValueObj) {
                    const {DefaultStr} = defaultValueObj;
                    if (value !== DefaultStr) {
                        finalParameterValues[key] = value;
                    }
                }
            }
            
            let data = {
                parameters: finalParameterValues,
                name: driveName,
                type: drivePrefix
            };
            
            try {
                // Check if remote already exists
                const existingConfig = await axiosInstance.post(urls.getConfigForRemote, {name: driveName});
                
                // For OAuth remotes, use delete-then-create to avoid Rclone's token refresh logic
                const isOAuthRemote = supportsOAuth(this.props.providers || [], drivePrefix);
                
                if (existingConfig.data && !isEmpty(existingConfig.data)) {
                    if (isOAuthRemote) {
                        // OAuth remotes: preserve token when updating
                        // Extract token from existing config before deleting
                        const existingToken = existingConfig.data.token || 
                                            (existingConfig.data.parameters && existingConfig.data.parameters.token);
                        
                        if (existingToken && existingToken.length > 0) {
                            // Preserve the token in the new config
                            console.log('[OAuth] Preserving existing token when updating config');
                            finalParameterValues.token = existingToken;
                            data.parameters = finalParameterValues;
                        }
                        
                        // OAuth remotes: delete then create to avoid token refresh issues
                        try {
                            await axiosInstance.post(urls.deleteConfig, {name: driveName});
                            // Wait a moment for Rclone to fully process the deletion
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        } catch (deleteErr) {
                            // Ignore delete errors (config might not exist)
                            console.log('[OAuth] Delete before test update:', deleteErr.response?.status === 404 ? 'not found (ok)' : deleteErr.message);
                        }
                        // For OAuth remotes, config/create can hang/error due to token validation
                        // Make it async and wait a bit, then verify it was created
                        const createPromise = axiosInstance.post(urls.createConfig, data);
                        // Wait a short time for config to be written
                        await Promise.race([
                            createPromise,
                            new Promise((_, reject) => setTimeout(() => reject(new Error('Config create timeout')), 5000))
                        ]).catch(async (err) => {
                            // If create fails or times out, wait a bit and verify config exists
                            // This is expected for OAuth remotes - Rclone's config/create tries to validate tokens
                            // which can timeout, but the config is still written successfully
                            console.log('[OAuth] Config create returned error (expected for OAuth remotes), verifying config was created...', err.message);
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            // Verify config was created
                            const verifyConfig = await axiosInstance.post(urls.getConfigForRemote, {name: driveName});
                            if (verifyConfig.data && !isEmpty(verifyConfig.data)) {
                                // Verify token is still present
                                const verifyToken = verifyConfig.data.token || 
                                                  (verifyConfig.data.parameters && verifyConfig.data.parameters.token);
                                if (verifyToken && verifyToken.length > 0) {
                                    console.log('[OAuth] ✓ Config verified with token - save was successful despite the error');
                                } else {
                                    console.warn('[OAuth] ⚠️ Config verified but token is missing - token may have been cleared by Rclone');
                                }
                                return; // Config exists, success
                            }
                            throw err; // Re-throw if config doesn't exist
                        });
                        toast.success("Remote configuration updated");
                    } else {
                        // Update existing remote (non-OAuth)
                        await axiosInstance.post(urls.updateConfig, data);
                        toast.success("Remote configuration updated");
                    }
                } else {
                    // Create new remote
                    if (isOAuthRemote) {
                        // For OAuth remotes, config/create can hang/error due to token validation
                        // Make it async and wait a bit, then verify it was created
                        const createPromise = axiosInstance.post(urls.createConfig, data);
                        await Promise.race([
                            createPromise,
                            new Promise((_, reject) => setTimeout(() => reject(new Error('Config create timeout')), 5000))
                        ]).catch(async (err) => {
                            // If create fails or times out, wait a bit and verify config exists
                            // This is expected for OAuth remotes - Rclone's config/create tries to validate tokens
                            // which can timeout, but the config is still written successfully
                            console.log('[OAuth] Config create returned error (expected for OAuth remotes), verifying config was created...', err.message);
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            // Verify config was created
                            const verifyConfig = await axiosInstance.post(urls.getConfigForRemote, {name: driveName});
                            if (verifyConfig.data && !isEmpty(verifyConfig.data)) {
                                console.log('[OAuth] ✓ Config verified - save was successful despite the error');
                                return; // Config exists, success
                            }
                            throw err; // Re-throw if config doesn't exist
                        });
                    } else {
                        await axiosInstance.post(urls.createConfig, data);
                    }
                    toast.success("Remote configuration saved");
                }
            } catch (err) {
                this.setState(prev => ({
                    testResults: {...prev.testResults, connectionTest: false, error: `Failed to save configuration: ${err.response?.data?.details?.error || err.response?.data?.error || err.message}`}
                }));
                toast.error(`Failed to save configuration: ${err.response?.data?.error || err.message}`);
                return;
            }
            
            // Now test the saved remote
            // Test 1: Connection - Use list for all remotes (more reliable than about)
            // Some remotes (like S3) don't support 'about' on root, and 'about' can hang for OAuth remotes
            try {
                // Use list instead of about - it's more reliable and works for all remotes
                await axiosInstance.post(urls.getFilesList, {
                    fs: `${driveName}:`,
                    remote: "/"
                });
                this.setState(prev => ({
                    testingConnection: false,
                    testResults: {...prev.testResults, connectionTest: true}
                }));
            } catch (err) {
                this.setState(prev => ({
                    testingConnection: false,
                    testResults: {...prev.testResults, connectionTest: false, error: `Connection test failed: ${err.response?.data?.details?.error || err.response?.data?.error || err.message}`}
                }));
                return;
            }
            
            // Test 2: Read - List files at root
            try {
                await axiosInstance.post(urls.getFilesList, {
                    fs: `${driveName}:`,
                    remote: "/"
                });
                this.setState(prev => ({
                    testResults: {...prev.testResults, readTest: true}
                }));
            } catch (err) {
                this.setState(prev => ({
                    testResults: {...prev.testResults, readTest: false, error: err.response?.data?.details?.error || err.response?.data?.error || err.message}
                }));
                return;
            }
            
            // Test 3: Write - Create a test directory and delete it
            try {
                // First, try to clean up any existing test directory from previous runs
                await axiosInstance.post(urls.purge, {
                    fs: `${driveName}:`,
                    remote: `.rclone-test-dir`
                }).catch(() => {}); // Ignore if it doesn't exist
                
                // Try to create a test directory (if supported)
                await axiosInstance.post(urls.mkdir, {
                    fs: `${driveName}:`,
                    remote: `.rclone-test-dir`
                }).catch(() => {}); // Ignore if it fails (some remotes don't support mkdir)
                
                // Try to delete the test directory using purge (for directories)
                // Note: This may fail if the directory doesn't exist or is read-only - that's OK
                await axiosInstance.post(urls.purge, {
                    fs: `${driveName}:`,
                    remote: `.rclone-test-dir`
                }).catch((deleteErr) => {
                    // Silently ignore delete errors - test directory cleanup is optional
                    // The write test already passed if we got here
                });
                
                this.setState(prev => ({
                    testResults: {...prev.testResults, writeTest: true}
                }));
            } catch (err) {
                this.setState(prev => ({
                    testResults: {...prev.testResults, writeTest: false, error: err.response?.data?.details?.error || err.response?.data?.error || "Write test failed - remote may be read-only"}
                }));
            }
            
        } catch (err) {
            this.setState({
                testingConnection: false,
                testResults: {
                    tested: true,
                    connectionTest: false,
                    readTest: null,
                    writeTest: null,
                    error: err.response?.data?.error || err.message
                }
            });
        }
    };


    gotoNextStep = () => {
        const {currentStepNumber, driveName, drivePrefix, driveNameIsValid} = this.state;
        
        // Validation for Step 1: must have name AND provider selected
        if (currentStepNumber === 1) {
            if (!driveName || driveName.trim() === '' || !driveNameIsValid) {
                toast.error("Please enter a valid name for the remote");
                return;
            }
            if (!drivePrefix || drivePrefix === '') {
                toast.error("Please select a target provider");
                return;
            }
        }
        
        // Always go through all 4 steps
        if (currentStepNumber === 4) {
            // On Step 4 (Test Remote), clicking Next submits the form
            this.handleSubmit(null);
        } else {
            this.setCurrentStep(currentStepNumber + 1);
        }
    };

    gotoPrevStep = () => {
        const {currentStepNumber} = this.state;
        this.setCurrentStep(currentStepNumber - 1);
    };


    setCurrentStep = (stepNo) => {
        this.setState({currentStepNumber: stepNo});
        
        // Auto-check OAuth status and detect environment when entering step 2
        if (stepNo === 2) {
            console.log('[OAuth] Step 2 activated, checking OAuth status...');
            // Detect environment first (if not already detected)
            if (this.state.oauthIsLocalMachine === null) {
                this.detectOAuthEnvironment().then(() => {
                    // After environment detection, check OAuth status
                    this.checkOAuthStatusOnStep2();
                });
            } else {
                // Environment already detected, just check OAuth status
                this.checkOAuthStatusOnStep2();
            }
        }
    };

    /**
     * Show cancel confirmation modal
     */
    handleCancel = () => {
        this.setState({ showCancelModal: true });
    };

    /**
     * Toggle cancel confirmation modal
     */
    toggleCancelModal = () => {
        this.setState({ showCancelModal: !this.state.showCancelModal });
    };

    /**
     * Confirm cancel and navigate to dashboard
     */
    confirmCancel = () => {
        this.props.history.push('/dashboard');
    };

    // Template import methods
    toggleTemplateModal = async () => {
        const { showTemplateModal } = this.state;
        
        if (!showTemplateModal) {
            // Loading templates when opening modal
            this.setState({ loadingTemplates: true, showTemplateModal: true });
            try {
                const data = await getTemplates();
                this.setState({ templates: data.templates || [] });
            } catch (error) {
                console.error('Failed to load templates:', error);
                toast.error('Failed to load templates');
                this.setState({ showTemplateModal: false });
                return;
            } finally {
                this.setState({ loadingTemplates: false });
            }
        } else {
            this.setState({ showTemplateModal: false });
        }
    };

    handleImportTemplate = async (template) => {
        try {
            // Get full template data with decrypted parameters
            const templateData = await getTemplate(template.id);
            const {providers} = this.props;
            
            // Check if this is a crypt template with base remote
            if (templateData.type === 'crypt' && templateData.baseRemote) {
                // For crypt templates with base remote, set the base remote type and parameters
                // The encryption will be handled through the existing UI (Add Encryption checkbox)
                const baseType = templateData.baseRemote.type;
                const baseParams = templateData.baseRemote.parameters;
                
                // Get option types and required flags for validation
                const currentConfig = findFromConfig(providers, baseType);
                const optionTypes = {};
                const required = {};
                const availableOptions = {};
                
                if (currentConfig) {
                    currentConfig.Options.forEach(item => {
                        if (item.Hide === 0) {
                            availableOptions[item.Name] = item.DefaultStr;
                            optionTypes[item.Name] = item.Type;
                            required[item.Name] = item.Required;
                        }
                    });
                }
                
                // Merge template params with defaults
                const mergedFormValues = { ...availableOptions, ...baseParams };
                
                // Validate the merged values
                const validation = this.validateFormValues(mergedFormValues, optionTypes, required);
                
                // Set all state at once
                this.setState({
                    drivePrefix: baseType,
                    formValues: mergedFormValues,
                    optionTypes: optionTypes,
                    isValid: validation.isValid,
                    formErrors: validation.formErrors,
                    required: required,
                    showTemplateModal: false,
                    // Pre-fill encryption settings from the crypt template
                    addEncryption: true,
                    encPassword: templateData.parameters.password || '',
                    encPasswordRepeat: templateData.parameters.password || '',
                    useFilenamePassword: !!templateData.parameters.password2,
                    encPassword2: templateData.parameters.password2 || '',
                    encPassword2Repeat: templateData.parameters.password2 || ''
                });
                
                toast.success(`Template "${template.name}" imported with encryption settings!`);
            } else {
                // Normal (non-crypt) template
                const templateType = templateData.type;
                const templateParams = templateData.parameters;
                
                // Get option types and required flags for validation
                const currentConfig = findFromConfig(providers, templateType);
                const optionTypes = {};
                const required = {};
                const availableOptions = {};
                
                if (currentConfig) {
                    currentConfig.Options.forEach(item => {
                        if (item.Hide === 0) {
                            availableOptions[item.Name] = item.DefaultStr;
                            optionTypes[item.Name] = item.Type;
                            required[item.Name] = item.Required;
                        }
                    });
                }
                
                // Merge template params with defaults
                const mergedFormValues = { ...availableOptions, ...templateParams };
                
                // Validate the merged values
                const validation = this.validateFormValues(mergedFormValues, optionTypes, required);
                
                // Set all state at once
                this.setState({
                    drivePrefix: templateType,
                    formValues: mergedFormValues,
                    optionTypes: optionTypes,
                    isValid: validation.isValid,
                    formErrors: validation.formErrors,
                    required: required,
                    showTemplateModal: false
                });
                
                toast.success(`Template "${template.name}" imported successfully!`);
            }
        } catch (error) {
            console.error('Failed to import template:', error);
            const errorMsg = error.response?.data?.error || error.message || 'Unknown error';
            toast.error(`Failed to import template: ${errorMsg}`);
        }
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
                                    <span> Since you're accessing from a remote computer, you need either to authenticate using the text fields (Client ID and Client Secret) or install the <strong><a href="#" onClick={(e) => { e.preventDefault(); this.toggleAuthHelperModal(); }} style={{color: '#0066cc', textDecoration: 'underline'}}>Rclone Auth Helper App</a></strong> on your local machine to catch the OAuth redirect.</span>
                                ) : (
                                    <span> You can authenticate using the button above or manually enter your Client ID and Client Secret in the text fields below.</span>
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
                                        {this.state.testResults.tested && (
                                            <div style={{marginTop: "10px", fontSize: "12px"}}>
                                                {this.state.testResults.connectionTest === true && (
                                                    <div className="text-success"><i className="fa fa-check-circle"/> Connection OK</div>
                                                )}
                                                {this.state.testResults.connectionTest === false && (
                                                    <div className="text-danger"><i className="fa fa-times-circle"/> Connection failed</div>
                                                )}
                                                {this.state.testResults.error && (
                                                    <div className="text-danger" style={{marginTop: "5px", fontSize: "11px"}}>{this.state.testResults.error}</div>
                                                )}
                                            </div>
                                        )}
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
                                        {this.state.testResults.tested && (
                                            <div style={{marginTop: "10px", fontSize: "12px"}}>
                                                {this.state.testResults.connectionTest === true && (
                                                    <div className="text-success"><i className="fa fa-check-circle"/> Connection OK</div>
                                                )}
                                                {this.state.testResults.connectionTest === false && (
                                                    <div className="text-danger"><i className="fa fa-times-circle"/> Connection failed</div>
                                                )}
                                                {this.state.testResults.error && (
                                                    <div className="text-danger" style={{marginTop: "5px", fontSize: "11px"}}>{this.state.testResults.error}</div>
                                                )}
                                            </div>
                                        )}
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
                                                {this.state.testResults.error && (
                                                    <tr>
                                                        <td colSpan="2">
                                                            <div className="alert alert-danger mb-0 mt-2">
                                                                <strong>Error:</strong> {this.state.testResults.error}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
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
                                        <a href="#" 
                                           onClick={(e) => { e.preventDefault(); this.toggleOAuthPortModal(); this.toggleAuthHelperModal(); }}
                                           style={{color: '#0066cc', fontWeight: 'bold'}}>
                                            Download Rclone Auth Helper
                                        </a>
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
