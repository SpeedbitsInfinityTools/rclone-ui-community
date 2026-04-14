import React from "react";
import axiosInstance from "../../../utils/API/API";
import {Button, Col, Container, Input, Modal, ModalBody, ModalFooter, ModalHeader, Row, Spinner, Table} from "reactstrap";
import {DropTarget} from "react-dnd";
import FileComponent from "./FileComponent";
import {ItemTypes} from "./Constants";
import {toast} from "react-toastify";
import {
    addColonAtLast,
    changeListVisibility,
    changeSearchFilter,
    getSortCompareFunction,
    isEmpty
} from "../../../utils/Tools";
import {connect} from "react-redux";
import {getFiles} from "../../../actions/explorerActions";
import {compose} from "redux";
import {changePath, changeSortFilter, navigateUp} from "../../../actions/explorerStateActions";
import LinkShareModal from "../../Base/LinkShareModal/LinkShareModal";
import FileInfoModal from "./FileInfoModal";
import ScrollableDiv from "../../Base/ScrollableDiv/ScrollableDiv";
import {FILES_VIEW_HEIGHT} from "../../../utils/Constants";
import {PROP_CURRENT_PATH, PROP_FS_INFO} from "../../../utils/RclonePropTypes";
import * as PropTypes from 'prop-types';
import ErrorBoundary from "../../../ErrorHandling/ErrorBoundary";
import {createNewPublicLink, deleteFile, purgeDir} from "rclone-api";
import {createSelector} from "reselect";
import DropOverlay from "../../Base/DropOverlay/DropOverlay";

/*
* Start code for react DND
* */

const filesTarget = {
    drop(props, monitor, component) {
        if (monitor.didDrop()) return;
        // console.log("drop", props, monitor, monitor.getItem(), component);

        let {Name, Path, IsDir, remoteName} = monitor.getItem();

        let srcRemoteName = addColonAtLast(remoteName);
        let srcRemotePath = Path;
        let destRemoteName = addColonAtLast(props.currentPath.remoteName);
        let destRemotePath = props.currentPath.remotePath;

        // console.log("drop:this", this);

        return {
            srcRemoteName,
            srcRemotePath,
            destRemoteName,
            destRemotePath,
            Name,
            IsDir,
            updateHandler: component.updateHandler
        }

    },
    canDrop(props, monitor) {
        const {remoteName, remotePath} = monitor.getItem();
        const destRemoteName = props.currentPath.remoteName;
        const destRemotePath = props.currentPath.remotePath;
        if (destRemoteName === remoteName) {
            return destRemotePath !== remotePath;
        }
        return true;
    }
};

function collect(connect, monitor) {
    return {
        connectDropTarget: connect.dropTarget(),
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop()
    }
}


/*
* END code for react DND
* */

// Provides the up button view in the files view
// function UpButtonComponent({upButtonHandle, gridMode}) {
//     if (gridMode === "card") {
//         return (
//             <Col lg={12}>
//                 <Button onClick={() => upButtonHandle()}>Go Up</Button>
//             </Col>
//         )
//     } else {
//         return (
//             <tr onClick={() => upButtonHandle()} className={"pointer-cursor"}>
//                 <td colSpan={1}/>
//                 <td colSpan={4}><i className={"fa fa-file-o"}/> Go Up...</td>
//             </tr>);
//     }
// }

/**
 * FilesView component renders files in the file explorer.
 */
class FilesView extends React.PureComponent {


    constructor(props) {
        super(props);
        this.state = {
            isLoading: false,
            downloadingFileIds: new Set(), // Track which files are currently downloading
            shouldUpdate: true,
            showLinkShareModal: false,
            generatedLink: "",
            showInfoModal: false,
            selectedItem: null,
            selectedFiles: new Set(), // Track selected file IDs for bulk operations
            showBulkDeleteModal: false,
            isBulkDeleting: false


        };
        this.handleFileClick = this.handleFileClick.bind(this);
        this.downloadHandle = this.downloadHandle.bind(this);
        this.deleteHandle = this.deleteHandle.bind(this);
        this.infoHandle = this.infoHandle.bind(this);
        this.toggleFileSelection = this.toggleFileSelection.bind(this);
        this.toggleSelectAll = this.toggleSelectAll.bind(this);
        this.handleBulkDelete = this.handleBulkDelete.bind(this);
    }

