import React, { useState } from 'react';
import { Input, InputGroup, Button } from 'reactstrap';
import FileExplorerModal from './FileExplorerModal';

const PathSelectorField = ({
    value,
    onChange,
    placeholder = '/mnt/remote',
    disabled = false,
    style = {}
}) => {
    const [showBrowser, setShowBrowser] = useState(false);

    const handleSelect = (paths) => {
        if (paths.length > 0) {
            onChange(paths[0]);
        }
        setShowBrowser(false);
    };

    const getInitialPath = () => {
        if (!value) return '/';
        const firstPath = value.split(',')[0].trim();
        return firstPath || '/';
    };

    return (
        <>
            <InputGroup>
                <Input
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    disabled={disabled}
                    style={{
                        border: '2px solid #20a8d8',
                        fontWeight: 'bold',
                        fontSize: '16px',
                        ...style
                    }}
                />
                <Button
                    color="info"
                    onClick={() => setShowBrowser(true)}
                    disabled={disabled}
                    title="Browse filesystem"
                >
                    <i className="fa fa-folder-open" /> Browse
                </Button>
            </InputGroup>

            <FileExplorerModal
                isOpen={showBrowser}
                onClose={() => setShowBrowser(false)}
                onSelect={handleSelect}
                initialPath={getInitialPath()}
                selectMode="directories"
                title="Select Mount Point Directory"
            />
        </>
    );
};

export default PathSelectorField;
