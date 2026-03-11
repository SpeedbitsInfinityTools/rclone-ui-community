import React from 'react';
import {Button, Col, Form, FormGroup, Input, Label, Modal, ModalBody, ModalHeader} from "reactstrap";
import PropTypes from "prop-types";
import axiosInstance from "../../../utils/API/API";
import {toast} from "react-toastify";
import {addColonAtLast} from "../../../utils/Tools";
import {connect} from "react-redux";
import {getFilesForContainerID} from "../../../actions/explorerStateActions";
import urls from "../../../utils/API/endpoint";


class NewFolder extends React.Component {

    constructor(props) {
        super(props);
        this.state = {
            name: "",
            disableForm: false
        };
        this.createNewFolder = this.createNewFolder.bind(this);
        this.handleSubmit = this.handleSubmit.bind(this);
        this.toggle = this.toggle.bind(this);

    }

    disableForm = (shouldDisable) => {
        this.setState({disableForm: shouldDisable});
    };

    /**
     * Create an S3 folder placeholder
     * 
     * Uploads a .keep file inside the folder to make it visible
     * This works on ALL S3 backends without requiring --s3-directory-markers flag
     */
    async createS3FolderPlaceholder(remoteName, folderPath) {
        try {
            console.log('[S3 Folder] Creating folder:', { remoteName, folderPath });
            
            // For bucket-based storage with operations/uploadfile:
            // - If remoteName is "hetzner:speedbitspublic", keep it as fs (includes bucket)
            // - Then remote is just the folder path (e.g., "test5")
            // This prevents Rclone from trying to CREATE the bucket
            const fs = remoteName;
            const remote = folderPath;
            
            console.log('[S3 Folder] Preparing upload:', { 
                fs,
                folderPath: remote,
                willCreate: `${fs}${remote}/.keep`
            });
            
            // Upload .keep file inside the folder
            // This is reliable on ALL S3 backends and works immediately
            // Creates: bucket/folder/.keep (0 bytes) which makes the folder visible
            
            const emptyFile = new File([''], '.keep', { 
                type: 'text/plain' 
            });
            
            const formData = new FormData();
            formData.append('file', emptyFile);
            
            // IMPORTANT: remote parameter must include the full path INCLUDING the filename
            // e.g., "speedbitspublic/test/.keep" not just "speedbitspublic/test"
            const remoteWithKeepFile = remote + '/.keep';
            const uploadUrl = `${urls.uploadFile}?fs=${encodeURIComponent(fs)}&remote=${encodeURIComponent(remoteWithKeepFile)}`;
            
            console.log('[S3 Folder] Uploading .keep to:', { 
                fs, 
                remote: remoteWithKeepFile,
                fullPath: fs + remoteWithKeepFile,
                url: uploadUrl
            });
            
            await axiosInstance.post(uploadUrl, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            });
            
            console.log('[S3 Folder] ✅ .keep file created - folder will be visible');
            return true;
            
        } catch (error) {
            console.error('[S3 Folder] .keep file upload failed:', error);
            return false;
        }
    }

    async createNewFolder() {
        let {name} = this.state;
        let {remoteName, remotePath} = this.props.currentPath;
        const {fsInfo} = this.props;

        remoteName = addColonAtLast(remoteName);

        try {
            // Check if this is a bucket-based storage trying to create a bucket
            if (fsInfo && fsInfo.Features && fsInfo.Features.BucketBased && remotePath === "") {
                /*Trying to create a bucket, not a dir*/
                remoteName += name;
            } else { /*Normal directory*/
                if (remotePath === "") {
                    remotePath = name;
                } else {
                    remotePath += "/" + name;
                }
            }
            
            /*Disable form submit button*/
            this.disableForm(true);
            
            // Check if this remote can't have empty directories (S3, object storage)
            // If so, use the placeholder approach directly instead of trying mkdir first
            const canHaveEmptyDirs = fsInfo && fsInfo.Features && fsInfo.Features.CanHaveEmptyDirectories;
            
            if (!canHaveEmptyDirs) {
                // S3/Object Storage - create placeholder directly
                toast.info('Creating folder on object storage...', { autoClose: 2000 });
                
                const success = await this.createS3FolderPlaceholder(remoteName, remotePath);
                
                if (success) {
                    this.disableForm(false);
                    this.toggle();
                    toast.success(`Folder created: ${remotePath}`);
                    this.props.getFilesForContainerID(this.props.containerID);
                } else {
                    this.disableForm(false);
                    toast.error(
                        `Failed to create folder on object storage. ` +
                        `Try uploading a file into this path instead.`,
                        { autoClose: 6000 }
                    );
                }
                return; // Exit early
            }
            
            // Normal filesystem - use regular mkdir
            const data = {
                fs: remoteName,
                remote: remotePath
            };

            /*Network Request*/
            await axiosInstance.post(urls.mkdir, data);

            this.disableForm(false);

            this.toggle();
            toast.info(`Folder created: ${remotePath}`);
            this.props.getFilesForContainerID(this.props.containerID);
        } catch (error) {
            this.disableForm(false);

            if (error.response) {
                const errorMsg = error.response.data.error;
                // Check if it's the common S3 empty directory error (fallback for legacy/misconfigured remotes)
                if (errorMsg && errorMsg.includes("cannot have empty directories")) {
                    // Fallback: Try to create S3 folder placeholder
                    toast.info('Retrying with S3 folder placeholder...', { autoClose: 2000 });
                    
                    const success = await this.createS3FolderPlaceholder(remoteName, remotePath);
                    
                    if (success) {
                        this.toggle();
                        toast.success(`Folder created: ${remotePath}`);
                        this.props.getFilesForContainerID(this.props.containerID);
                    } else {
                        toast.error(
                            `Failed to create folder. ` +
                            `Try uploading a file into this path instead.`,
                            { autoClose: 6000 }
                        );
                    }
                } else {
                    toast.error(`Error creating folder: ${errorMsg}`)
                }
            } else {
                toast.error(`Error creating folder: ${error}`);
            }
        }
    }

    handleSubmit(e) {
        e.preventDefault();
        this.createNewFolder();
    }

    changeName = e => {
        const value = e.target.value;
        this.setState(
            {name: value}
        );
    };

    toggle() {
        this.props.closeModal();
    }

    render() {
        const {name, disableForm} = this.state;
        const {isVisible, currentPath} = this.props;
        return (

            <Modal isOpen={isVisible} toggle={this.toggle} data-test="newFolderComponent">
                <Form onSubmit={this.handleSubmit}>
                    <ModalHeader toggle={this.toggle}>Create New folder
                        at {currentPath.remoteName}: {currentPath.remotePath}</ModalHeader>
                    <ModalBody>
                        <FormGroup row>
                            <Label for="folderName" sm={5}>Enter the name</Label>
                            <Col sm={7}>
                                <Input type="text" name="folderName" id="folderName" value={name}
                                       onChange={this.changeName} required autoFocus>
                                </Input>
                            </Col>
                        </FormGroup>
                        <div className="clearfix">
                            <Button type="submit" color="success" className="float-right" disabled={disableForm}><i
                                className="fa fa-check fa-lg"/>Create folder</Button>
                        </div>
                        {/*<Input type={"text"} value={name} onChange={this.changeName}*/}
                        {/*       ref={(input) => this.NameInput = input}/>*/}
                    </ModalBody>
                </Form>
            </Modal>

        );
    }

}

const propTypes = {
    isVisible: PropTypes.bool.isRequired,
    closeModal: PropTypes.func.isRequired,
    containerID: PropTypes.string.isRequired,
    getFilesForContainerID: PropTypes.func.isRequired
};


NewFolder.propTypes = propTypes;


const mapStateToProps = (state, ownProps) => {

    const currentPath = state.explorer.currentPaths[ownProps.containerID];
    let fsInfo = {};

    if (currentPath && state.remote.configs && state.remote.configs[currentPath.remoteName]) {
        fsInfo = state.remote.configs[currentPath.remoteName];
    }
    return {
        currentPath,
        fsInfo
    }
};

export default connect(mapStateToProps, {getFilesForContainerID})(NewFolder);