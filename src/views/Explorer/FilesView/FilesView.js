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
            isBulkDeleting: false,
            // Local filter + pagination (for large buckets/containers with 100k+ items).
            // Applied on top of the already-filtered/sorted `files` prop.
            localFilter: "",
            pageSize: 100,
            currentPage: 1,
            // Shown after the spinner has been visible for a while; rclone listing of
            // huge (e.g. Azure) containers can take tens of seconds because rclone has
            // to walk every page internally before returning a result.
            showSlowListingHint: false


        };
        this._slowListingTimer = null;
        this.handleFileClick = this.handleFileClick.bind(this);
        this.downloadHandle = this.downloadHandle.bind(this);
        this.deleteHandle = this.deleteHandle.bind(this);
        this.infoHandle = this.infoHandle.bind(this);
        this.toggleFileSelection = this.toggleFileSelection.bind(this);
        this.toggleSelectAll = this.toggleSelectAll.bind(this);
        this.handleBulkDelete = this.handleBulkDelete.bind(this);
    }

    componentDidMount() {
        // Show the "large containers take a while" hint if the initial load
        // is still in flight after 5s.
        if (this.props.filesData === undefined) {
            this._armSlowListingHint();
        }
    }

    componentWillUnmount() {
        this._clearSlowListingHint();
    }

    _armSlowListingHint = () => {
        this._clearSlowListingHint();
        this._slowListingTimer = setTimeout(() => {
            this.setState({ showSlowListingHint: true });
        }, 5000);
    };

    _clearSlowListingHint = () => {
        if (this._slowListingTimer) {
            clearTimeout(this._slowListingTimer);
            this._slowListingTimer = null;
        }
    };

    componentDidUpdate(prevProps, prevState) {
        // Reset to page 1 whenever we navigate to a new path/remote or the file set changes significantly.
        const prevKey = `${prevProps.currentPath?.remoteName}|${prevProps.currentPath?.remotePath}`;
        const curKey = `${this.props.currentPath?.remoteName}|${this.props.currentPath?.remotePath}`;
        if (prevKey !== curKey) {
            // eslint-disable-next-line react/no-did-update-set-state
            this.setState({ currentPage: 1, localFilter: "", showSlowListingHint: false });
            // New location: if it's still loading, re-arm the hint timer.
            if (this.props.filesData === undefined) {
                this._armSlowListingHint();
            } else {
                this._clearSlowListingHint();
            }
            return;
        }

        // Loading state transitions for the slow-listing hint.
        const wasLoading = prevProps.filesData === undefined;
        const isLoading = this.props.filesData === undefined;
        if (!wasLoading && isLoading) {
            // Started loading (e.g. manual refresh)
            this._armSlowListingHint();
            // eslint-disable-next-line react/no-did-update-set-state
            this.setState({ showSlowListingHint: false });
        } else if (wasLoading && !isLoading) {
            // Finished loading
            this._clearSlowListingHint();
            if (this.state.showSlowListingHint) {
                // eslint-disable-next-line react/no-did-update-set-state
                this.setState({ showSlowListingHint: false });
            }
        }

        // If filter changed or file count shrank below current page, clamp the page.
        const filtered = this.getLocallyFilteredFiles(this.props.files || [], this.state.localFilter);
        const maxPage = Math.max(1, Math.ceil(filtered.length / this.state.pageSize));
        if (this.state.currentPage > maxPage) {
            // eslint-disable-next-line react/no-did-update-set-state
            this.setState({ currentPage: maxPage });
        }
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

    getCurrentPagedFiles = () => {
        const files = this.props.files || [];
        const {localFilter, pageSize, currentPage} = this.state;
        const locallyFiltered = this.getLocallyFilteredFiles(files, localFilter);
        const totalPages = Math.max(1, Math.ceil(locallyFiltered.length / pageSize));
        const safePage = Math.min(Math.max(1, currentPage), totalPages);
        const startIdx = (safePage - 1) * pageSize;
        const endIdx = Math.min(startIdx + pageSize, locallyFiltered.length);
        return locallyFiltered.slice(startIdx, endIdx);
    };

    toggleSelectAll() {
        const pageFiles = this.getCurrentPagedFiles();
        this.setState(prevState => {
            const newSelected = new Set(prevState.selectedFiles);
            const pageIds = pageFiles.map(item => item.ID || item.Name);
            const allPageSelected = pageIds.length > 0 && pageIds.every(id => newSelected.has(id));

            if (allPageSelected) {
                pageIds.forEach(id => newSelected.delete(id));
            } else {
                pageIds.forEach(id => newSelected.add(id));
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
        const { files, currentPath } = this.props;
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

    getFileComponents = (isDir, sourceFiles) => {
        const {containerID, gridMode, fsInfo, loadImages} = this.props;
        const {remoteName, remotePath} = this.props.currentPath;
        const {downloadingFileIds, selectedFiles} = this.state;
        const files = sourceFiles || this.props.files || [];
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

    getLocallyFilteredFiles = (files, localFilter) => {
        if (!localFilter) return files;
        const q = localFilter.toLowerCase();
        return files.filter((f) => (f.Name || "").toLowerCase().includes(q));
    };

    handleLocalFilterChange = (e) => {
        this.setState({ localFilter: e.target.value, currentPage: 1 });
    };

    handlePageSizeChange = (e) => {
        const newSize = parseInt(e.target.value, 10) || 100;
        this.setState({ pageSize: newSize, currentPage: 1 });
    };

    goToPage = (page) => {
        this.setState({ currentPage: page });
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
            return (
                <div style={{ padding: '20px', textAlign: 'center' }}>
                    <Spinner color="primary"/> Loading
                    {this.state.showSlowListingHint && (
                        <div style={{
                            marginTop: '14px',
                            padding: '10px 14px',
                            maxWidth: '560px',
                            marginLeft: 'auto',
                            marginRight: 'auto',
                            backgroundColor: '#fff3cd',
                            border: '1px solid #ffeeba',
                            color: '#856404',
                            borderRadius: '4px',
                            fontSize: '13px',
                            textAlign: 'left'
                        }}>
                            <i className="fa fa-info-circle" style={{ marginRight: '6px' }}/>
                            This is taking a while. Containers or folders with a very large number
                            of files (hundreds of thousands) can take a long time to enumerate — rclone
                            has to walk the entire listing before it can return any results. Please hang on.
                        </div>
                    )}
                </div>
            );
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


            // Apply local filter + pagination on top of the already redux-filtered+sorted list.
            const {localFilter, pageSize, currentPage} = this.state;
            const locallyFiltered = this.getLocallyFilteredFiles(files, localFilter);
            const totalFiltered = locallyFiltered.length;
            const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
            const safePage = Math.min(Math.max(1, currentPage), totalPages);
            const startIdx = (safePage - 1) * pageSize;
            const endIdx = Math.min(startIdx + pageSize, totalFiltered);
            const pagedFiles = locallyFiltered.slice(startIdx, endIdx);

            const pageIds = pagedFiles.map(item => item.ID || item.Name);
            const allPageSelected = pageIds.length > 0 && pageIds.every(id => this.state.selectedFiles.has(id));

            let dirComponentMap = this.getFileComponents(true, pagedFiles);

            let fileComponentMap = this.getFileComponents(false, pagedFiles);

            // Filter + pagination header bar: always shown above the file list.
            const filterBar = (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '8px 12px',
                    backgroundColor: '#f8f9fa',
                    borderBottom: '1px solid #dee2e6',
                    flexWrap: 'wrap'
                }}>
                    <Input
                        type="text"
                        bsSize="sm"
                        placeholder="Filter files/folders in this location..."
                        value={localFilter}
                        onChange={this.handleLocalFilterChange}
                        style={{ flex: '1 1 220px', minWidth: '180px', maxWidth: '420px' }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#555' }}>
                        <span>Show</span>
                        <Input
                            type="select"
                            bsSize="sm"
                            value={pageSize}
                            onChange={this.handlePageSizeChange}
                            style={{ width: '80px' }}
                        >
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                            <option value={250}>250</option>
                            <option value={500}>500</option>
                            <option value={1000}>1000</option>
                        </Input>
                        <span>per page</span>
                    </div>
                    <div style={{ fontSize: '13px', color: '#555', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                        {totalFiltered === 0
                            ? (localFilter ? 'No matches' : 'Empty')
                            : `${startIdx + 1}–${endIdx} of ${totalFiltered.toLocaleString()}${localFilter ? ` (filtered from ${files.length.toLocaleString()})` : ''}`
                        }
                    </div>
                </div>
            );

            const paginationBar = totalPages > 1 ? (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '8px',
                    borderTop: '1px solid #dee2e6',
                    backgroundColor: '#f8f9fa'
                }}>
                    <Button size="sm" color="light" disabled={safePage === 1}
                            onClick={() => this.goToPage(1)} title="First page">
                        <i className="fa fa-angle-double-left"/>
                    </Button>
                    <Button size="sm" color="light" disabled={safePage === 1}
                            onClick={() => this.goToPage(safePage - 1)} title="Previous page">
                        <i className="fa fa-angle-left"/>
                    </Button>
                    <span style={{ fontSize: '13px', padding: '0 8px' }}>
                        Page <strong>{safePage}</strong> of <strong>{totalPages}</strong>
                    </span>
                    <Button size="sm" color="light" disabled={safePage === totalPages}
                            onClick={() => this.goToPage(safePage + 1)} title="Next page">
                        <i className="fa fa-angle-right"/>
                    </Button>
                    <Button size="sm" color="light" disabled={safePage === totalPages}
                            onClick={() => this.goToPage(totalPages)} title="Last page">
                        <i className="fa fa-angle-double-right"/>
                    </Button>
                </div>
            ) : null;

            let renderElement = "";

            if (gridMode === "card") {

                renderElement = (

                    <Container fluid={true} style={{display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0}}>

                        {filterBar}

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

                        {paginationBar}

                    </Container>

                )
            } else {
                let filterIconClass = "fa fa-lg fa-sort-desc";
                if(sortFilterAscending){
                    filterIconClass = "fa fa-lg fa-sort-asc";
                }
                renderElement = (

                    <Container fluid={true} className={"p-0"} style={{display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0}}>

                        {filterBar}

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
                                            checked={allPageSelected}
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
                                {totalFiltered > 0 ? (
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
                                            ) : localFilter ? (
                                                <span>No files match "<strong>{localFilter}</strong>" in this location.</span>
                                            ) : (
                                                'Empty - No files or directories'
                                            )}
                                        </td>
                                    </tr>
                                }
                                </tbody>
                            </Table>
                        </ScrollableDiv>

                        {paginationBar}
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