    closeLinkShareModal = () => {
        this.setState({
            showLinkShareModal: false
        })
    };

    showLinkShareModal = () => {
        this.setState({
            showLinkShareModal: true

        })
    };

    closeInfoModal = () => {
        this.setState({
            showInfoModal: false,
            selectedItem: null
        })
    };

    infoHandle(item) {
        this.setState({
            showInfoModal: true,
            selectedItem: item
        });
    }

    toggleFileSelection(fileId) {
        this.setState(prevState => {
            const newSelected = new Set(prevState.selectedFiles);
            if (newSelected.has(fileId)) {
                newSelected.delete(fileId);
            } else {
                newSelected.add(fileId);
            }
            return { selectedFiles: newSelected };
        });
    }

    toggleSelectAll() {
        const { files } = this.props;
        this.setState(prevState => {
            const newSelected = new Set();
            // If not all are selected, select all; otherwise, deselect all
            if (prevState.selectedFiles.size !== files.length) {
                files.forEach(item => {
                    const fileId = item.ID || item.Name;
                    newSelected.add(fileId);
                });
            }
            return { selectedFiles: newSelected };
        });
    }

    handleBulkDelete() {
        if (this.state.selectedFiles.size === 0) {
            toast.warning("No files selected");
            return;
        }
        this.setState({ showBulkDeleteModal: true });
    }

    confirmBulkDelete = async () => {
        const { selectedFiles } = this.state;
        const { files, currentPath, containerID } = this.props;
        const { remoteName, remotePath } = currentPath;

        this.setState({ isBulkDeleting: true });

        const filesToDelete = files.filter(item => {
            const fileId = item.ID || item.Name;
            return selectedFiles.has(fileId);
        });

        let successCount = 0;
        let failCount = 0;

        for (const item of filesToDelete) {
            try {
                // Use item.Path (the correct complete path) and check IsDir for proper API call
                if (item.IsDir) {
                    await purgeDir(remoteName, item.Path);
                } else {
                    await deleteFile(remoteName, item.Path);
                }
                successCount++;
            } catch (error) {
                console.error(`Failed to delete ${item.Name}:`, error);
                failCount++;
            }
        }

        this.setState({
            showBulkDeleteModal: false,
            isBulkDeleting: false,
            selectedFiles: new Set()
        });

        if (successCount > 0) {
            toast.success(`✅ Deleted ${successCount} item(s)`);
        }
        if (failCount > 0) {
            toast.error(`❌ Failed to delete ${failCount} item(s)`);
        }

        // Refresh the file list
        this.props.getFiles(remoteName, remotePath);
    }

    cancelBulkDelete = () => {
        this.setState({ showBulkDeleteModal: false });
    }


    handleFileClick(e, item) {
        const {Path, IsDir, IsBucket} = item;
        if (IsDir || IsBucket) {
            this.updateRemotePath(Path, IsDir, IsBucket);
        } else {
            this.downloadHandle(item);
        }

    }

    updateRemotePath(newRemotePath, IsDir, IsBucket) {
        const {remoteName} = this.props.currentPath;

        let updateRemoteName = "";
        let updateRemotePath = "";


        if (IsBucket) {
            updateRemoteName = addColonAtLast(remoteName) + newRemotePath;
            updateRemotePath = "";
            // backStack.push({remoteName: addColonAtLast(backStack.peek().remoteName) + remotePath, remotePath: ""});

        } else if (IsDir) {
            updateRemoteName = remoteName;
            updateRemotePath = newRemotePath;
            // backStack.push({remoteName: backStack.peek().remoteName, remotePath: remotePath});
        }
        this.props.changePath(this.props.containerID, updateRemoteName, updateRemotePath);
    }


    getFilesList() {
        const {remoteName, remotePath} = this.props.currentPath;

        this.props.getFiles(remoteName, remotePath);

    }

