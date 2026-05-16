import React from 'react';
import {Button, Col, FormFeedback, FormGroup, Input, InputGroup, InputGroupText, Label} from "reactstrap";
import {findFromConfig, isEmpty, supportsOAuth} from "../../../utils/Tools";

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
export function DriveParameters({drivePrefix, loadAdvanced, changeHandler, currentValues, isValidMap, errorsMap = {}, config, onOAuthAuthenticate, oauthAuthenticating, oauthAccountInfo, oauthAuthenticated, onRevokeAuth, oauthIsLocalMachine, onTestLocalApp, oauthStatusMessages = [], onOpenAuthHelper, testingAuthHelper, showManualTokenEntry, manualTokenInput, onToggleManualToken, onManualTokenChange, onManualTokenSubmit}) {
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
                        const excludedProviders = attr.Provider.substring(1).split(",");
                        showField = !excludedProviders.includes(selectedProvider);
                    } else {
                        const includedProviders = attr.Provider.split(",");
                        showField = includedProviders.includes(selectedProvider);
                    }
                }
                
                if (attr.Hide === 0 && showField && ((loadAdvanced && attr.Advanced) || (!loadAdvanced && !attr.Advanced))) {
                    let labelValue = `${attr.Help}`;
                    if (selectedProvider && selectedProvider !== "AWS") {
                        labelValue = labelValue
                            .replace(/Get AWS credentials/g, 'Get credentials')
                            .replace(/AWS Access Key ID/g, 'Access Key ID')
                            .replace(/AWS Secret Access Key/g, 'Secret Access Key')
                            .replace(/AWS S3/g, 'S3')
                            .replace(/\(AWS\)/g, '')
                            .replace(/EC2\/ECS/g, 'runtime environment');
                    }
                    
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
                        if (attr.Name === "endpoint" && selectedProvider === "Other") {
                            inputType = "text";
                        } else {
                            inputType = "select";
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
                        if (attr.Type === "int") {
                            inputType = "number";
                        } else if (attr.Type === "string") {
                            inputType = "text";
                        } else {
                            inputType = "text";
                        }
                    }
                    
                    let placeholder = "";
                    if (attr.Name === "endpoint" && selectedProvider === "Other") {
                        placeholder = "https://your-provider-endpoint.com";
                    } else if (attr.Name === "access_key_id") {
                        placeholder = "Enter your Access Key ID";
                    } else if (attr.Name === "secret_access_key") {
                        placeholder = "Enter your Secret Access Key";
                    }
                    
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
                                                                <li>
                                                                    Download and install{' '}
                                                                    <button
                                                                        type="button"
                                                                        onClick={onOpenAuthHelper}
                                                                        style={{color: '#0066cc', textDecoration: 'underline', background: 'none', border: 'none', padding: 0, cursor: 'pointer'}}
                                                                    >
                                                                        Rclone Auth Helper
                                                                    </button>{' '}
                                                                    on your local computer
                                                                </li>
                                                                <li>Start the application</li>
                                                                <li>Click the "Authenticate" button below</li>
                                                                <li>The helper app will catch the OAuth redirect and forward it to the server</li>
                                                            </ol>
                                                        </div>
                                                        <div style={{textAlign: 'center', marginTop: '15px'}}>
                                                            <button
                                                                type="button"
                                                                onClick={onOpenAuthHelper}
                                                                style={{display: 'inline-block', marginBottom: '10px', color: '#0066cc', textDecoration: 'underline', background: 'none', border: 'none', padding: 0, cursor: 'pointer'}}
                                                            >
                                                                <i className="fa fa-download" style={{marginRight: '5px'}}></i>
                                                                Download Rclone Auth Helper
                                                            </button>
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

/**
 * Functional Component. Custom input for selecting a new name for the current config.
 */
export function CustomInput({key, id, label, changeHandler, type, value, name, placeholder, isValid = false}) {
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
