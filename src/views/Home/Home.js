import React from 'react';
import {Alert, Button, Col, Row, Modal, ModalHeader, ModalBody, ModalFooter, FormGroup, Label, Input} from "reactstrap";
import BackendStatusCard from "../Base/BackendStatusCard/BackendStatusCard";
import RunningJobs from "../Base/RunningJobs";
import BandwidthStatusCard from "../Base/BandwidthStatusCard/BandwidthStatusCard";
import {connect} from "react-redux";
import * as PropTypes from 'prop-types';
import {exportSettings, importSettings} from "../../utils/API/director";
import {toast} from "react-toastify";

/**
 * Check if the current URL is a local/private network address
 */
function isLocalAccess() {
    const hostname = window.location.hostname;
    
    // Check for localhost
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
        return true;
    }
    
    // Check for private IPv4 ranges
    // 10.0.0.0 - 10.255.255.255
    // 172.16.0.0 - 172.31.255.255
    // 192.168.0.0 - 192.168.255.255
    if (/^10\./.test(hostname) || 
        /^192\.168\./.test(hostname) || 
        /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) {
        return true;
    }
    
    // Check for .local domains (mDNS)
    if (hostname.endsWith('.local')) {
        return true;
    }
    
    return false;
}

class Home extends React.Component {

    state = {
        isRefreshing: false,
        showExportModal: false,
        showImportModal: false,
        exportPassword: '',
        importPassword: '',
        importFile: null,
        importMode: 'merge',
        isExporting: false,
        isImporting: false
    };

    handleRefresh = () => {
        // Trigger a reload event
        this.setState({ isRefreshing: true });
        window.dispatchEvent(new CustomEvent('rclone-server-changed', { 
            detail: { manual: true } 
        }));
        // Show spinner for at least 800ms for visual feedback
        setTimeout(() => {
            this.setState({ isRefreshing: false });
        }, 800);
    };

    toggleExportModal = () => {
        this.setState(prevState => ({
            showExportModal: !prevState.showExportModal,
            exportPassword: ''
        }));
    };

    toggleImportModal = () => {
        this.setState(prevState => ({
            showImportModal: !prevState.showImportModal,
            importPassword: '',
            importFile: null,
            importMode: 'merge'
        }));
    };

