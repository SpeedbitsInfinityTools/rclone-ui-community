import React, {useState} from 'react';
import {
    Button,
    Col,
    FormFeedback,
    FormGroup,
    Input,
    Label,
    Modal,
    ModalBody,
    ModalFooter,
    ModalHeader,
    Row,
    InputGroup,
    Spinner,
    ListGroup,
    ListGroupItem,
    Badge
} from 'reactstrap';
import RemotesList from "../Explorer/RemotesList";
import * as PropTypes from "prop-types"
import {mountOptions, vfsOptions} from "../../utils/MountOptions";
import {isEmpty, validateDuration, validateInt, validateSizeSuffix} from "../../utils/Tools";
import {toast} from "react-toastify";
import {createMount as directorCreateMount} from "../../utils/API/director";
import axiosInstance from "../../utils/API/API";

const OptionFormInput = ({attr, changeHandler, currentValues, isValidMap, errorsMap}) => {
    const labelValue = `${attr.Name}`;
    const requiredValue = ((attr.Required) ? (<i className={"text-red"}>*</i>) : null);

    const hasExamples = !isEmpty(attr.Examples);
    let examplesMap = null;

    let inputType = "";

    if(attr.Options || inputType === 'options') {
        inputType = "select";
        examplesMap = attr.Options.map(a => (<option key={a.key} value={a.key}>{a.value}</option>));
    } else if (attr.IsPassword) {
        inputType = "password";
    } else if (hasExamples) {
        inputType = "string";
    } else if (attr.Type === "bool") {
        inputType = "select";
        examplesMap = [
            (<option key={1} value={true}>Yes</option>),
            (<option key={2} value={false}>No</option>)
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
    return (
        <FormGroup row>
            <Label for={attr.Name} sm={5}>{labelValue}{requiredValue}</Label>
            <Col sm={7}>
                <Input type={inputType} value={currentValues[attr.Name] || attr.Default }
                       name={attr.Name} valid={isValidMap[attr.Name]} invalid={!isValidMap[attr.Name]}
                       id={attr.Name} onChange={changeHandler} required={attr.Required}>
                    {examplesMap}
                </Input>
                <FormFeedback>{errorsMap[attr.Name]}</FormFeedback>

            </Col>
        </FormGroup>
    );
}


const MountOptions = ({changeHandler, currentValues, isValidMap, errorsMap, options, setCurrentValues}) => {
    const output = [];
    for(const opt in options) {
        if(options.hasOwnProperty(opt)) {
            output.push(<OptionFormInput
                key={opt}
                attr={{Name: opt, ...options[opt]}}
                changeHandler={(e) => {
                    e && e.preventDefault();
                    changeHandler(e, options[opt], currentValues, setCurrentValues);
                }}
                currentValues={currentValues}
                errorsMap={errorsMap}
                isValidMap={isValidMap}/>);
        }
    }
    return output;
}

/**
 * New Mount Modal shows a button for opening a modal for new mount and then executes okHandle when positive
 * button is clicked
 * @param props
 * @returns {*}
 * @constructor
 */
const NewMountModal = (props) => {
    const {
        buttonLabel,
        className,
        okHandle,
        refreshList

    } = props;

    const [modal, setModal] = useState(false);

    const [mountFs, setMountFs] = useState("");
    
    const [sourceSubfolder, setSourceSubfolder] = useState(""); // New: subfolder within remote

    const [mountPoint, setMountPoint] = useState("");

    const [showAdvanced, setShowAdvanced] = useState(false);
    
    const [permanent, setPermanent] = useState(true); // Default to permanent (survives reboot)
    
    // Bandwidth limiting
    const [bandwidthLimit, setBandwidthLimit] = useState(0); // 0 = unlimited
    const [bandwidthUnit, setBandwidthUnit] = useState("M"); // K, M, G
    
    // Browse folders
    const [browsing, setBrowsing] = useState(false);
    const [showBrowser, setShowBrowser] = useState(false);
    const [browserItems, setBrowserItems] = useState([]);
    const [browserPath, setBrowserPath] = useState(""); // Current path in browser
    
    // Test connection
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);
    
    // Creating mount
    const [isCreating, setIsCreating] = useState(false);
    
    // Mount result modal
    const [showMountResultModal, setShowMountResultModal] = useState(false);
    const [mountResultMessages, setMountResultMessages] = useState([]);

    const [formErrors, setFormErrors] = useState((() => {
        const output = {};
        for(const opt in vfsOptions) {
            output[opt] = "";
        }
        for(const opt in mountOptions) {
            output[opt] = "";
        }
        return output;
    })());

    const [isValid, setIsValid] = useState((() => {
        const output = {};
        for(const opt in vfsOptions) {
            output[opt] = true;
        }
        for(const opt in mountOptions) {
            output[opt] = true;
        }
        return output;
    })());

    const [vfsOptionsValues, setVfsOptionsValues] = useState({});

    const [mountOptionsValues, setMountOptionsValues] = useState({});

    const toggle = () => {
        setModal(!modal);
        // Reset advanced options when closing the modal
        if (modal) {
            setShowAdvanced(false);
            setShowBrowser(false);
            setBrowserItems([]);
            setBrowserPath("");
            setSourceSubfolder("");
            setTestResult(null);
        }
    };
    
    // Normalize subfolder path (remove leading/trailing slashes and prevent path traversal)
    const normalizeSubfolderPath = (path) => {
        if (!path || path.trim() === '') return '';
        
        // Remove leading/trailing slashes and whitespace
        let normalized = path.trim().replace(/^\/+/, '').replace(/\/+$/, '');
        
        // Security: Prevent path traversal attacks (../, ../../, etc.)
        if (normalized.includes('..')) {
            toast.error('Invalid path: ".." is not allowed for security reasons');
            return '';
        }
        
        // Security: Prevent absolute paths and special characters
        if (normalized.startsWith('/') || normalized.includes('\\')) {
            toast.error('Invalid path: Absolute paths and backslashes are not allowed');
            return '';
        }
        
        return normalized;
    };
    
    // Browse folders in the remote
    const browseFolders = async (path = '') => {
        if (!mountFs) {
            toast.warning("Please select a remote first");
            return;
        }
        
        setBrowsing(true);
        setShowBrowser(true);
        
        try {
            // Construct the full FS path correctly
            // If mountFs already contains a path (e.g., "hetzners3:bucket"), use it as-is
            // Otherwise, treat it as just the remote name
            const normalizedPath = normalizeSubfolderPath(path);
            
            if (!normalizedPath && normalizedPath !== path.trim()) {
                // normalization failed (security issue detected)
                setBrowsing(false);
                setShowBrowser(false);
                return;
            }
            
            // Check if mountFs already has a path component (contains : followed by something)
            const colonIndex = mountFs.indexOf(':');
            let fullFs;
            
            if (colonIndex === -1) {
                // No colon - add one
                fullFs = normalizedPath ? `${mountFs}:${normalizedPath}` : `${mountFs}:`;
            } else if (colonIndex === mountFs.length - 1) {
                // Ends with colon (e.g., "remote:")
                fullFs = normalizedPath ? `${mountFs}${normalizedPath}` : mountFs;
            } else {
                // Has colon with path (e.g., "remote:bucket")
                fullFs = normalizedPath ? `${mountFs}/${normalizedPath}` : mountFs;
            }
            
            const response = await axiosInstance.post('operations/list', {
                fs: fullFs,
                remote: ''
            });
            
            const items = response.data.list || [];
            // Only show directories
            const directories = items.filter(item => item.IsDir);
            
            setBrowserItems(directories);
            setBrowserPath(normalizedPath);
        } catch (error) {
            const errorMsg = error.response?.data?.error || error.message;
            toast.error(`Failed to browse folders: ${errorMsg}`);
            setShowBrowser(false);
        } finally {
            setBrowsing(false);
        }
    };
    
    // Test mount connection
    const testConnection = async () => {
        if (!mountFs) {
            toast.warning("Please select a remote first");
            return;
        }
        
        setTesting(true);
        setTestResult(null);
        
        try {
            const normalizedSubfolder = normalizeSubfolderPath(sourceSubfolder);
            
            if (!normalizedSubfolder && normalizedSubfolder !== sourceSubfolder.trim() && sourceSubfolder.trim() !== '') {
                // normalization failed (security issue detected)
                setTesting(false);
                return;
            }
            
            // Construct the full FS path correctly (same logic as browseFolders)
            const colonIndex = mountFs.indexOf(':');
            let finalFs;
            
            if (colonIndex === -1) {
                // No colon - add one
                finalFs = normalizedSubfolder ? `${mountFs}:${normalizedSubfolder}` : `${mountFs}:`;
            } else if (colonIndex === mountFs.length - 1) {
                // Ends with colon (e.g., "remote:")
                finalFs = normalizedSubfolder ? `${mountFs}${normalizedSubfolder}` : mountFs;
            } else {
                // Has colon with path (e.g., "remote:bucket")
                finalFs = normalizedSubfolder ? `${mountFs}/${normalizedSubfolder}` : mountFs;
            }
            
            const result = {
                connection: false,
                read: false,
                write: false,
                error: null
            };
            
            // Test 1: Connection & Read (list root)
            try {
                const listResponse = await axiosInstance.post('operations/list', {
                    fs: finalFs,
                    remote: ''
                });
                result.connection = true;
                result.read = Array.isArray(listResponse.data.list);
            } catch (error) {
                result.error = error.response?.data?.error || error.message;
                setTestResult(result);
                return;
            }
            
            // Test 2: Write (create and delete test directory)
            try {
                const testDirName = `.rclone-mount-test-${Date.now()}`;
                await axiosInstance.post('operations/mkdir', {
                    fs: finalFs,
                    remote: testDirName
                });
                
                // Clean up test directory using rmdir (safer than purge)
                try {
                    await axiosInstance.post('operations/rmdir', {
                        fs: finalFs,
                        remote: testDirName
                    });
                } catch (cleanupError) {
                    // Ignore cleanup errors
                    console.warn('Failed to cleanup test directory:', cleanupError);
                }
                
                result.write = true;
            } catch (writeError) {
                // Write test failed - might be read-only, which is OK
                result.write = false;
            }
            
            setTestResult(result);
            
            if (result.connection && result.read) {
                toast.success("Connection test successful!");
            }
        } catch (error) {
            const errorMsg = error.response?.data?.error || error.message;
            setTestResult({
                connection: false,
                read: false,
                write: false,
                error: errorMsg
            });
            toast.error(`Connection test failed: ${errorMsg}`);
        } finally {
            setTesting(false);
        }
    };

    const handleCreateMount = async () => {
        if (!okHandle) {
            throw new Error("Ok handle is null");
        }

        // Check if we have backend URL configured
        const backendUrl = sessionStorage.getItem('ipAddress');
        
        if (!backendUrl) {
            toast.error("Session expired. Please log in again.", { autoClose: false });
            window.location.href = '/#/login';
            return;
        }

        // Set loading state
        setIsCreating(true);

        // Collect messages to show in modal
        const messages = [];

        // For mount points in system directories, show warning about permissions
        if (mountPoint.startsWith('/mnt/') || mountPoint.startsWith('/media/')) {
            messages.push({
                type: 'info',
                text: `Mounting to system directory: ${mountPoint}. If the directory doesn't exist, create it manually: sudo mkdir -p ${mountPoint} && sudo chown $USER:$USER ${mountPoint}`
            });
        }

        // Add allow_other to mount options to allow all users (including root) to access the mount
        const finalMountOptions = {
            ...mountOptionsValues,
            AllowOther: true  // Enable access for all users (requires user_allow_other in /etc/fuse.conf)
        };
        
        // Add bandwidth limit if specified (0 = unlimited)
        if (bandwidthLimit > 0) {
            // Convert to rclone format: number + unit (e.g., "10M", "500K", "2G")
            finalMountOptions.BwLimit = `${bandwidthLimit}${bandwidthUnit}`;
        }

        // Proceed with mounting
        try {
            // Construct final FS with subfolder if specified (same logic as browseFolders and testConnection)
            const normalizedSubfolder = normalizeSubfolderPath(sourceSubfolder);
            
            if (!normalizedSubfolder && normalizedSubfolder !== sourceSubfolder.trim() && sourceSubfolder.trim() !== '') {
                // normalization failed (security issue detected)
                messages.push({
                    type: 'error',
                    text: "Invalid subfolder path. Please check and try again."
                });
                setMountResultMessages(messages);
                setShowMountResultModal(true);
                return;
            }
            
            const colonIndex = mountFs.indexOf(':');
            let fs;
            
            if (colonIndex === -1) {
                // No colon - add one
                fs = normalizedSubfolder ? `${mountFs}:${normalizedSubfolder}` : `${mountFs}:`;
            } else if (colonIndex === mountFs.length - 1) {
                // Ends with colon (e.g., "remote:")
                fs = normalizedSubfolder ? `${mountFs}${normalizedSubfolder}` : mountFs;
            } else {
                // Has colon with path (e.g., "remote:bucket")
                fs = normalizedSubfolder ? `${mountFs}/${normalizedSubfolder}` : mountFs;
            }
            
            // Get the currently selected server ID from localStorage
            const currentServerId = localStorage.getItem('RCLONE_LAST_SERVER_ID');
            
            // Use Rclone Director API for enhanced mount creation with persistence support
            await directorCreateMount({
                fs,
                mountPoint,
                mountType: "",
                vfsOpt: vfsOptionsValues,
                mountOpt: finalMountOptions,
                permanent,  // Will survive reboot if true
                serverId: currentServerId  // Use the currently selected server
            });
            
            const permanentText = permanent ? "permanent - survives reboot" : "temporary";
            const bandwidthText = bandwidthLimit > 0 ? `, bandwidth: ${bandwidthLimit}${bandwidthUnit}/s` : "";
            const successMsg = `Successfully mounted ${fs} to ${mountPoint} (${permanentText}${bandwidthText})`;
            messages.push({
                type: 'success',
                text: successMsg
            });
            
            // Show result modal with all messages
            setMountResultMessages(messages);
            setShowMountResultModal(true);
            
            // Close the mount creation modal on success
            toggle();
            
            // Refresh the mount list to show the new mount
            if (refreshList) {
                refreshList();
            }
        } catch (mountError) {
            const mountErrorMsg = mountError.response?.data?.error || mountError.message;
            messages.push({
                type: 'error',
                text: `Failed to create mount: ${mountErrorMsg}`
            });
            setMountResultMessages(messages);
            setShowMountResultModal(true);
        } finally {
            // Always reset loading state
            setIsCreating(false);
        }
    }
    
    const closeMountResultModal = () => {
        setShowMountResultModal(false);
        setMountResultMessages([]);
    }

    const isCreateDisabled = () => {
        return !mountFs || !mountPoint || isCreating;
    }

    /**
     * Handle init change and set appropriate errors.
     * @param e
     * @param option
     * @param formValues
     * @param setFormValues
     */
    const handleInputChange = (e, option, formValues, setFormValues) => {

        let inputName = e.target.name;
        let inputValue = e.target.value;
        const inputType = option.Type;
        if(inputType === "bool") {
            inputValue = inputValue === "true"
        }else if (inputType === "int") {
            inputValue = parseInt(inputValue);
        }
        setFormValues({
            ...formValues,
            [inputName]: inputValue
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

        if (option.Required && (!inputValue || inputValue === "")) {
            validateResult = false;
            if (!validateResult) {
                error += " This field is required";
            }
        }
        setFormErrors({
            ...formErrors,
            [inputName]: error
        });

        setIsValid({
            ...isValid,
            [inputName]: validateResult
        });
    };

    // Helper to generate safe mount point name
    const generateMountPoint = (remoteName) => {
        if (!remoteName) return '';
        const safeName = remoteName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        return `/mnt/${safeName}`;
    };

    // Auto-suggest mount point when Fs is selected
    React.useEffect(() => {
        if (mountFs && !mountPoint) {
            setMountPoint(generateMountPoint(mountFs));
        }
    }, [mountFs, mountPoint]);

    return (
        <div data-test="newMountModalComponent">
            <Button color="primary" onClick={toggle}>{buttonLabel}</Button>
            <Modal isOpen={modal} toggle={toggle} className={className} size={showAdvanced ? "xl" : "lg"} backdrop="static">
                <ModalHeader toggle={toggle}>New Mount</ModalHeader>
                <ModalBody>
                    <FormGroup row>
                        <Label for={"mountFs"} sm={3}><strong>Remote / Filesystem</strong></Label>
                        <Col sm={9}>
                            <RemotesList
                                remoteName={mountFs}
                                alwaysRenderSuggestions={false}
                                immediateUpdate={true}
                                handleChangeRemoteName={(name) => {
                                    setMountFs(name);
                                    if (!mountPoint || mountPoint.startsWith('/mnt/')) {
                                        setMountPoint(generateMountPoint(name));
                                    }
                                    // Reset subfolder when remote changes
                                    setSourceSubfolder("");
                                    setShowBrowser(false);
                                    setBrowserItems([]);
                                    setTestResult(null);
                                }}
                            />
                            <small className="form-text text-muted">
                                Select the remote you want to mount
                            </small>
                            <FormFeedback/>
                        </Col>
                    </FormGroup>
                    
                    {mountFs && <FormGroup row>
                        <Label for={"sourceSubfolder"} sm={3}><strong>Source Subfolder</strong></Label>
                        <Col sm={9}>
                            <InputGroup>
                                <Input 
                                    type="text" 
                                    id="sourceSubfolder"
                                    name="sourceSubfolder"
                                    value={sourceSubfolder}
                                    onChange={(e) => {
                                        setSourceSubfolder(e.target.value);
                                        setTestResult(null);
                                    }}
                                    placeholder="Leave empty to mount entire remote"
                                />
                                <Button 
                                    color="info" 
                                    onClick={() => browseFolders(sourceSubfolder)}
                                    disabled={browsing || !mountFs}
                                >
                                    {browsing ? <><Spinner size="sm" /> Browsing...</> : <><i className="fa fa-folder-open"/> Browse</>}
                                </Button>
                            </InputGroup>
                            <small className="form-text text-muted">
                                💡 Optional: Enter folder path (e.g., "bucket1" or "bucket1/folder"). Leading/trailing slashes are handled automatically.
                                Click <strong>Browse</strong> to explore available folders.
                            </small>
                            
                            {showBrowser && (
                                <div style={{marginTop: '10px', border: '1px solid #ddd', borderRadius: '4px', maxHeight: '300px', overflowY: 'auto'}}>
                                    <div style={{padding: '10px', backgroundColor: '#f8f9fa', borderBottom: '1px solid #ddd'}}>
                                        <strong>📁 Browse Folders</strong>
                                        {browserPath && (
                                            <>
                                                {' '}<Badge color="secondary">{browserPath}</Badge>
                                                <Button 
                                                    color="link" 
                                                    size="sm" 
                                                    onClick={() => {
                                                        // Go up one level
                                                        const parts = browserPath.split('/');
                                                        parts.pop();
                                                        const parentPath = parts.join('/');
                                                        browseFolders(parentPath);
                                                    }}
                                                >
                                                    <i className="fa fa-arrow-up"/> Up
                                                </Button>
                                            </>
                                        )}
                                        <Button 
                                            color="link" 
                                            size="sm" 
                                            className="float-right"
                                            onClick={() => setShowBrowser(false)}
                                        >
                                            <i className="fa fa-times"/> Close
                                        </Button>
                                    </div>
                                    {browserItems.length === 0 ? (
                                        <div style={{padding: '20px', textAlign: 'center', color: '#999'}}>
                                            No folders found
                                        </div>
                                    ) : (
                                        <ListGroup flush>
                                            {browserItems.map((item, idx) => {
                                                const itemPath = browserPath ? `${browserPath}/${item.Name}` : item.Name;
                                                return (
                                                    <ListGroupItem 
                                                        key={idx} 
                                                        style={{cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}
                                                        hover
                                                    >
                                                        <span>
                                                            <i className="fa fa-folder" style={{color: '#ffc107', marginRight: '8px'}}/>
                                                            {item.Name}
                                                        </span>
                                                        <div>
                                                            <Button 
                                                                color="info" 
                                                                size="sm"
                                                                onClick={() => browseFolders(itemPath)}
                                                                style={{marginRight: '5px'}}
                                                            >
                                                                <i className="fa fa-folder-open"/> Open
                                                            </Button>
                                                            <Button 
                                                                color="success" 
                                                                size="sm"
                                                                onClick={() => {
                                                                    setSourceSubfolder(itemPath);
                                                                    setShowBrowser(false);
                                                                    toast.success(`Selected: ${itemPath}`);
                                                                }}
                                                            >
                                                                <i className="fa fa-check"/> Select
                                                            </Button>
                                                        </div>
                                                    </ListGroupItem>
                                                );
                                            })}
                                        </ListGroup>
                                    )}
                                </div>
                            )}
                            
                            <div style={{marginTop: '10px'}}>
                                <Button 
                                    color="primary" 
                                    size="sm"
                                    onClick={testConnection}
                                    disabled={testing || !mountFs}
                                >
                                    {testing ? <><Spinner size="sm" /> Testing...</> : <><i className="fa fa-plug"/> Test Connection</>}
                                </Button>
                            </div>
                            
                            {testResult && (
                                <div style={{marginTop: '10px', padding: '10px', backgroundColor: testResult.connection ? '#d4edda' : '#f8d7da', border: '1px solid ' + (testResult.connection ? '#c3e6cb' : '#f5c6cb'), borderRadius: '4px'}}>
                                    <strong>✅ Test Results:</strong>
                                    <ul style={{marginBottom: 0, paddingLeft: '20px'}}>
                                        <li>Connection: {testResult.connection ? <Badge color="success">Success</Badge> : <Badge color="danger">Failed</Badge>}</li>
                                        <li>Read: {testResult.read ? <Badge color="success">Success</Badge> : <Badge color="warning">Failed</Badge>}</li>
                                        <li>Write: {testResult.write ? <Badge color="success">Success</Badge> : <Badge color="warning">Failed</Badge>}</li>
                                        {testResult.error && <li style={{color: '#721c24'}}>Error: {testResult.error}</li>}
                                    </ul>
                                </div>
                            )}
                        </Col>
                    </FormGroup>}
                    
                    {mountFs && <FormGroup row>
                        <Label for={"mountPoint"} sm={3} style={{fontWeight: 'bold', color: '#000'}}>Mount Point *</Label>
                        <Col sm={9}>
                            <Input type={"text"} value={mountPoint}
                                   name={"mountPoint"}
                                   id={"mountPoint"} 
                                   onChange={e => setMountPoint(e.target.value)} 
                                   required={true}
                                   style={{
                                       border: '2px solid #20a8d8',
                                       fontWeight: 'bold',
                                       fontSize: '16px'
                                   }}>

                            </Input>
                            <small className="form-text text-muted">
                                Path where the remote will be mounted. For /mnt/ locations, you may need to create the directory manually with sudo.
                            </small>
                            <FormFeedback/>

                        </Col>
                    </FormGroup>}
                    
                    {mountFs && <FormGroup row>
                        <Label sm={3}></Label>
                        <Col sm={9}>
                            <FormGroup check>
                                <Label check>
                                    <Input 
                                        type="checkbox" 
                                        checked={permanent} 
                                        onChange={(e) => setPermanent(e.target.checked)}
                                    />
                                    {' '}
                                    <strong>Permanent (survives reboot)</strong>
                                </Label>
                                <small className="form-text text-muted" style={{marginTop: '5px'}}>
                                    When checked, this mount will be automatically recreated after system reboot. 
                                    Perfect for backup systems that need persistent access to cloud storage.
                                </small>
                            </FormGroup>
                        </Col>
                    </FormGroup>}
                    
                    {mountFs && <FormGroup row>
                        <Label for={"bandwidthLimit"} sm={3}><strong>Bandwidth Limit</strong></Label>
                        <Col sm={9}>
                            <div style={{display: 'flex', gap: '10px', alignItems: 'center'}}>
                                <Input 
                                    type="number" 
                                    id="bandwidthLimit"
                                    name="bandwidthLimit"
                                    min="0"
                                    step="1"
                                    value={bandwidthLimit}
                                    onChange={(e) => setBandwidthLimit(parseInt(e.target.value) || 0)}
                                    style={{flex: '1', maxWidth: '150px'}}
                                    placeholder="0"
                                />
                                <Input 
                                    type="select" 
                                    value={bandwidthUnit}
                                    onChange={(e) => setBandwidthUnit(e.target.value)}
                                    style={{flex: '0 0 80px'}}
                                >
                                    <option value="K">KB/s</option>
                                    <option value="M">MB/s</option>
                                    <option value="G">GB/s</option>
                                </Input>
                            </div>
                            <small className="form-text text-muted">
                                Limit bandwidth for this mount. Set to 0 for unlimited speed. Example: 10 MB/s will limit transfers to 10 megabytes per second.
                            </small>
                        </Col>
                    </FormGroup>}

                    {!showAdvanced && mountFs && (
                        <div className="text-center mt-3 mb-3">
                            <Button color="info" onClick={() => setShowAdvanced(true)}>
                                Open Advanced Settings
                            </Button>
                        </div>
                    )}

                    {showAdvanced && (
                        <Row>
                            <Col lg={6}>
                                <p><strong>Mount Options</strong></p>
                                <MountOptions
                                    isValidMap={isValid}
                                    errorsMap={formErrors}
                                    currentValues={mountOptionsValues}
                                    setCurrentValues={setMountOptionsValues}
                                    changeHandler={handleInputChange}
                                    options={mountOptions}
                                />
                            </Col>

                            <Col lg={6}>
                                <p><strong>VFS Options</strong></p>
                                <MountOptions
                                    isValidMap={isValid}
                                    errorsMap={formErrors}
                                    currentValues={vfsOptionsValues}
                                    setCurrentValues={setVfsOptionsValues}
                                    changeHandler={handleInputChange}
                                    options={vfsOptions}
                                />
                            </Col>
                        </Row>
                    )}

                </ModalBody>
                <ModalFooter>
                    <Button data-test="ok-button" color="primary" onClick={handleCreateMount}
                            disabled={isCreateDisabled()}>
                        {isCreating ? (
                            <><i className="fa fa-spinner fa-spin"></i> Creating Mount...</>
                        ) : (
                            'Create'
                        )}
                    </Button>{' '}
                    <Button data-test="cancel-button" color="secondary" onClick={toggle} disabled={isCreating}>Cancel</Button>
                </ModalFooter>
            </Modal>
            
            {/* Mount Result Modal */}
            <Modal isOpen={showMountResultModal} toggle={closeMountResultModal} backdrop={true}>
                <ModalHeader toggle={closeMountResultModal}>Mount Operation Result</ModalHeader>
                <ModalBody>
                    {mountResultMessages.map((msg, index) => (
                        <div key={index} style={{ marginBottom: '15px' }}>
                            {msg.type === 'success' && (
                                <div style={{ padding: '10px', backgroundColor: '#d4edda', border: '1px solid #c3e6cb', borderRadius: '4px' }}>
                                    <strong style={{ color: '#155724' }}>✅ Success:</strong>
                                    <p style={{ margin: '5px 0 0 0', color: '#155724' }}>{msg.text}</p>
                                </div>
                            )}
                            {msg.type === 'info' && (
                                <div style={{ padding: '10px', backgroundColor: '#d1ecf1', border: '1px solid #bee5eb', borderRadius: '4px' }}>
                                    <strong style={{ color: '#0c5460' }}>ℹ️ Information:</strong>
                                    <p style={{ margin: '5px 0 0 0', color: '#0c5460' }}>{msg.text}</p>
                                </div>
                            )}
                            {msg.type === 'error' && (
                                <div style={{ padding: '10px', backgroundColor: '#f8d7da', border: '1px solid #f5c6cb', borderRadius: '4px' }}>
                                    <strong style={{ color: '#721c24' }}>❌ Error:</strong>
                                    <p style={{ margin: '5px 0 0 0', color: '#721c24' }}>{msg.text}</p>
                                </div>
                            )}
                        </div>
                    ))}
                </ModalBody>
                <ModalFooter>
                    <Button color="primary" onClick={closeMountResultModal}>OK</Button>
                </ModalFooter>
            </Modal>
        </div>
    );
}

NewMountModal.propTypes = {
    /**
     * Text for open modal button
     */
    buttonLabel: PropTypes.string,
    /**
     * Class for open modal button
     */
    buttonClass: PropTypes.string,
    /**
     * Function to be called when ok button is clicked.
     */
    okHandle: PropTypes.func.isRequired,
    /**
     * Function to refresh the mount list after successful mount
     */
    refreshList: PropTypes.func,
}

export default NewMountModal;