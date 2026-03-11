import React, {useState} from "react";
import {Button, DropdownItem, DropdownMenu, DropdownToggle, UncontrolledButtonDropdown, UncontrolledTooltip, Spinner} from "reactstrap";
import * as PropTypes from "prop-types";
import * as RclonePropTypes from "../../../utils/RclonePropTypes";
import ConfirmModal from "../../../components/ConfirmModal";

function FileActions({downloadHandle, deleteHandle, item, linkShareHandle, infoHandle, isDownloading}) {
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const toggleDeleteModal = () => setShowDeleteModal(!showDeleteModal);

    const confirmDelete = () => {
        setShowDeleteModal(true);
    };

    const handleConfirmDelete = async () => {
        setIsDeleting(true);
        try {
            await deleteHandle(item);
            toggleDeleteModal();
        } catch (error) {
            console.error('Delete failed:', error);
        } finally {
            setIsDeleting(false);
        }
    };

    const {IsDir} = item;
    
    // Create a safe ID by removing spaces and special characters
    // Use a hash or index if available, otherwise sanitize the filename
    const safeId = (item.ID || item.Name).replace(/[^a-zA-Z0-9-_]/g, '-');
    // let {ID, Name} = item;
    // // Using fallback as fileName when the ID is not available (for local file system)
    // if (ID === undefined) {
    //     ID = Name;
    // }

    return (
        <div data-test="fileActionsComponent">
            {!IsDir && <>
                {isDownloading ? (
                    <span id={`download-${safeId}`} style={{padding: '0.375rem 0.75rem', display: 'inline-block'}}>
                        <Spinner size="sm" color="primary"/>
                    </span>
                ) : (
                    <>
                        <Button color="link" onClick={() => downloadHandle(item)} data-test="btn-download" id={`download-${safeId}`}>
                            <i className={"fa fa-cloud-download fa-lg d-inline"}/>
                        </Button>
                        <UncontrolledTooltip placement="top" target={`download-${safeId}`}>
                            Download
                        </UncontrolledTooltip>
                    </>
                )}
            </>}
            <Button color="link" onClick={() => infoHandle(item)} data-test="btn-info" id={`info-${safeId}`}>
                <i className="fa fa-info-circle"/>
            </Button>
            <UncontrolledTooltip placement="top" target={`info-${safeId}`}>
                File Info
            </UncontrolledTooltip>

            <UncontrolledButtonDropdown>
                <DropdownToggle color="link">
                    <i className="fa fa-ellipsis-v"/>
                </DropdownToggle>
                <DropdownMenu>
                    <DropdownItem header>Actions</DropdownItem>
                    <DropdownItem data-test="btn-share-with-link" onClick={() => linkShareHandle(item)}><i
                        className="fa fa-share fa-lg d-inline"/> Share with link</DropdownItem>
                    <DropdownItem divider/>
                    <DropdownItem data-test="btn-delete-item" onClick={confirmDelete}><i
                        className="fa fa-remove fa-lg d-inline text-danger"/> Delete </DropdownItem>
                </DropdownMenu>
            </UncontrolledButtonDropdown>

            {/* Delete Confirmation Modal */}
            <ConfirmModal
                isOpen={showDeleteModal}
                toggle={toggleDeleteModal}
                onConfirm={handleConfirmDelete}
                title={`Delete ${IsDir ? 'Folder' : 'File'}`}
                message={
                    <>
                        <p>Are you sure you want to delete <strong>{item.Name}</strong>?</p>
                        {IsDir && (
                            <p className="text-warning mb-2">
                                <i className="fa fa-info-circle"></i> This will delete the folder and all its contents.
                            </p>
                        )}
                        <p className="text-danger mb-0">
                            <i className="fa fa-exclamation-triangle"></i> This action cannot be undone!
                        </p>
                    </>
                }
                confirmText="Delete"
                cancelText="Cancel"
                confirmColor="danger"
                icon="fa-trash"
                isLoading={isDeleting}
            />
        </div>
    )
}

FileActions.propTypes = {
    downloadHandle: PropTypes.func.isRequired,
    infoHandle: PropTypes.func.isRequired,
    deleteHandle: PropTypes.func.isRequired,
    item: RclonePropTypes.PROP_ITEM.isRequired,
    linkShareHandle: PropTypes.func.isRequired,
    isDownloading: PropTypes.bool
}

export default FileActions;