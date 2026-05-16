import React, { useState, useEffect, useCallback } from 'react';
import {
    Button,
    Spinner,
    Table,
    Badge,
    Alert,
    Input,
    InputGroup,
    InputGroupText
} from 'reactstrap';
import axiosInstance from '../../utils/API/API';

/**
 * Lists containers/buckets from a remote and allows selecting multiple.
 * Selection-only — actual mounting is done by the parent via the Create button.
 */
const ContainerSelector = ({ remoteName, mountPoint, readOnly, selected, onSelectionChange }) => {
    const [containers, setContainers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [filter, setFilter] = useState('');

    const loadContainers = useCallback(async () => {
        if (!remoteName) return;
        setLoading(true);
        setError(null);
        try {
            const colonIndex = remoteName.indexOf(':');
            const fsName = colonIndex === -1 ? `${remoteName}:` :
                           colonIndex === remoteName.length - 1 ? remoteName : remoteName;

            const response = await axiosInstance.post('operations/list', {
                fs: fsName,
                remote: ''
            });

            const items = response.data.list || [];
            const dirs = items.filter(item => item.IsDir);
            setContainers(dirs);
            onSelectionChange(new Set(), dirs.length);
        } catch (err) {
            const msg = err.response?.data?.error || err.message;
            setError(msg);
        } finally {
            setLoading(false);
        }
    }, [remoteName, onSelectionChange]);

    useEffect(() => {
        if (remoteName) {
            loadContainers();
        }
    }, [remoteName, loadContainers]);

    const toggleSelect = (name) => {
        const next = new Set(selected);
        if (next.has(name)) {
            next.delete(name);
        } else {
            next.add(name);
        }
        onSelectionChange(next, containers.length);
    };

    const toggleAll = () => {
        if (selected.size === filteredContainers.length && filteredContainers.length > 0) {
            onSelectionChange(new Set(), containers.length);
        } else {
            onSelectionChange(new Set(filteredContainers.map(c => c.Name)), containers.length);
        }
    };

    const filteredContainers = containers.filter(c =>
        c.Name.toLowerCase().includes(filter.toLowerCase())
    );

    if (loading) {
        return (
            <div style={{ textAlign: 'center', padding: '20px' }}>
                <Spinner color="primary" /> Loading containers/buckets...
            </div>
        );
    }

    if (error) {
        return (
            <Alert color="danger">
                <i className="fa fa-exclamation-circle" style={{ marginRight: '6px' }} />
                Failed to list containers: {error}
                <Button color="link" size="sm" onClick={loadContainers} style={{ marginLeft: '10px' }}>
                    Retry
                </Button>
            </Alert>
        );
    }

    if (containers.length === 0) {
        return (
            <Alert color="info">
                <i className="fa fa-info-circle" style={{ marginRight: '6px' }} />
                No containers/buckets found in this remote, or the remote type does not use containers.
                You can mount the entire remote using the main form above.
            </Alert>
        );
    }

    const basePath = mountPoint || '/mnt';

    return (
        <div style={{ border: '1px solid #dee2e6', borderRadius: '4px', backgroundColor: '#fff' }}>
            {/* Header with selection info and controls */}
            <div style={{ padding: '10px', borderBottom: '1px solid #dee2e6', backgroundColor: '#f8f9fa' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <strong>
                        <i className="fa fa-th-list" style={{ marginRight: '6px', color: '#20a8d8' }} />
                        Containers / Buckets
                        <Badge color="secondary" pill style={{ marginLeft: '8px' }}>{containers.length}</Badge>
                    </strong>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        {selected.size > 0 && (
                            <span style={{ fontSize: '13px' }}>
                                <Badge color="primary">{selected.size}</Badge> of {containers.length} selected
                                {readOnly && <Badge color="warning" style={{ marginLeft: '6px' }}>RO</Badge>}
                            </span>
                        )}
                        <Button color="light" size="sm" onClick={loadContainers} title="Refresh">
                            <i className="fa fa-refresh" />
                        </Button>
                    </div>
                </div>
                <InputGroup size="sm">
                    <InputGroupText><i className="fa fa-search" /></InputGroupText>
                    <Input
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        placeholder="Filter containers..."
                    />
                </InputGroup>
            </div>

            {/* Scrollable container list */}
            <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                <Table hover size="sm" style={{ marginBottom: 0 }}>
                    <thead style={{ position: 'sticky', top: 0, backgroundColor: '#f8f9fa', zIndex: 1 }}>
                        <tr>
                            <th style={{ width: '44px', textAlign: 'center', verticalAlign: 'middle' }}>
                                <Input
                                    type="checkbox"
                                    checked={selected.size === filteredContainers.length && filteredContainers.length > 0}
                                    onChange={toggleAll}
                                    title={selected.size === filteredContainers.length ? 'Deselect all' : 'Select all'}
                                    style={{ position: 'static', width: '18px', height: '18px', cursor: 'pointer' }}
                                />
                            </th>
                            <th>
                                <span
                                    onClick={toggleAll}
                                    style={{ cursor: 'pointer', userSelect: 'none', color: '#20a8d8', fontSize: '12px' }}
                                >
                                    {selected.size === filteredContainers.length && filteredContainers.length > 0 ? 'Deselect all' : 'Select all'}
                                </span>
                            </th>
                            <th style={{ width: '160px' }}>Will mount as</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredContainers.map((c) => {
                            const isSelected = selected.has(c.Name);
                            const safeName = c.Name.replace(/[^a-zA-Z0-9._-]/g, '_');
                            return (
                                <tr
                                    key={c.Name}
                                    onClick={() => toggleSelect(c.Name)}
                                    style={{ cursor: 'pointer', backgroundColor: isSelected ? '#e8f4fd' : undefined }}
                                >
                                    <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                                        <Input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleSelect(c.Name)}
                                            onClick={(e) => e.stopPropagation()}
                                            style={{ position: 'static', width: '18px', height: '18px', cursor: 'pointer' }}
                                        />
                                    </td>
                                    <td>
                                        <i className="fa fa-database" style={{ color: '#ffc107', marginRight: '8px' }} />
                                        {c.Name}
                                    </td>
                                    <td style={{ fontSize: '12px', fontFamily: 'monospace', color: '#636f83' }}>
                                        {isSelected ? `${basePath}/${safeName}` : '—'}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </Table>
            </div>

            {/* Footer status */}
            {selected.size > 0 && (
                <div style={{ padding: '8px 10px', borderTop: '1px solid #dee2e6', backgroundColor: '#e8f4fd', fontSize: '13px', color: '#20a8d8' }}>
                    <i className="fa fa-info-circle" style={{ marginRight: '4px' }} />
                    Each selected container will be mounted as a subfolder under <code>{basePath}</code>.
                    Click <strong>Create</strong> to mount.
                </div>
            )}
        </div>
    );
};

export default ContainerSelector;