    async downloadHandle(item) {
        let {remoteName, remotePath} = this.props.currentPath;
        
        // Build fs and remote parameters
        // Ensure remoteName ends with ':' for non-local remotes
        let fs = remoteName;
        if (fs && fs !== '/' && !fs.includes(':')) {
            fs = fs + ':';
        }
        let remote = remotePath ? `${remotePath}/${item.Name}` : item.Name;
        
        // Get unique identifier for this file (ID or Name)
        const fileId = item.ID || item.Name;
        
        // Mark this file as downloading
        this.setState((prevState) => {
            const newSet = new Set(prevState.downloadingFileIds);
            newSet.add(fileId);
            return { downloadingFileIds: newSet };
        });

        try {
            // Use the special download endpoint that streams the file properly
            let response = await axiosInstance.post('download', {
                fs: fs,
                remote: remote
            }, {
                responseType: 'blob',
            });

            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', item.Name);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Download failed:', error);
            toast.error(`Failed to download ${item.Name}`);
        } finally {
            // Remove this file from downloading set
            this.setState((prevState) => {
                const newSet = new Set(prevState.downloadingFileIds);
                newSet.delete(fileId);
                return { downloadingFileIds: newSet };
            });
        }
    }

    async deleteHandle(item) {
        let {remoteName} = this.props.currentPath;

        try {
            if (item.IsDir) {

                await purgeDir(remoteName, item.Path);

                this.updateHandler();
                toast.info(`${item.Name} deleted.`);

            } else {

                await deleteFile(remoteName, item.Path);
                this.updateHandler();
                toast.info(`${item.Name} deleted.`, {
                    autoClose: true
                });
            }
        } catch (e) {
            // console.log(`Error in deleting file`);
            toast.error(`Error deleting file. ${e}`);
        }

    }

    updateHandler = () => {

        // const {remoteName, remotePath} = this.props.currentPath;
        this.getFilesList();
    };


    linkShareHandle = (item) => {
        const {fsInfo} = this.props;
        if (fsInfo.Features.PublicLink) {
            // console.log("Sharing link" + item.Name);
            const {remoteName} = this.props.currentPath;
            createNewPublicLink(remoteName, item.Path)
                .then((res) => {
                    // console.log("Public Link: " + res.data.url);

                    this.setState({
                        generatedLink: res.url,
                        showLinkShareModal: true
                    })
                }, (error) => {
                    toast.error("Error Generating link: " + error)
                })
        } else {
            toast.error("This remote does not support public link");
        }

    };

    getFileComponents = (isDir) => {
        const {files, containerID, gridMode, fsInfo, loadImages} = this.props;
        const {remoteName, remotePath} = this.props.currentPath;
        const {downloadingFileIds, selectedFiles} = this.state;
        // console.log(fsInfo, files);
        if (fsInfo && !isEmpty(fsInfo)) {
            return files.reduce((result, item) => {
                let {ID, Name} = item;
                // Using fallback as fileName when the ID is not available (especially for local file system)
                if (ID === undefined) {
                    ID = Name;
                }
                if (item.IsDir === isDir) {
                    const fileId = ID || Name;
                    const isDownloading = downloadingFileIds.has(fileId);
                    const isSelected = selectedFiles.has(fileId);
                    result.push(
                        <FileComponent key={ID} item={item} clickHandler={this.handleFileClick}
                                       downloadHandle={this.downloadHandle} deleteHandle={this.deleteHandle}
                                       infoHandle={this.infoHandle}
                                       remoteName={remoteName} remotePath={remotePath} gridMode={gridMode}
                                       containerID={containerID}
                                       linkShareHandle={this.linkShareHandle}
                                       loadImages={loadImages}
                                       isBucketBased={fsInfo.Features.BucketBased}
                                       canCopy={fsInfo.Features.Copy} canMove={fsInfo.Features.Move} itemIdx={1}
                                       isDownloading={isDownloading}
                                       isSelected={isSelected}
                                       toggleSelection={this.toggleFileSelection}>

                        </FileComponent>
                    );
                }
                return result;
            }, []);
        }
    };

    applySortFilter = (sortFilter) => {
        const {changeSortFilter, containerID} = this.props;

        if (this.props.sortFilter === sortFilter) {
            return changeSortFilter(containerID, sortFilter, (this.props.sortFilterAscending !== true));
        } else {
            return changeSortFilter(containerID, sortFilter, true);
        }

    };


    render() {
        const {isLoading, generatedLink, showLinkShareModal} = this.state;
        const {connectDropTarget, isOver, files, filesError, filesHasError, filesData, gridMode, canDrop, sortFilter, sortFilterAscending} = this.props;
        const {remoteName, remotePath} = this.props.currentPath;

        if (remoteName === "") {
            return (<div>No remote is selected. Select a remote from above to show files.</div>);
        }

        // Show spinner if loading (filesData is undefined means request hasn't completed yet)
        if (isLoading || filesData === undefined) {
            return (<div><Spinner color="primary"/> Loading</div>);
        }
        
        // Show error message if there was an error loading files
        if (filesHasError && filesError) {
                const errorMessage = filesError?.response?.data?.error || 
                                   filesError?.message || 
                                   filesError?.toString() || 
                                   'Unknown error occurred while loading files';
                return (
                    <Container fluid={true} className={"p-4"}>
                        <div style={{
                            textAlign: 'center',
                            padding: '40px',
                            color: '#dc3545',
                            backgroundColor: '#f8d7da',
                            border: '1px solid #f5c6cb',
                            borderRadius: '4px'
                        }}>
                            <i className="fa fa-exclamation-triangle fa-2x" style={{marginBottom: '15px'}}></i>
                            <h5 style={{color: '#721c24', marginBottom: '10px'}}>Error Loading Files</h5>
                            <p style={{color: '#721c24', marginBottom: '5px'}}>{errorMessage}</p>
                            <p style={{color: '#856404', fontSize: '14px', marginTop: '15px'}}>
                                <strong>Possible causes:</strong><br/>
                                - Remote configuration is invalid or token expired<br/>
                                - Backend server is not responding<br/>
                                - Network connectivity issues
                            </p>
                            <button 
                                className="btn btn-primary mt-3" 
                                onClick={() => this.getFilesList()}
                            >
                                <i className="fa fa-refresh"></i> Retry
                            </button>
                        </div>
                    </Container>
                );
            }


            let dirComponentMap = this.getFileComponents(true);

            let fileComponentMap = this.getFileComponents(false);

            let renderElement = "";

            if (gridMode === "card") {

                renderElement = (

                    <Container fluid={true} style={{display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0}}>

                        <Row style={{flex: 1, display: 'flex', overflow: 'hidden', margin: 0}}>
                            <Col lg={3} style={{display: 'flex', flexDirection: 'column', overflow: 'hidden'}}>
                                <ScrollableDiv height="100%" style={{flex: 1, minHeight: 0}}>
                                    {dirComponentMap}
                                </ScrollableDiv>
                            </Col>
                            <Col lg={9} style={{display: 'flex', flexDirection: 'column', overflow: 'hidden'}}>
                                <ScrollableDiv height="100%" style={{flex: 1, minHeight: 0}}>
                                    <Row>
                                        {fileComponentMap}
                                    </Row>
                                </ScrollableDiv>
                            </Col>

                        </Row>


                    </Container>

                )
            } else {
                let filterIconClass = "fa fa-lg fa-sort-desc";
                if(sortFilterAscending){
                    filterIconClass = "fa fa-lg fa-sort-asc";
                }
                renderElement = (

                    <Container fluid={true} className={"p-0"} style={{display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0}}>

                        <ScrollableDiv height="100%" style={{flex: 1, minHeight: 0}}>

                            {/* Bulk Actions Bar */}
                            {this.state.selectedFiles.size > 0 && (
                                <div style={{
                                    padding: '10px 15px',
                                    backgroundColor: '#e3f2fd',
                                    borderBottom: '1px solid #90caf9',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between'
                                }}>
                                    <span>
                                        <i className="fa fa-check-square" style={{marginRight: '8px', color: '#1976d2'}}></i>
                                        <strong>{this.state.selectedFiles.size}</strong> item(s) selected
                                    </span>
                                    <div>
                                        <Button 
                                            size="sm" 
                                            color="link" 
                                            onClick={() => this.setState({ selectedFiles: new Set() })}
                                            style={{marginRight: '10px'}}
                                        >
                                            Clear Selection
                                        </Button>
                                        <Button 
                                            size="sm" 
                                            color="danger" 
                                            onClick={this.handleBulkDelete}
                                            disabled={this.state.isBulkDeleting}
                                        >
                                            <i className="fa fa-trash" style={{marginRight: '5px'}}></i>
                                            Delete Selected
                                        </Button>
                                    </div>
                                </div>
                            )}

                            <Table className="table table-responsive-sm table-striped table-fix-head">
                                <thead>
                                <tr>
                                    <th style={{width: '50px', textAlign: 'center', verticalAlign: 'middle', paddingLeft: '15px', position: 'relative'}}>
                                        <Input 
                                            type="checkbox" 
                                            checked={this.state.selectedFiles.size > 0 && this.state.selectedFiles.size === files.length}
                                            onChange={this.toggleSelectAll}
                                            style={{cursor: 'pointer', margin: '0', position: 'static'}}
                                        />
                                    </th>
                                    <th className="pointer-cursor"
                                        onClick={() => this.applySortFilter("name")}>Name {sortFilter === "name" &&
                                    <i className={filterIconClass}/>}</th>
                                    <th className="pointer-cursor"
                                        onClick={() => this.applySortFilter("size")}>Size {sortFilter === "size" &&
                                    <i className={filterIconClass}/>}</th>
                                    <th className="d-none d-md-table-cell pointer-cursor"
                                        onClick={() => this.applySortFilter("modified")}>Modified {sortFilter === "modified" &&
                                    <i className={filterIconClass}/>}</th>
                                    <th>Actions</th>
                                </tr>
                                </thead>
                                <tbody>
                                {files.length > 0 ? (
                                        <React.Fragment>
                                            {dirComponentMap}
                                            {fileComponentMap}
                                        </React.Fragment>
                                    ) :
                                    <tr>
                                        <td colSpan={5} style={{textAlign: 'center', color: '#999', padding: '30px', fontStyle: 'italic'}}>
                                            {filesHasError ? (
                                                <div style={{color: '#dc3545'}}>
                                                    <i className="fa fa-exclamation-triangle"></i> Error loading files - {filesError?.response?.data?.error || filesError?.message || 'Unknown error'}
                                                </div>
                                            ) : (
                                                'Empty - No files or directories'
                                            )}
                                        </td>
                                    </tr>
                                }
                                </tbody>
                            </Table>
                        </ScrollableDiv>
                    </Container>


                );
            }


            return connectDropTarget(
                <div className={"row"} style={{display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0}}>
                    {isOver && canDrop && <DropOverlay/>}
                    <ErrorBoundary style={{display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0}}>

                        {renderElement}

                        <LinkShareModal closeModal={this.closeLinkShareModal} isVisible={showLinkShareModal}
                                        linkUrl={generatedLink}/>
                        
                        <FileInfoModal isOpen={this.state.showInfoModal} toggle={this.closeInfoModal}
                                       item={this.state.selectedItem}
                                       remoteName={remoteName} remotePath={remotePath}/>

                        {/* Bulk Delete Confirmation Modal */}
                        <Modal isOpen={this.state.showBulkDeleteModal} toggle={this.cancelBulkDelete}>
                            <ModalHeader toggle={this.cancelBulkDelete}>
                                <i className="fa fa-trash" style={{marginRight: '8px'}}></i>
                                Confirm Bulk Delete
                            </ModalHeader>
                            <ModalBody>
                                <p>Are you sure you want to delete <strong>{this.state.selectedFiles.size}</strong> selected item(s)?</p>
                                <p className="text-danger mb-0">
                                    <i className="fa fa-exclamation-triangle"></i> This operation cannot be undone!
                                </p>
                            </ModalBody>
                            <ModalFooter>
                                <Button color="secondary" onClick={this.cancelBulkDelete} disabled={this.state.isBulkDeleting}>
                                    Cancel
                                </Button>
                                <Button color="danger" onClick={this.confirmBulkDelete} disabled={this.state.isBulkDeleting}>
                                    {this.state.isBulkDeleting ? (
                                        <>
                                            <Spinner size="sm" style={{marginRight: '5px'}} />
                                            Deleting...
                                        </>
                                    ) : (
                                        <>
                                            <i className="fa fa-trash" style={{marginRight: '5px'}}></i>
                                            Delete
                                        </>
                                    )}
                                </Button>
                            </ModalFooter>
                        </Modal>
                    </ErrorBoundary>
                </div>
            );
    }
}

