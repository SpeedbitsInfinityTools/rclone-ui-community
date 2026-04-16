import axiosInstance from "../../../utils/API/API";
import {findFromConfig, isEmpty, supportsOAuth} from "../../../utils/Tools";
import {toast} from "react-toastify";
import urls from "../../../utils/API/endpoint";
import {getTemplates, getTemplate} from "../../../utils/API/director";

export async function testRemoteConnection() {
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
            
            // Azure: validate sas_url doesn't contain a raw connection string
            if (drivePrefix === 'azureblob') {
                const sasVal = finalParameterValues.sas_url || '';
                const connStringMarkers = ['BlobEndpoint=', 'SharedAccessSignature=', 'QueueEndpoint=',
                    'FileEndpoint=', 'TableEndpoint=', 'AccountKey=', 'AccountName=', 'DefaultEndpointsProtocol='];
                if (sasVal && connStringMarkers.some(m => sasVal.includes(m))) {
                    const parsed = this.parseAzureSasInput(sasVal);
                    if (parsed && parsed.key) {
                        finalParameterValues.account = parsed.account || '';
                        finalParameterValues.key = parsed.key;
                        finalParameterValues.sas_url = '';
                        toast.info(`Auto-corrected: detected ${parsed.type} - using Account Key auth`);
                    } else if (parsed) {
                        finalParameterValues.sas_url = parsed.sasUrl;
                        if (parsed.account) finalParameterValues.account = parsed.account;
                        delete finalParameterValues.key;
                        toast.info(`Auto-corrected: detected ${parsed.type} in SAS URL field`);
                    } else {
                        this.setState(prev => ({
                            testingConnection: false,
                            testResults: {...prev.testResults, connectionTest: false, error: "The SAS URL field contains a connection string that could not be parsed. Please paste only the 'Blob service SAS URL' (starts with https://)."}
                        }));
                        toast.error("Invalid SAS URL - contains unparseable connection string");
                        return;
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
            
            // Helper: axios call with 30s timeout
            const testRequest = (url, body) => Promise.race([
                axiosInstance.post(url, body),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Test timed out after 30 seconds')), 30000))
            ]);

            // Now test the saved remote
            // Test 1: Connection - list root (more reliable than about)
            // Use "" not "/" — bucket-based backends (Azure, S3, etc.) return empty for "/"
            let rootItems = [];
            try {
                const listResp = await testRequest(urls.getFilesList, {
                    fs: `${driveName}:`,
                    remote: ""
                });
                rootItems = listResp?.data?.list || [];
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
                await testRequest(urls.getFilesList, {
                    fs: `${driveName}:`,
                    remote: ""
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
            
            // Test 3: Write - Upload a small test file and delete it
            try {
                const testFileName = 'rclone-write-test-can-be-deleted.txt';
                const testFs = `${driveName}:`;
                let uploadDir = '';

                // Container-based remotes: can't upload to account root, need an existing container
                const isContainerBased = ['azureblob', 'azurefiles', 's3', 'gcs', 'b2'].includes(drivePrefix);
                if (isContainerBased) {
                    const firstContainer = rootItems.find(item => 
                        item.IsDir && !item.Name?.startsWith('rclone-')
                    ) || rootItems.find(item => item.IsDir);
                    if (firstContainer) {
                        uploadDir = firstContainer.Path || firstContainer.Name;
                    } else {
                        // No containers exist - skip write test with explanation
                        this.setState(prev => ({
                            testResults: {...prev.testResults, writeTest: null, error: "Write test skipped: no containers/buckets found. Create at least one container in your storage account first."}
                        }));
                        return;
                    }
                }

                // Upload a small test file
                const blob = new Blob(
                    ['This is a test file to verify write access to your cloud storage. You can safely delete this file.\n'],
                    { type: 'text/plain' }
                );
                const formData = new FormData();
                formData.append('file0', blob, testFileName);

                await testRequest(
                    `${urls.uploadFile}?fs=${encodeURIComponent(testFs)}&remote=${encodeURIComponent(uploadDir)}`,
                    formData
                );

                // Cleanup: delete the test file
                const deleteRemote = uploadDir ? `${uploadDir}/${testFileName}` : testFileName;
                await testRequest(urls.deleteFile, { fs: testFs, remote: deleteRemote }).catch(() => {
                    toast.warn(`Write test passed, but cleanup failed. You may see a leftover '${testFileName}' file.`);
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
    }


export function gotoNextStep() {
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
    }

export function gotoPrevStep() {
        const {currentStepNumber} = this.state;
        this.setCurrentStep(currentStepNumber - 1);
    }


export function setCurrentStep(stepNo) {
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
    }

    /**
     * Show cancel confirmation modal
     */
export function handleCancel() {
        this.setState({ showCancelModal: true });
    }

    /**
     * Toggle cancel confirmation modal
     */
export function toggleCancelModal() {
        this.setState({ showCancelModal: !this.state.showCancelModal });
    }

    /**
     * Confirm cancel and navigate to dashboard
     */
export function confirmCancel() {
        this.props.history.push('/dashboard');
    }

export async function toggleTemplateModal() {
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
    }

export async function handleImportTemplate(template) {
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
    }
