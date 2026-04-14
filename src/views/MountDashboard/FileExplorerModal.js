import React, { useState, useEffect, useCallback } from 'react';
import {
    Modal,
    ModalHeader,
    ModalBody,
    ModalFooter,
    Button,
    Table,
    Spinner,
    Input,
    InputGroup,
    InputGroupText,
    Badge,
    Alert
} from 'reactstrap';
import { toast } from 'react-toastify';
import { browsePath, createDirectory } from '../../utils/API/director';

const FileExplorerModal = ({
    isOpen,
    onClose,
    onSelect,
    initialPath = '/',
    selectMode = 'directories',
    title = 'Browse Filesystem'
}) => {
    const [currentPath, setCurrentPath] = useState(initialPath || '/');
    const [items, setItems] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [searchFilter, setSearchFilter] = useState('');
    const [showNewFolderInput, setShowNewFolderInput] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [creatingFolder, setCreatingFolder] = useState(false);

    const loadDirectory = useCallback(async (targetPath) => {
        setIsLoading(true);
        setError(null);
        try {
            const result = await browsePath(targetPath, selectMode);
            if (result.success) {
                setItems(result.data.items || []);
                setCurrentPath(result.data.current_path);
            } else {
                setError(result.error || 'Failed to load directory');
            }
        } catch (err) {
            const msg = err.response?.data?.error || err.message || 'Failed to load directory';
            setError(msg);
        } finally {
            setIsLoading(false);
        }
    }, [selectMode]);

    useEffect(() => {
        if (isOpen) {
            setSearchFilter('');
            setShowNewFolderInput(false);
            setNewFolderName('');
            loadDirectory(initialPath || '/');
        }
    }, [isOpen, initialPath, loadDirectory]);

    const navigateTo = useCallback((path) => {
        setSearchFilter('');
        loadDirectory(path);
    }, [loadDirectory]);

    const handleItemClick = (item) => {
        if (item.is_directory) {
            navigateTo(item.path);
        }
    };

    const handleItemDoubleClick = (item) => {
        if (selectMode === 'directories' && item.is_directory) {
            onSelect([item.path]);
            onClose();
        }
    };

    const useCurrentDirectory = () => {
        onSelect([currentPath]);
        onClose();
    };

    const handleCreateFolder = async () => {
        if (!newFolderName.trim()) return;
        const newPath = `${currentPath}/${newFolderName.trim()}`.replace(/\/+/g, '/');
        setCreatingFolder(true);
        try {
            await createDirectory(newPath);
            toast.success('Directory created successfully');
            setShowNewFolderInput(false);
            setNewFolderName('');
            navigateTo(newPath);
        } catch (err) {
            toast.error(err.response?.data?.error || 'Failed to create directory');
        } finally {
            setCreatingFolder(false);
        }
    };

    const buildBreadcrumbs = () => {
        const parts = currentPath.split('/').filter(Boolean);
        const crumbs = [{ name: '/', path: '/' }];
        let accPath = '';
        for (const part of parts) {
            accPath += '/' + part;
            crumbs.push({ name: part, path: accPath });
        }
        return crumbs;
    };

    const parentPath = currentPath === '/' ? '/' : currentPath.replace(/\/[^/]+\/?$/, '') || '/';
    const isRoot = currentPath === '/';
    const breadcrumbs = buildBreadcrumbs();

    const filteredItems = items.filter((item) =>
        item.name.toLowerCase().includes(searchFilter.toLowerCase())
    );

    return (
        <Modal isOpen={isOpen} toggle={onClose} size="lg" backdrop="static" scrollable>
            <ModalHeader toggle={onClose}>
                <i className="fa fa-folder-open" style={{ color: '#20a8d8', marginRight: '8px' }} />
                {title}
            </ModalHeader>
            <ModalBody style={{ padding: 0 }}>
                {/* Docker info banner */}
                <Alert color="info" style={{ margin: '10px', marginBottom: 0, fontSize: '13px' }}>
                    <i className="fa fa-info-circle" style={{ marginRight: '6px' }} />
                    <strong>Running in Docker?</strong> Your host filesystem is mounted at{' '}
                    <Button color="link" size="sm" style={{ padding: 0, verticalAlign: 'baseline' }}
                        onClick={() => navigateTo('/host')}>
                        <code>/host</code>
                    </Button>
                    . For example, host path <code>/opt/mounts</code> is at <code>/host/opt/mounts</code>.
                </Alert>

                {/* Toolbar */}
                <div style={{ padding: '8px 10px', borderBottom: '1px solid #dee2e6', backgroundColor: '#f8f9fa' }}>
                    <div style={{ display: 'flex', gap: '4px', marginBottom: '6px', alignItems: 'center' }}>
                        <Button color="light" size="sm" title="Go to root"
                            onClick={() => navigateTo('/')}>
                            <i className="fa fa-home" />
                        </Button>
                        <Button color="light" size="sm" title="Go up" disabled={isRoot}
                            onClick={() => navigateTo(parentPath)}>
                            <i className="fa fa-arrow-up" />
                        </Button>
                        <Button color="light" size="sm" title="Refresh" disabled={isLoading}
                            onClick={() => loadDirectory(currentPath)}>
                            <i className={`fa fa-refresh ${isLoading ? 'fa-spin' : ''}`} />
                        </Button>
                        <div style={{ width: '1px', height: '20px', backgroundColor: '#ccc', margin: '0 4px' }} />
                        <Button color="light" size="sm" title="Create new folder"
                            onClick={() => setShowNewFolderInput(!showNewFolderInput)}>
                            <i className="fa fa-folder-plus" style={{ color: '#4dbd74' }} /> New Folder
                        </Button>
                    </div>

                    {/* Breadcrumbs */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px', fontSize: '13px', marginBottom: '6px' }}>
                        {breadcrumbs.map((crumb, index) => (
                            <React.Fragment key={crumb.path}>
                                {index > 0 && <i className="fa fa-chevron-right" style={{ fontSize: '9px', color: '#999', margin: '0 2px' }} />}
                                <Button
                                    color="link"
                                    size="sm"
                                    style={{
                                        padding: '1px 6px',
                                        fontSize: '13px',
                                        fontWeight: index === breadcrumbs.length - 1 ? 'bold' : 'normal',
                                        color: index === breadcrumbs.length - 1 ? '#20a8d8' : '#636f83',
                                        textDecoration: 'none'
                                    }}
                                    onClick={() => navigateTo(crumb.path)}
                                >
                                    {crumb.name}
                                </Button>
                            </React.Fragment>
                        ))}
                    </div>

                    {/* New folder input */}
                    {showNewFolderInput && (
                        <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
                            <Input
                                bsSize="sm"
                                value={newFolderName}
                                onChange={(e) => setNewFolderName(e.target.value)}
                                placeholder="New folder name"
                                autoFocus
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleCreateFolder();
                                    if (e.key === 'Escape') setShowNewFolderInput(false);
                                }}
                            />
                            <Button color="primary" size="sm" onClick={handleCreateFolder}
                                disabled={!newFolderName.trim() || creatingFolder}>
                                {creatingFolder ? <Spinner size="sm" /> : 'Create'}
                            </Button>
                            <Button color="secondary" size="sm" onClick={() => setShowNewFolderInput(false)}>
                                Cancel
                            </Button>
                        </div>
                    )}

                    {/* Search filter */}
                    <InputGroup size="sm">
                        <InputGroupText><i className="fa fa-search" /></InputGroupText>
                        <Input
                            value={searchFilter}
                            onChange={(e) => setSearchFilter(e.target.value)}
                            placeholder="Filter..."
                        />
                    </InputGroup>
                </div>

                {/* File list */}
                <div style={{ height: '320px', overflowY: 'auto' }}>
                    {isLoading ? (
                        <div style={{ textAlign: 'center', padding: '60px' }}>
                            <Spinner color="primary" style={{ width: '2rem', height: '2rem' }} />
                        </div>
                    ) : error ? (
                        <div style={{ textAlign: 'center', padding: '40px', color: '#856404' }}>
                            <i className="fa fa-exclamation-triangle" style={{ fontSize: '32px', marginBottom: '10px' }} />
                            <p>{error}</p>
                            <Button color="secondary" size="sm" onClick={() => navigateTo('/')}>Go to root</Button>
                        </div>
                    ) : filteredItems.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                            <i className="fa fa-folder-open-o" style={{ fontSize: '32px', marginBottom: '10px' }} />
                            <p>{searchFilter ? 'No matches found' : 'This directory is empty'}</p>
                        </div>
                    ) : (
                        <Table hover size="sm" style={{ marginBottom: 0 }}>
                            <thead style={{ position: 'sticky', top: 0, backgroundColor: '#f8f9fa', zIndex: 1 }}>
                                <tr>
                                    <th style={{ width: '60%' }}>Name</th>
                                    <th style={{ width: '20%' }}>Size</th>
                                    <th style={{ width: '20%' }}>Perms</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredItems.map((item) => {
                                    const isHostMount = item.path === '/host' && item.is_directory;
                                    return (
                                        <tr
                                            key={item.path}
                                            onClick={() => handleItemClick(item)}
                                            onDoubleClick={() => handleItemDoubleClick(item)}
                                            style={{
                                                cursor: item.is_directory ? 'pointer' : 'default',
                                                backgroundColor: isHostMount ? '#e8f8e8' : undefined,
                                                opacity: item.is_accessible === false ? 0.5 : 1
                                            }}
                                        >
                                            <td>
                                                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    {isHostMount ? (
                                                        <i className="fa fa-desktop" style={{ color: '#4dbd74' }} />
                                                    ) : item.is_directory ? (
                                                        <i className="fa fa-folder" style={{ color: '#ffc107' }} />
                                                    ) : (
                                                        <i className="fa fa-file-o" style={{ color: '#999' }} />
                                                    )}
                                                    <span style={{ fontWeight: isHostMount ? 'bold' : 'normal', color: isHostMount ? '#2f7a2f' : undefined }}>
                                                        {item.name}
                                                    </span>
                                                    {isHostMount && (
                                                        <Badge color="success" pill style={{ fontSize: '10px' }}>Host System</Badge>
                                                    )}
                                                    {item.is_symlink && (
                                                        <span style={{ color: '#999', fontSize: '11px' }}>→</span>
                                                    )}
                                                </span>
                                            </td>
                                            <td style={{ fontSize: '12px', color: '#666' }}>
                                                {item.is_file && item.size != null ? formatSize(item.size) : '—'}
                                            </td>
                                            <td style={{ fontSize: '12px', color: '#666', fontFamily: 'monospace' }}>
                                                {item.permissions || '—'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </Table>
                    )}
                </div>
            </ModalBody>
            <ModalFooter style={{ justifyContent: 'space-between' }}>
                <div style={{ fontSize: '13px', color: '#636f83' }}>
                    Current: <code style={{ backgroundColor: '#e8e8e8', padding: '2px 6px', borderRadius: '3px', fontSize: '12px' }}>{currentPath}</code>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <Button color="secondary" onClick={onClose}>Cancel</Button>
                    <Button color="primary" onClick={useCurrentDirectory}>
                        <i className="fa fa-check" style={{ marginRight: '4px' }} /> Select This Directory
                    </Button>
                </div>
            </ModalFooter>
        </Modal>
    );
};

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default FileExplorerModal;