const propTypes = {
    containerID: PropTypes.string.isRequired,
    currentPath: PROP_CURRENT_PATH.isRequired,
    fsInfo: PROP_FS_INFO,
    gridMode: PropTypes.string,
    searchQuery: PropTypes.string,
    loadImages: PropTypes.bool.isRequired
};

const defaultProps = {};


FilesView.propTypes = propTypes;
FilesView.defaultProps = defaultProps;


const getVisibleFiles = createSelector(
    (state, props) => props.containerID,
    (state, props) => state.explorer.currentPaths[props.containerID],
    (state, props) => state.explorer.visibilityFilters[props.containerID],
    (state, props) => state.explorer.sortFilters[props.containerID],
    (state, props) => state.explorer.searchQueries[props.containerID],
    (state, props) => state.explorer.sortFiltersAscending[props.containerID],
    (state, props) => state.remote.files[`${state.explorer.currentPaths[props.containerID].remoteName}-${state.explorer.currentPaths[props.containerID].remotePath}`],
    (containerID, currentPath, visibilityFilter, sortFilter, searchQuery, sortFilterAscending, files) => {
        files = files.files;
        // Filter according to visibility filters
        if (visibilityFilter && visibilityFilter !== "") {
            files = changeListVisibility(files, visibilityFilter);
        }

        //Filter according to search query, if any
        if (searchQuery) {
            files = changeSearchFilter(files, searchQuery);
        }
        files.sort(getSortCompareFunction(sortFilter, sortFilterAscending));

        return files;
    }
)