    handleExport = async () => {
        const { exportPassword } = this.state;

        if (!exportPassword) {
            toast.error('Please enter your password');
            return;
        }

        this.setState({ isExporting: true });

        let data = null;
        try {
            data = await exportSettings(exportPassword);
            
            // Create download
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `rclone-director-backup-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            toast.success('Settings exported successfully!');
            this.toggleExportModal();
        } catch (error) {
            console.error('Export failed:', error);
            const errorMsg = error.response?.data?.error || error.message || 'Export failed';
            toast.error(`Export failed: ${errorMsg}`);
        } finally {
            // Clear sensitive data from memory
            if (data) {
                data = null;
            }
            this.setState({ isExporting: false, exportPassword: '' });
        }
    };

    handleFileSelect = (event) => {
        const file = event.target.files[0];
        if (!file) {
            return;
        }

        // Validate file size (max 50MB)
        const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
        if (file.size > MAX_FILE_SIZE) {
            toast.error('File is too large. Maximum size is 50MB.');
            event.target.value = ''; // Clear file input
            return;
        }

        // Validate file type
        if (!file.name.endsWith('.json')) {
            toast.error('Please select a JSON file.');
            event.target.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const json = JSON.parse(e.target.result);
                
                // Basic validation of structure
                if (!json.exportMetadata || !json.rcdServers || !json.templates) {
                    toast.error('Invalid backup file format. Missing required fields.');
                    event.target.value = '';
                    return;
                }

                this.setState({ importFile: json });
                toast.info('Backup file loaded successfully');
            } catch (error) {
                toast.error('Invalid JSON file. Please check the file format.');
                event.target.value = '';
            }
        };
        reader.onerror = () => {
            toast.error('Failed to read file');
            event.target.value = '';
        };
        reader.readAsText(file);
    };

    handleImport = async () => {
        const { importPassword, importFile, importMode } = this.state;

        if (!importPassword) {
            toast.error('Please enter your password');
            return;
        }

        if (!importFile) {
            toast.error('Please select a backup file');
            return;
        }

        this.setState({ isImporting: true });

        try {
            const result = await importSettings(importFile, importPassword, importMode);
            
            toast.success(`Import completed! ${result.statistics.servers.imported} servers, ${result.statistics.templates.imported} templates, ${result.statistics.mounts.imported} mounts imported.`);
            
            if (result.statistics.servers.skipped > 0 || result.statistics.templates.skipped > 0 || result.statistics.mounts.skipped > 0) {
                toast.info(`Skipped ${result.statistics.servers.skipped} servers, ${result.statistics.templates.skipped} templates, ${result.statistics.mounts.skipped} mounts (duplicates).`);
            }

            // Clear sensitive data from memory immediately
            this.setState({ 
                importFile: null,
                importPassword: '',
                showImportModal: false,
                isImporting: false
            });
            
            // Refresh the page to show imported data
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        } catch (error) {
            console.error('Import failed:', error);
            const errorMsg = error.response?.data?.error || error.response?.data?.details || error.message || 'Import failed';
            toast.error(`Import failed: ${errorMsg}`);
            
            // Clear password even on error
            this.setState({ isImporting: false, importPassword: '' });
        }
    };

    render() {
        const {checkStatus} = this.props;
        const {isRefreshing} = this.state;
        const showSecurityWarning = !isLocalAccess();
        
        return (
            <div data-test="homeComponent">
                {/* Action Buttons */}
                <div className="mb-3" style={{marginTop: "10px"}}>
                    <Button color="secondary" onClick={this.handleRefresh} disabled={isRefreshing} className="mr-2">
                        {isRefreshing ? (
                            <><i className="fa fa-spinner fa-spin"></i> Refreshing...</>
                        ) : (
                            <><i className="fa fa-refresh"></i> Refresh Dashboard</>
                        )}
                    </Button>
                    
                    <Button color="success" onClick={this.toggleExportModal} className="mr-2">
                        <i className="fa fa-download"></i> Export Settings
                    </Button>
                    
                    <Button color="primary" onClick={this.toggleImportModal}>
                        <i className="fa fa-upload"></i> Import Settings
                    </Button>
                </div>

                {/* Security Warning - only show for non-local access */}
                {showSecurityWarning && (
                <Alert 
                    color="danger" 
                    style={{
                        backgroundColor: '#8b0000',
                        color: '#ffffff',
                        border: '2px solid #660000',
                        marginBottom: '20px',
                        padding: '15px'
                    }}
                >
                    <h5 style={{color: '#ffffff', marginTop: '0'}}>
                        <i className="fa fa-exclamation-triangle" style={{marginRight: '10px'}}></i>
                        <strong>SECURITY WARNING</strong>
                    </h5>
                    <p style={{marginBottom: '10px', fontSize: '15px'}}>
                        <strong>We strongly discourage running this website directly on the internet, because the software was not carefully audited for security!</strong>
                    </p>
                    <p style={{marginBottom: '0', fontSize: '14px'}}>
                        Either run it with a self-signed SSL certificate on a local area network or use the <strong>"Website Protection"</strong> under <strong>"Security"</strong> of your Infinity Tools to add an extra username/password protection layer!
                    </p>
                </Alert>
                )}

                <Row>
                    <Col lg={6} sm={12}>
                        <BackendStatusCard mode={"card"}/>
                    </Col>
                    <Col lg={6} sm={12}>
                        <BandwidthStatusCard/>
                    </Col>
                </Row>
                <h2>Jobs</h2>
                {checkStatus ? <RunningJobs mode={"full-status"}/> : <p>Not Monitoring</p>}

                {/* Export Modal */}
                <Modal isOpen={this.state.showExportModal} toggle={this.toggleExportModal}>
                    <ModalHeader toggle={this.toggleExportModal}>
                        <i className="fa fa-download"></i> Export Decrypted Settings
                    </ModalHeader>
                    <ModalBody>
                        <p>This will export all your settings including:</p>
                        <ul>
                            <li>✅ RCD Server configurations (with decrypted passwords)</li>
                            <li>✅ Remote templates (with decrypted credentials)</li>
                            <li>✅ Persistent mount configurations</li>
                        </ul>
                        <Alert color="warning">
                            <strong><i className="fa fa-exclamation-triangle"></i> Security Note:</strong> The exported file contains decrypted passwords and should be stored securely!
                        </Alert>
                        <FormGroup>
                            <Label for="exportPassword">Re-enter your password to confirm:</Label>
                            <Input
                                type="password"
                                id="exportPassword"
                                placeholder="Enter your password"
                                value={this.state.exportPassword}
                                onChange={(e) => this.setState({ exportPassword: e.target.value })}
                                onKeyPress={(e) => e.key === 'Enter' && this.handleExport()}
                            />
                        </FormGroup>
                    </ModalBody>
                    <ModalFooter>
                        <Button color="secondary" onClick={this.toggleExportModal}>Cancel</Button>
                        <Button 
                            color="success" 
                            onClick={this.handleExport}
                            disabled={this.state.isExporting}>
                            {this.state.isExporting ? (
                                <><i className="fa fa-spinner fa-spin"></i> Exporting...</>
                            ) : (
                                <><i className="fa fa-download"></i> Export</>
                            )}
                        </Button>
                    </ModalFooter>
                </Modal>

                {/* Import Modal */}
                <Modal isOpen={this.state.showImportModal} toggle={this.toggleImportModal}>
                    <ModalHeader toggle={this.toggleImportModal}>
                        <i className="fa fa-upload"></i> Import Settings
                    </ModalHeader>
                    <ModalBody>
                        <p>Import settings from a backup file:</p>
                        
                        <FormGroup>
                            <Label for="importFile">Select backup file:</Label>
                            <Input
                                type="file"
                                id="importFile"
                                accept=".json"
                                onChange={this.handleFileSelect}
                            />
                            <small className="form-text text-muted">
                                Select a JSON backup file exported from Rclone Director
                            </small>
                        </FormGroup>

                        <FormGroup>
                            <Label for="importMode">Import Mode:</Label>
                            <Input
                                type="select"
                                id="importMode"
                                value={this.state.importMode}
                                onChange={(e) => this.setState({ importMode: e.target.value })}>
                                <option value="merge">Merge (keep existing + add new)</option>
                                <option value="replace">Replace (delete existing + add new)</option>
                            </Input>
                            <small className="form-text text-muted">
                                {this.state.importMode === 'merge' ? 
                                    'Existing settings will be kept, duplicates will be skipped.' : 
                                    '⚠️ WARNING: All existing settings will be deleted and replaced!'}
                            </small>
                        </FormGroup>

                        <FormGroup>
                            <Label for="importPassword">Re-enter your password to confirm:</Label>
                            <Input
                                type="password"
                                id="importPassword"
                                placeholder="Enter your password"
                                value={this.state.importPassword}
                                onChange={(e) => this.setState({ importPassword: e.target.value })}
                                onKeyPress={(e) => e.key === 'Enter' && this.handleImport()}
                            />
                        </FormGroup>

                        {this.state.importFile && (
                            <Alert color="info">
                                <strong>File loaded:</strong>
                                <ul style={{marginBottom: 0, marginTop: '10px'}}>
                                    <li>{this.state.importFile.rcdServers?.length || 0} servers</li>
                                    <li>{this.state.importFile.templates?.length || 0} templates</li>
                                    <li>{this.state.importFile.persistentMounts?.length || 0} mounts</li>
                                </ul>
                            </Alert>
                        )}
                    </ModalBody>
                    <ModalFooter>
                        <Button color="secondary" onClick={this.toggleImportModal}>Cancel</Button>
                        <Button 
                            color="primary" 
                            onClick={this.handleImport}
                            disabled={this.state.isImporting || !this.state.importFile}>
                            {this.state.isImporting ? (
                                <><i className="fa fa-spinner fa-spin"></i> Importing...</>
                            ) : (
                                <><i className="fa fa-upload"></i> Import</>
                            )}
                        </Button>
                    </ModalFooter>
                </Modal>

            </div>);
    }
}

const mapStateToProps = state => ({
    checkStatus: state.status.checkStatus
});

Home.propTypes = {
    checkStatus: PropTypes.bool.isRequired
};

export default connect(mapStateToProps, {})(Home);
