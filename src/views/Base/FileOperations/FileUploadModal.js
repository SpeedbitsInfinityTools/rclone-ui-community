import React, {useCallback, useState} from 'react';
import {
    Button,
    Col,
    Container,
    FormGroup,
    Input,
    Modal,
    ModalBody,
    ModalFooter,
    ModalHeader,
    Row,
    Table,
    Progress,
    UncontrolledTooltip
} from 'reactstrap';
import PropTypes from 'prop-types';
import axiosInstance from "../../../utils/API/API";
import {addColonAtLast, formatBytes} from "../../../utils/Tools";
import {toast} from "react-toastify";
import * as RclonePropTypes from "../../../utils/RclonePropTypes";
import FileUploadBox from "./FileUploadBox";

/**
 * New Mount Modal shows a button for opening a modal for new mount and then executes okHandle when positive
 * button is clicked
 * @param props
 * @returns {*}
 * @constructor
 */
const FileUploadModal = (props) => {
    const {
        currentPath,
        containerID,
        onUploadComplete
    } = props;

    const [modal, setModal] = useState(false);
    const [files, setFiles] = useState(null);
    const [isUploading, setIsUploading] = useState(false);
    
    // Track upload progress per file: { fileIndex: { progress: 0-100, status: 'pending'|'uploading'|'complete'|'error' } }
    const [uploadProgress, setUploadProgress] = useState({});

    const toggle = () => {
        setModal(!modal);
        // Reset the file selection when closing the modal
        if (modal) {
            setFiles(null);
            setUploadProgress({});
            // Also reset the file input element
            const fileInput = document.getElementById('upload-file');
            if (fileInput) {
                fileInput.value = '';
            }
        }
    };


    const changeFilesHandler = (e) => {
        setFiles(e.target.files);
    }

    const isUploadDisabled = () => !files || isUploading;

    const getFilesElement = () => {
        let out = [];
        for (let i = 0; i < files.length; i++) {
            const fileProgress = uploadProgress[i];
            const showProgress = fileProgress && fileProgress.status !== 'pending';
            
            out.push(
                <tr key={i}>
                    <td>
                        {files[i].name}
                        {showProgress && (
                            <div className="mt-2">
                                <Progress 
                                    value={fileProgress.progress} 
                                    color={
                                        fileProgress.status === 'error' ? 'danger' :
                                        fileProgress.status === 'complete' ? 'success' :
                                        'primary'
                                    }
                                >
                                    {fileProgress.progress}%
                                </Progress>
                                <small className="text-muted">
                                    {fileProgress.status === 'uploading' && 'Uploading to server...'}
                                    {fileProgress.status === 'complete' && '✓ Complete'}
                                    {fileProgress.status === 'error' && '✗ Failed'}
                                </small>
                                {fileProgress.status === 'uploading' && fileProgress.progress === 100 && (
                                    <small className="text-muted d-block" style={{fontSize: '0.7rem'}}>
                                        Progress bar complete. Server is now uploading to cloud storage...
                                    </small>
                                )}
                            </div>
                        )}
                    </td>
                    <td>{files[i].size === -1 ? "-" : formatBytes(files[i].size, 2)}</td>
                </tr>
            );
        }
        return out;
    }

    const fileUploadHandler = async () => {
        setIsUploading(true);
        
        // Initialize progress for all files
        const initialProgress = {};
        for (let i = 0; i < files.length; i++) {
            initialProgress[i] = { progress: 0, status: 'pending' };
        }
        setUploadProgress(initialProgress);

        let uploadedCount = 0;
        let failedCount = 0;

        // Upload files one by one to track individual progress
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const formData = new FormData();
            formData.append('file0', file);

            try {
                // Update status to uploading
                setUploadProgress(prev => ({
                    ...prev,
                    [i]: { progress: 0, status: 'uploading' }
                }));

                // For bucket-based remotes (S3), just use remoteName as-is
                // It already contains the correct path (e.g., "hetzner:speedbitspublic")
                const fs = addColonAtLast(currentPath.remoteName);

                await axiosInstance.post(
                    `operations/uploadfile?fs=${fs}&remote=${currentPath.remotePath}`,
                    formData,
                    {
                        onUploadProgress: (progressEvent) => {
                            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                            setUploadProgress(prev => ({
                                ...prev,
                                [i]: { progress: percentCompleted, status: 'uploading' }
                            }));
                        }
                    }
                );

                // Mark as complete
                setUploadProgress(prev => ({
                    ...prev,
                    [i]: { progress: 100, status: 'complete' }
                }));
                uploadedCount++;

            } catch (error) {
                // Mark as error
                setUploadProgress(prev => ({
                    ...prev,
                    [i]: { progress: 0, status: 'error' }
                }));
                failedCount++;
                console.error(`Failed to upload ${file.name}:`, error);
            }
        }

        setIsUploading(false);

        // Show summary toast
        if (failedCount === 0) {
            toast.success(`Successfully uploaded ${uploadedCount} file(s)`);
            // Close modal and refresh
            setTimeout(() => {
                toggle();
                if (onUploadComplete) {
                    onUploadComplete();
                }
            }, 1000); // Wait 1 second to show completion status
        } else if (uploadedCount > 0) {
            toast.warning(`Uploaded ${uploadedCount} file(s), ${failedCount} failed`);
            // Refresh even if some failed
            if (onUploadComplete) {
                onUploadComplete();
            }
        } else {
            toast.error(`All ${failedCount} file(s) failed to upload`);
        }
    }

    const filesDropHandler = useCallback((item, monitor) => {
        if (monitor) {
            setFiles(monitor.getItem().files);
        }
    }, []);

    return (
        <div data-test="fileUploadModalComponent">

            <Button className="btn-explorer-action h-100" id="UploadButton"
                    onClick={toggle}>
                <i className="fa fa-lg fa-upload"/>
            </Button>
            <UncontrolledTooltip placement="right" target="UploadButton">
                Upload file(s)
            </UncontrolledTooltip>
            <Modal isOpen={modal} toggle={toggle} backdrop="static" keyboard={false}>
                <ModalHeader toggle={toggle}>Upload Files</ModalHeader>
                <ModalBody>
                    <Container fluid>
                        <FileUploadBox onDrop={filesDropHandler}>
                                {files ? <Row>
                                    <Table>
                                        <thead>
                                        <tr>
                                            <th>Name</th>
                                            <th>Size</th>
                                        </tr>
                                        </thead>
                                        <tbody>
                                        {getFilesElement()}
                                        </tbody>
                                    </Table>

                                </Row> : <Row className="upload-box">
                                    <Col sm={3}/>
                                    <Col sm={6}>

                                        <label htmlFor="upload-file">

                                            <Row>
                                                <i className="fa fa-lg fa-plus mx-auto mt-5"/>
                                                <p className="text-center mt-2">Click here or drag and drop files to
                                                    upload</p>
                                            </Row>

                                        </label>
                                    </Col>
                                    <Col sm={3}/>
                                </Row>
                                }
                                <Row>
                                    <FormGroup row className="pl-2 pr-2 d-none">
                                        <Input id="upload-file" type="file" name="file" onChange={changeFilesHandler}
                                               multiple/>
                                    </FormGroup>
                                </Row>
                            </FileUploadBox>
                        </Container>
                    </ModalBody>
                    <ModalFooter>
                        <Button data-test="ok-button" color="primary" onClick={fileUploadHandler}
                                disabled={isUploadDisabled()}>
                            {isUploading ? (
                                <>
                                    <i className="fa fa-spinner fa-spin mr-2"/>
                                    Uploading {Object.values(uploadProgress).filter(p => p.status === 'complete').length} / {files?.length || 0}
                                </>
                            ) : "Upload"}
                        </Button>{' '}
                        <Button data-test="cancel-button" color="secondary" onClick={toggle} disabled={isUploading}>Cancel</Button>
                    </ModalFooter>
            </Modal>
        </div>
    );
}

FileUploadModal.propTypes = {
    currentPath: RclonePropTypes.PROP_CURRENT_PATH,
    containerID: PropTypes.string,
    onUploadComplete: PropTypes.func
}

export default FileUploadModal;