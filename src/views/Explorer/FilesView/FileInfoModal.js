import React from 'react';
import {Modal, ModalBody, ModalHeader, Table} from 'reactstrap';
import PropTypes from 'prop-types';
import {formatBytes} from '../../../utils/Tools';
import * as RclonePropTypes from '../../../utils/RclonePropTypes';

/**
 * Modal to display file/folder information
 */
function FileInfoModal({isOpen, toggle, item, remoteName, remotePath}) {
    if (!item) return null;

    const {Name, Size, ModTime, MimeType, IsDir, IsBucket, Path} = item;
    const modTime = new Date(ModTime);
    const fullPath = remoteName + (remotePath ? ':' + remotePath : ':') + '/' + Path;
    
    // Determine icon and type
    let iconClass = "fa fa-file";
    let itemType = "File";
    if (IsBucket) {
        iconClass = "fa fa-database";
        itemType = "Bucket";
    } else if (IsDir) {
        iconClass = "fa fa-folder";
        itemType = "Folder";
    }

    return (
        <Modal isOpen={isOpen} toggle={toggle}>
            <ModalHeader toggle={toggle}>
                <i className={iconClass}/> {Name}
            </ModalHeader>
            <ModalBody>
                <Table bordered size="sm">
                    <tbody>
                        <tr>
                            <th style={{width: '40%'}}>Name</th>
                            <td>{Name}</td>
                        </tr>
                        <tr>
                            <th>Type</th>
                            <td>{itemType}</td>
                        </tr>
                        {!IsDir && (
                            <tr>
                                <th>Size</th>
                                <td>{Size === -1 ? "-" : formatBytes(Size, 2)}</td>
                            </tr>
                        )}
                        <tr>
                            <th>Modified</th>
                            <td>{modTime.toLocaleString()}</td>
                        </tr>
                        {!IsDir && MimeType && (
                            <tr>
                                <th>MIME Type</th>
                                <td><code>{MimeType}</code></td>
                            </tr>
                        )}
                        <tr>
                            <th>Path</th>
                            <td style={{wordBreak: 'break-all'}}><code>{Path}</code></td>
                        </tr>
                        <tr>
                            <th>Full Path</th>
                            <td style={{wordBreak: 'break-all'}}><code>{fullPath}</code></td>
                        </tr>
                    </tbody>
                </Table>
            </ModalBody>
        </Modal>
    );
}

FileInfoModal.propTypes = {
    isOpen: PropTypes.bool.isRequired,
    toggle: PropTypes.func.isRequired,
    item: RclonePropTypes.PROP_ITEM,
    remoteName: PropTypes.string.isRequired,
    remotePath: PropTypes.string.isRequired
};

export default FileInfoModal;