const mapStateToProps = (state, ownProps) => {
    const {currentPaths, gridMode, searchQueries, loadImages, sortFilters, sortFiltersAscending} = state.explorer;
    const {containerID} = ownProps;
    const currentPath = currentPaths[containerID];
    const mgridMode = gridMode[containerID];
    const searchQuery = searchQueries[containerID];
    const mloadImages = loadImages[containerID];
    const sortFilter = sortFilters[containerID];
    const sortFilterAscending = sortFiltersAscending[containerID];

    let fsInfo = {};
    const {remoteName, remotePath} = currentPath;

    if (currentPath && state.remote.configs) {
        const tempRemoteName = remoteName.split(':')[0];
        if (state.remote.configs[tempRemoteName])
            fsInfo = state.remote.configs[tempRemoteName];
    }

    const pathKey = `${remoteName}-${remotePath}`;

    let filesData = state.remote.files[pathKey];
    let files = null;
    let filesError = null;
    let filesHasError = false;

    if (filesData) {
        // Check for errors
        if (filesData.hasError) {
            filesHasError = true;
            filesError = filesData.error;
            files = []; // Empty array for error state
        } else {
            files = getVisibleFiles(state, ownProps);
        }
    }

    // Sort the files
    return {
        files,
        filesError,
        filesHasError,
        filesData, // Include filesData to check if loading (undefined = loading, object = loaded)
        currentPath,
        fsInfo,
        gridMode: mgridMode,
        searchQuery,
        loadImages: mloadImages,
        sortFilter,
        sortFilterAscending
    }
};

export default compose(
    connect(
        mapStateToProps, {getFiles, navigateUp, changePath, changeSortFilter}
    ),
    DropTarget(ItemTypes.FILECOMPONENT, filesTarget, collect)
)(FilesView)
