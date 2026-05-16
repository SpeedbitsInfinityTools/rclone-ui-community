import React from 'react';
import {
    Card,
    CardBody,
    CardHeader,
    Col,
    Row,
    Container,
    Table
} from 'reactstrap';
import { detectSystem } from '../../utils/detectSystem';

class Help extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            detectedSystem: detectSystem()
        };
    }

    isMatchingPlatform = (platform) => {
        const { detectedSystem } = this.state;
        const { os, arch } = detectedSystem;
        
        // macOS Universal matches all macOS systems
        if (platform === 'macos-universal' && os === 'macos') {
            return true;
        }
        
        // Check exact match
        const platformParts = platform.split('-');
        const platformOS = platformParts[0];
        const platformArch = platformParts[1];
        
        if (platformOS !== os) {
            return false;
        }
        
        // For Windows: Highlight both x64 and ARM64 (Firefox on Windows ARM is unreliable)
        if (os === 'windows') {
            // Only highlight ARM64 if we have high confidence it's ARM
            const ua = navigator.userAgent;
            const hasConfidentARM = /ARM64|Windows.*ARM64/i.test(ua) || 
                                     (navigator.userAgentData && navigator.userAgentData.platform && 
                                      navigator.userAgentData.platform.toLowerCase().includes('arm'));
            
            if (hasConfidentARM && arch === 'arm64') {
                return platformArch === 'arm64';
            }
            
            // Otherwise, highlight both Windows options
            return platformArch === 'x64' || platformArch === 'arm64';
        }
        
        // For Linux, check architecture
        if (os === 'linux') {
            return platformArch === arch || (platformArch === 'x64' && arch !== 'arm64');
        }
        
        return false;
    }

    render() {
        // Highlight style for matching platform
        const highlightStyle = {
            backgroundColor: '#e7f3ff',
            border: '3px solid #0066cc',
            fontWeight: 'bold'
        };
        
        return (
            <div className="animated fadeIn">
                <Container>
                    <Row>
                        <Col>
                            <Card>
                                <CardHeader>
                                    <i className="fa fa-question-circle"></i> <strong>Speedbits Rclone Director - Help & Documentation</strong>
                                </CardHeader>
                                <CardBody>
                                    
                                    {/* Installation with Infinity Tools */}
                                    <div style={{padding: '20px', backgroundColor: '#d4edda', border: '2px solid #28a745', borderRadius: '5px', marginBottom: '30px'}}>
                                        <h3 style={{color: '#155724', marginTop: '0px'}}>
                                            <i className="fa fa-rocket"></i> Quick Installation with Infinity Tools
                                        </h3>
                                        <p style={{fontSize: '16px', marginBottom: '10px'}}>
                                            <strong>For Infinity Tools users:</strong> Installing Rclone Director is just a few clicks away!
                                        </p>
                                        <ol style={{fontSize: '15px', lineHeight: '1.8'}}>
                                            <li>Open the <strong>Infinity Tools</strong> main menu on your Linux server</li>
                                            <li>Navigate to <strong>📦 Infinity Apps</strong></li>
                                            <li>Select <strong>"Rclone Director [Pro Feature]"</strong></li>
                                            <li>Choose your deployment mode:
                                                <ul style={{marginTop: '8px', marginBottom: '8px'}}>
                                                    <li><strong>Director UI Mode:</strong> Full web interface + backend (recommended for main server)</li>
                                                    <li><strong>Client-Only Mode:</strong> Rclone RCD backend only (for remote servers)</li>
                                                </ul>
                                            </li>
                                            <li>Follow the installation wizard</li>
                                            <li><strong>Done!</strong> Your Rclone Director is ready to use 🎉</li>
                                        </ol>
                                        <div style={{fontSize: '14px', color: '#155724', marginTop: '15px', marginBottom: '0px'}}>
                                            <div style={{marginBottom: '8px'}}>
                                                <i className="fa fa-info-circle"></i> <strong>For management:</strong>
                                            </div>
                                            <ul style={{marginLeft: '20px', marginBottom: '0px'}}>
                                                <li><strong>Director UI:</strong> Access via the provided URL</li>
                                                <li><strong>Client-Only (RCD):</strong> Manage via 💾 Backup Management → Rclone RCD</li>
                                            </ul>
                                            <div style={{marginTop: '8px'}}>
                                                <i className="fa fa-check-circle"></i> The Rclone Director will be automatically configured and accessible through the web interface or Infinity Tools menu.
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {/* What is this software */}
                                    <h3 style={{color: '#20a8d8', marginTop: '20px'}}>
                                        <i className="fa fa-info-circle"></i> What is Speedbits Rclone Director?
                                    </h3>
                                    <p>
                                        Speedbits Rclone Director is a modern web-based interface for managing <strong>rclone</strong>, 
                                        a powerful command-line program to manage files on cloud storage. This web UI makes it easy to:
                                    </p>
                                    <ul>
                                        <li>Configure and manage remote storage connections (S3, Google Drive, Dropbox, WebDAV, etc.)</li>
                                        <li>Browse and manage files across all your cloud storage providers</li>
                                        <li>Mount remote storage as local directories on your system</li>
                                        <li>Transfer files between different cloud providers</li>
                                        <li>Monitor rclone backend status and operations</li>
                                    </ul>

                                    <div style={{padding: '12px', backgroundColor: '#e7f3ff', border: '1px solid #b3d9ff', borderRadius: '4px', marginTop: '15px'}}>
                                        <i className="fa fa-lightbulb-o" style={{marginRight: '8px', color: '#0066cc'}}></i>
                                        <strong>Tip:</strong> This UI is part of the <a href="https://speedbits.io/infinity-tools/" target="_blank" rel="noopener noreferrer">Infinity Tools Pro+</a> ecosystem.
                                    </div>

                                    <hr style={{marginTop: '30px', marginBottom: '30px'}} />

                                    {/* Understanding Rclone Servers */}
                                    <h3 style={{color: '#20a8d8', marginTop: '20px'}}>
                                        <i className="fa fa-server"></i> Understanding Rclone Servers
                                    </h3>
                                    
                                    <p>
                                        The Rclone Director UI is the <strong>management interface</strong>, but it needs to connect to an <strong>Rclone RCD (Remote Control Daemon)</strong> 
                                        backend server to actually perform operations. Think of it as the "brain" (Director) talking to the "hands" (RCD backend).
                                    </p>

                                    <h4 style={{marginTop: '20px'}}>
                                        <i className="fa fa-puzzle-piece"></i> What is an Rclone Server?
                                    </h4>
                                    <p>
                                        An "Rclone Server" in this UI refers to an <strong>rclone RCD backend</strong> that can be running:
                                    </p>
                                    <ul>
                                        <li>On the <strong>same machine</strong> as the Director UI (local setup)</li>
                                        <li>On a <strong>different machine</strong> accessible over the network (remote setup)</li>
                                    </ul>
                                    <p>
                                        The Director can manage <strong>multiple rclone servers</strong>, allowing you to control cloud storage operations 
                                        on different machines from a single interface.
                                    </p>

                                    <h4 style={{marginTop: '20px'}}>
                                        <i className="fa fa-cogs"></i> Setup Architectures
                                    </h4>
                                    
                                    <div style={{marginTop: '15px'}}>
                                        <h5 style={{color: '#28a745'}}>
                                            <i className="fa fa-check-circle"></i> Architecture 1: Director UI + Local Rclone RCD (Single Server)
                                        </h5>
                                        <div style={{backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '4px', marginTop: '10px', border: '1px solid #dee2e6'}}>
                                            <pre style={{margin: 0, fontFamily: 'monospace', fontSize: '13px', color: '#333'}}>
{`┌─────────────────────────────────────┐
│   Same Server / Docker Host         │
│                                     │
│  ┌──────────────────────────────┐  │
│  │  Rclone Director UI          │  │
│  │  (Web Interface)             │  │
│  │  Port: 5573                  │  │
│  └──────────────┬───────────────┘  │
│                 │ talks to         │
│                 ▼                  │
│  ┌──────────────────────────────┐  │
│  │  Rclone RCD Backend          │  │
│  │  (Local)                     │  │
│  │  Port: 5572                  │  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘`}
                                            </pre>
                                        </div>
                                        <p style={{marginTop: '10px'}}>
                                            <strong>Use Case:</strong> Single-server setup where everything runs on one machine. 
                                            Perfect for personal use, development, or small deployments.
                                        </p>
                                        <ul style={{fontSize: '14px'}}>
                                            <li>✅ Simple setup - everything in one place</li>
                                            <li>✅ No network configuration needed</li>
                                            <li>✅ Fastest performance (local communication)</li>
                                            <li>⚠️ Limited to one server's resources</li>
                                        </ul>
                                    </div>

                                    <div style={{marginTop: '25px'}}>
                                        <h5 style={{color: '#20a8d8'}}>
                                            <i className="fa fa-sitemap"></i> Architecture 2: Director UI + Remote Rclone RCD (Multi-Server)
                                        </h5>
                                        <div style={{backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '4px', marginTop: '10px', border: '1px solid #dee2e6'}}>
                                            <pre style={{margin: 0, fontFamily: 'monospace', fontSize: '13px', color: '#333'}}>
{`┌─────────────────────────────────────┐
│   Management Server                 │
│                                     │
│  ┌──────────────────────────────┐  │
│  │  Rclone Director UI          │  │
│  │  (Web Interface)             │  │
│  │  Port: 5573                  │  │
│  └──────────────┬───────────────┘  │
└─────────────────┼───────────────────┘
                  │ talks to (over network)
                  │
        ┌─────────┴─────────┬─────────────┐
        ▼                   ▼             ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ Server A      │   │ Server B      │   │ Server C      │
│               │   │               │   │               │
│ Rclone RCD    │   │ Rclone RCD    │   │ Rclone RCD    │
│ 10.0.1.10     │   │ 10.0.1.20     │   │ 10.0.1.30     │
│ Port: 5572    │   │ Port: 5572    │   │ Port: 5572    │
└───────────────┘   └───────────────┘   └───────────────┘`}
                                            </pre>
                                        </div>
                                        <p style={{marginTop: '10px'}}>
                                            <strong>Use Case:</strong> Enterprise/multi-server setup where you manage cloud storage operations 
                                            on multiple remote machines from a central Director UI.
                                        </p>
                                        <ul style={{fontSize: '14px'}}>
                                            <li>✅ Centralized management of multiple servers</li>
                                            <li>✅ Distribute workload across machines</li>
                                            <li>✅ Servers can be in different locations/data centers</li>
                                            <li>✅ Scale horizontally as needed</li>
                                            <li>⚠️ Requires network connectivity and proper firewall configuration</li>
                                        </ul>
                                    </div>

                                    <h4 style={{marginTop: '25px'}}>
                                        <i className="fa fa-wrench"></i> Managing Rclone Servers
                                    </h4>
                                    <p>
                                        You can configure and manage your rclone servers in the <strong>Menu → Rclone Servers</strong> section:
                                    </p>
                                    <ol>
                                        <li><strong>View Servers:</strong> See all configured rclone servers and their connection status</li>
                                        <li><strong>Add Server:</strong> Click "Add Server" to configure a new rclone RCD connection
                                            <ul>
                                                <li>Enter server name (e.g., "Production Server", "Backup Server")</li>
                                                <li>Enter URL (e.g., <code>http://10.0.1.10:5572</code> or <code>https://server.example.com:5572</code>)</li>
                                                <li>Enter credentials (username and password configured in the RCD)</li>
                                            </ul>
                                        </li>
                                        <li><strong>Test Connection:</strong> Click "Try Connection" to verify the server is reachable</li>
                                        <li><strong>Set Default:</strong> Mark one server as the default for new operations</li>
                                        <li><strong>Switch Servers:</strong> Click the server name in the top navigation bar to switch between servers</li>
                                    </ol>

                                    <div style={{padding: '15px', backgroundColor: '#fff3cd', border: '2px solid #ffc107', borderRadius: '5px', marginTop: '20px'}}>
                                        <h5 style={{color: '#856404', marginTop: '0px'}}>
                                            <i className="fa fa-exclamation-triangle"></i> Important: Server Connection Required
                                        </h5>
                                        <p style={{fontSize: '15px', marginBottom: '10px'}}>
                                            The following features <strong>require an active connection</strong> to a rclone server:
                                        </p>
                                        <ul style={{fontSize: '14px', marginBottom: '10px'}}>
                                            <li><strong>Remotes:</strong> Cannot create, edit, or delete remotes when disconnected</li>
                                            <li><strong>Explorer:</strong> Cannot browse files or perform file operations when disconnected</li>
                                            <li><strong>Mounts:</strong> Cannot create or manage mounts when disconnected</li>
                                        </ul>
                                        <p style={{fontSize: '14px', color: '#856404', marginBottom: '0px'}}>
                                            <i className="fa fa-info-circle"></i> <strong>What to do if disconnected:</strong><br/>
                                            Click on the server name in the top navigation bar to switch to a connected server, 
                                            or go to <strong>Menu → Rclone Servers</strong> to check server status and configure connections.
                                        </p>
                                    </div>

                                    <hr style={{marginTop: '30px', marginBottom: '30px'}} />

                                    {/* Menu Sections */}
                                    <h3 style={{color: '#20a8d8', marginTop: '20px'}}>
                                        <i className="fa fa-bars"></i> Navigation Menu
                                    </h3>

                                    <h4 style={{marginTop: '20px'}}>
                                        <i className="icon-speedometer"></i> Dashboard
                                    </h4>
                                    <p>
                                        The main overview page showing system status, available remotes, and quick statistics. 
                                        The <strong>Overview card</strong> displays:
                                    </p>
                                    <ul>
                                        <li><strong>Connection Status:</strong> Whether the Director is connected to the rclone backend</li>
                                        <li><strong>Backend:</strong> Rclone Director mode and the rclone version running on the server</li>
                                        <li><strong>FUSE (Mounting):</strong> Whether FUSE is installed and available for drive mounting. Shows install instructions if missing.</li>
                                        <li><strong>Username:</strong> The currently logged-in user</li>
                                    </ul>

                                    <h4 style={{marginTop: '20px'}}>
                                        <i className="icon-note"></i> Remotes
                                    </h4>
                                    <p>
                                        View, create, edit, and delete remote storage configurations. Each remote represents a connection 
                                        to a cloud storage provider (e.g., AWS S3, Google Drive, Hetzner Object Storage, etc.).
                                    </p>
                                    <ul>
                                        <li><strong>Create New Remote:</strong> Click the "Create a New Remote" button to start the 4-step wizard</li>
                                        <li><strong>Edit Remote:</strong> Click "Edit" on any existing remote to modify its configuration</li>
                                        <li><strong>Delete Remote:</strong> Click "Delete" to remove a remote configuration</li>
                                    </ul>

                                    <h4 style={{marginTop: '20px'}}>
                                        <i className="icon-screen-desktop"></i> Explorer
                                    </h4>
                                    <p>
                                        Browse, upload, download, and manage files across all your configured remotes. 
                                        Features drag-and-drop file operations, multi-pane views, and powerful file management tools.
                                    </p>

                                    <h4 style={{marginTop: '20px'}}>
                                        <i className="icon-star"></i> Backend
                                    </h4>
                                    <p>
                                        Monitor the rclone backend service status, view running operations, and check system resources.
                                    </p>

                                    <h4 style={{marginTop: '20px'}}>
                                        <i className="fa fa-hdd-o"></i> Mounts
                                    </h4>
                                    <p>
                                        Create and manage mount points that make your remote storage appear as local directories on your host system. 
                                        Features include a built-in filesystem browser for creating mount directories, 
                                        bulk container/bucket mounting, read-only mode, bandwidth limiting, and permanent mounts that survive reboots.
                                    </p>

                                    <hr style={{marginTop: '30px', marginBottom: '30px'}} />

                                    {/* How to Set Up a Remote */}
                                    <h3 style={{color: '#20a8d8', marginTop: '20px'}}>
                                        <i className="fa fa-cloud"></i> How to Set Up a Remote
                                    </h3>
                                    
                                    <h4 style={{marginTop: '20px'}}>Step 1: Navigate to Remotes</h4>
                                    <p>Click on <strong>"Remotes"</strong> in the sidebar, then click the <strong>"Create a New Remote"</strong> button.</p>

                                    <h4 style={{marginTop: '20px'}}>Step 2: Choose Remote (Step 1 of 4)</h4>
                                    <ol>
                                        <li>Enter a <strong>name</strong> for your remote (e.g., "my-s3-storage", "gdrive-backup")</li>
                                        <li>Select the <strong>Remote Provider</strong> from the dropdown (e.g., S3, Google Drive, WebDAV, Local Disk)</li>
                                        <li>Click <strong>"Next"</strong></li>
                                    </ol>

                                    <h4 style={{marginTop: '20px'}}>Step 3: Configure Remote (Step 2 of 4)</h4>
                                    <p>Depending on your chosen provider, you'll need to enter different credentials:</p>
                                    
                                    <div style={{marginLeft: '20px', marginTop: '15px'}}>
                                        <h5><strong>For S3-Compatible Storage (AWS, Hetzner, DigitalOcean, etc.):</strong></h5>
                                        <ol>
                                            <li>Select your <strong>S3 Provider</strong> (e.g., "Any other S3 compatible provider" for Hetzner)</li>
                                            <li>Enter <strong>Endpoint URL</strong> (e.g., <code>fsn1.your-objectstorage.com</code> for Hetzner Falkenstein)</li>
                                            <li>Enter your <strong>Access Key ID</strong></li>
                                            <li>Enter your <strong>Secret Access Key</strong></li>
                                            <li>Optionally enter <strong>Region</strong> (e.g., "fsn1" for Hetzner, or leave blank)</li>
                                        </ol>

                                        <h5 style={{marginTop: '15px'}}><strong>For Local Disk:</strong></h5>
                                        <p>No configuration needed - you can skip settings and they will be auto-configured.</p>

                                        <h5 style={{marginTop: '15px'}}><strong>For WebDAV:</strong></h5>
                                        <ol>
                                            <li>Enter the <strong>WebDAV server URL</strong></li>
                                            <li>Enter your <strong>username</strong> and <strong>password</strong></li>
                                        </ol>
                                    </div>

                                    <h4 style={{marginTop: '20px'}}>Step 4: Advanced Options (Step 3 of 4)</h4>
                                    <p>
                                        Advanced settings for power users. You can safely skip this step for most configurations - 
                                        settings will be auto-configured with sensible defaults.
                                    </p>

                                    <h4 style={{marginTop: '20px'}}>Step 5: Test Remote (Step 4 of 4)</h4>
                                    <ol>
                                        <li>Click <strong>"Test Remote Config"</strong> to verify your configuration</li>
                                        <li>The system will test:
                                            <ul>
                                                <li>Connection to the remote</li>
                                                <li>Read access</li>
                                                <li>Write access</li>
                                            </ul>
                                        </li>
                                        <li>If all tests pass, click <strong>"Save & Finish"</strong></li>
                                    </ol>

                                    <div style={{padding: '12px', backgroundColor: '#d4edda', border: '1px solid #c3e6cb', borderRadius: '4px', marginTop: '15px'}}>
                                        <i className="fa fa-check-circle" style={{marginRight: '8px', color: '#155724'}}></i>
                                        <strong>Success!</strong> Your remote is now configured and ready to use.
                                    </div>

                                    <hr style={{marginTop: '30px', marginBottom: '30px'}} />

                                    {/* OAuth Authentication Explanation */}
                                    <h3 style={{color: '#20a8d8', marginTop: '20px'}}>
                                        <i className="fa fa-lock"></i> OAuth Authentication (Browser-Based Login)
                                    </h3>
                                    
                                    <p>
                                        Some cloud storage providers use <strong>OAuth authentication</strong> instead of API keys. 
                                        OAuth providers require you to log in through your browser rather than entering credentials directly.
                                    </p>

                                    <h4 style={{marginTop: '20px'}}>
                                        <i className="fa fa-cloud"></i> OAuth Providers Include:
                                    </h4>
                                    <ul>
                                        <li><strong>Google Drive</strong></li>
                                        <li><strong>Microsoft OneDrive</strong></li>
                                        <li><strong>Dropbox</strong></li>
                                        <li><strong>Box</strong></li>
                                        <li><strong>Yandex Disk</strong></li>
                                        <li>And others...</li>
                                    </ul>

                                    <div style={{padding: '15px', backgroundColor: '#e7f3ff', border: '2px solid #0066cc', borderRadius: '5px', marginTop: '20px', marginBottom: '20px'}}>
                                        <h4 style={{color: '#0066cc', marginTop: '0px'}}>
                                            <i className="fa fa-question-circle"></i> How OAuth Authentication Works
                                        </h4>
                                        <p style={{fontSize: '15px'}}>
                                            During remote setup (Step 2), when you click <strong>"Authenticate"</strong>, 
                                            a browser window opens where you log in to your cloud provider (e.g., Google, Dropbox). 
                                            After successful login, the provider redirects back to confirm authentication.
                                        </p>
                                    </div>

                                    <h4 style={{marginTop: '25px'}}>
                                        <i className="fa fa-sitemap"></i> Two OAuth Scenarios
                                    </h4>

                                    {/* Scenario 1: Local Director */}
                                    <div style={{marginTop: '20px'}}>
                                        <h5 style={{color: '#28a745'}}>
                                            <i className="fa fa-check-circle"></i> Scenario 1: Director Running Locally (Same Machine as Browser)
                                        </h5>
                                        <div style={{backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '4px', marginTop: '10px', border: '1px solid #28a745'}}>
                                            <pre style={{margin: 0, fontFamily: 'monospace', fontSize: '13px', color: '#333'}}>
{`┌────────────────────────────────────────────────┐
│   Your Computer / Localhost                    │
│                                                │
│  ┌──────────────────────────────────────────┐ │
│  │  Web Browser                             │ │
│  │  http://localhost:3000                   │ │
│  └────────────┬─────────────────────────────┘ │
│               │ connects to                   │
│               ▼                               │
│  ┌──────────────────────────────────────────┐ │
│  │  Rclone Director (localhost:5573)        │ │
│  └────────────┬─────────────────────────────┘ │
│               │ connects to                   │
│               ▼                               │
│  ┌──────────────────────────────────────────┐ │
│  │  Rclone RCD (localhost:5572)             │ │
│  └────────────┬─────────────────────────────┘ │
└───────────────┼────────────────────────────────┘
                │ OAuth redirect
                ▼
        ┌───────────────────┐
        │  Google / Dropbox │  ← You log in here
        │  OAuth Server     │
        └───────────────────┘`}
                                            </pre>
                                        </div>
                                        <div style={{padding: '12px', backgroundColor: '#d4edda', border: '1px solid #c3e6cb', borderRadius: '4px', marginTop: '15px'}}>
                                            <p style={{margin: '0', fontSize: '15px', color: '#155724'}}>
                                                <strong>✅ Simple Setup - Works Automatically!</strong><br/>
                                                When the Director is running on <code>localhost</code> or <code>127.0.0.1</code>, 
                                                OAuth authentication works seamlessly without any additional tools.
                                            </p>
                                        </div>
                                        <p style={{marginTop: '15px', fontSize: '14px'}}>
                                            <strong>What happens:</strong>
                                        </p>
                                        <ol style={{fontSize: '14px'}}>
                                            <li>You click "Authenticate" in the remote setup wizard (Step 2)</li>
                                            <li>A browser popup opens to Google/Dropbox/etc.</li>
                                            <li>You log in with your credentials</li>
                                            <li>The provider redirects back to <code>http://localhost:53682</code></li>
                                            <li>Rclone captures the authentication token automatically</li>
                                            <li>✅ Authentication complete!</li>
                                        </ol>
                                    </div>

                                    {/* Scenario 2: Remote Director */}
                                    <div style={{marginTop: '30px'}}>
                                        <h5 style={{color: '#dc3545'}}>
                                            <i className="fa fa-exclamation-triangle"></i> Scenario 2: Director Running Remotely (Different Machine)
                                        </h5>
                                        <div style={{backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '4px', marginTop: '10px', border: '1px solid #dc3545'}}>
                                            <pre style={{margin: 0, fontFamily: 'monospace', fontSize: '13px', color: '#333'}}>
{`┌───────────────────────────┐     Network     ┌────────────────────────────┐
│   Your Computer           │ ◄───────────────► │   Remote Server            │
│                           │                   │   (e.g., 91.107.194.73)    │
│  ┌─────────────────────┐  │                   │                            │
│  │  Web Browser        │  │                   │  ┌──────────────────────┐  │
│  │  https://server/... │  │                   │  │  Rclone Director     │  │
│  └──────────┬──────────┘  │                   │  │  Port: 5573          │  │
│             │              │                   │  └──────────┬───────────┘  │
│             │ connects to  │                   │             │              │
│             └──────────────┼───────────────────┼─────────────┘              │
│                            │                   │             │              │
│  ┌─────────────────────┐  │                   │  ┌──────────▼───────────┐  │
│  │  RcloneAuthApp      │  │ ◄─────────────────┼──│  Rclone RCD          │  │
│  │  (localhost:53682)  │  │  OAuth redirect   │  │  Port: 5572          │  │
│  └──────────┬──────────┘  │                   │  └──────────────────────┘  │
└─────────────┼──────────────┘                   └────────────────────────────┘
              │ OAuth redirect
              ▼
      ┌───────────────────┐
      │  Google / Dropbox │  ← You log in here
      │  OAuth Server     │
      └───────────────────┘`}
                                            </pre>
                                        </div>
                                        <div style={{padding: '15px', backgroundColor: '#fff3cd', border: '2px solid #ffc107', borderRadius: '4px', marginTop: '15px'}}>
                                            <p style={{margin: '0', fontSize: '15px', color: '#856404'}}>
                                                <strong>⚠️ Requires RcloneAuthApp Helper!</strong><br/>
                                                When the Director is running on a <strong>remote server</strong> (not localhost), 
                                                you need to run <strong>RcloneAuthApp</strong> on your local computer to capture OAuth redirects.
                                            </p>
                                        </div>

                                        <h5 style={{marginTop: '20px'}}>
                                            <i className="fa fa-download"></i> How to Set Up RcloneAuthApp
                                        </h5>
                                        
                                        <div style={{backgroundColor: '#f8f9fa', padding: '20px', borderRadius: '4px', marginTop: '15px', border: '1px solid #dee2e6'}}>
                                            <h6 style={{marginTop: '0', color: '#333'}}>
                                                <i className="fa fa-windows"></i> <strong>For Windows:</strong>
                                            </h6>
                                            <ol style={{fontSize: '14px', marginBottom: '20px'}}>
                                                <li>Download <code>RcloneAuthApp-Windows.zip</code> from the remote setup wizard (Step 2)</li>
                                                <li>Extract the ZIP file to a folder (e.g., <code>C:\RcloneAuth\</code>)</li>
                                                <li>Double-click <code>RcloneAuthApp.exe</code> to run it</li>
                                                <li>A small window appears showing "Listening on http://localhost:53682"</li>
                                                <li>Keep this app running during OAuth authentication</li>
                                            </ol>

                                            <h6 style={{color: '#333'}}>
                                                <i className="fa fa-apple"></i> <strong>For macOS:</strong>
                                            </h6>
                                            <ol style={{fontSize: '14px', marginBottom: '20px'}}>
                                                <li>Download <code>RcloneAuthApp-macOS.zip</code> from the remote setup wizard (Step 2)</li>
                                                <li>Extract the ZIP file</li>
                                                <li>Double-click <code>RcloneAuthApp</code> to run it</li>
                                                <li>If macOS blocks it, go to System Preferences → Security & Privacy → Click "Open Anyway"</li>
                                                <li>Keep this app running during OAuth authentication</li>
                                            </ol>

                                            <h6 style={{color: '#333'}}>
                                                <i className="fa fa-linux"></i> <strong>For Linux:</strong>
                                            </h6>
                                            <ol style={{fontSize: '14px', marginBottom: '0'}}>
                                                <li>Download <code>RcloneAuthApp-Linux.zip</code> from the remote setup wizard (Step 2)</li>
                                                <li>Extract the ZIP file</li>
                                                <li>Open terminal and navigate to the extracted folder</li>
                                                <li>Run: <code>chmod +x RcloneAuthApp && ./RcloneAuthApp</code></li>
                                                <li>Keep the terminal open during OAuth authentication</li>
                                            </ol>
                                        </div>

                                        <h5 style={{marginTop: '20px'}}>
                                            <i className="fa fa-download"></i> Download Rclone Auth Helper
                                        </h5>
                                        <p style={{marginBottom: '15px'}}>
                                            Download the Rclone Auth Helper app for your platform:
                                        </p>
                                        <Table striped responsive style={{marginTop: '10px', marginBottom: '20px'}}>
                                            <thead>
                                                <tr>
                                                    <th>Platform</th>
                                                    <th>Download</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr style={(this.isMatchingPlatform('windows-x64') || this.isMatchingPlatform('windows-arm64')) ? highlightStyle : {}}>
                                                    <td>
                                                        <i className="fa fa-windows" style={{marginRight: '8px', color: '#0078d4'}}></i>
                                                        Windows Installer (x64 & ARM64)
                                                        <div style={{fontSize: '0.85em', color: '#666', marginTop: '3px'}}>
                                                            165.79 MB • Setup wizard
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <a href="https://fsn1.your-objectstorage.com/speedbitspublic/rcloneauthhelper/Rclone.Auth.Helper.Setup.exe" 
                                                           target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-primary">
                                                            <i className="fa fa-download" style={{marginRight: '5px'}}></i>Download
                                                        </a>
                                                    </td>
                                                </tr>
                                                <tr style={(this.isMatchingPlatform('windows-x64') || this.isMatchingPlatform('windows-arm64')) ? highlightStyle : {}}>
                                                    <td>
                                                        <i className="fa fa-windows" style={{marginRight: '8px', color: '#0078d4'}}></i>
                                                        Windows Portable (x64 & ARM64)
                                                        <div style={{fontSize: '0.85em', color: '#666', marginTop: '3px'}}>
                                                            165.45 MB • No installation
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <a href="https://fsn1.your-objectstorage.com/speedbitspublic/rcloneauthhelper/Rclone.Auth.Helper-Portable.exe" 
                                                           target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-primary">
                                                            <i className="fa fa-download" style={{marginRight: '5px'}}></i>Download
                                                        </a>
                                                    </td>
                                                </tr>
                                                <tr style={this.isMatchingPlatform('macos-universal') ? highlightStyle : {}}>
                                                    <td>
                                                        <i className="fa fa-apple" style={{marginRight: '8px', color: '#555'}}></i>
                                                        macOS Universal
                                                        <div style={{fontSize: '0.85em', color: '#666', marginTop: '3px'}}>
                                                            185.32 MB • Intel & Apple Silicon
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <a href="https://fsn1.your-objectstorage.com/speedbitspublic/rcloneauthhelper/Rclone.Auth.Helper-universal.dmg" 
                                                           target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-primary">
                                                            <i className="fa fa-download" style={{marginRight: '5px'}}></i>Download
                                                        </a>
                                                    </td>
                                                </tr>
                                                <tr style={this.isMatchingPlatform('linux-x64') ? highlightStyle : {}}>
                                                    <td>
                                                        <i className="fa fa-linux" style={{marginRight: '8px', color: '#333'}}></i>
                                                        Linux x64
                                                        <div style={{fontSize: '0.85em', color: '#666', marginTop: '3px'}}>
                                                            107.09 MB • Portable archive
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <a href="https://fsn1.your-objectstorage.com/speedbitspublic/rcloneauthhelper/RcloneAuthApp-Linux-x64.tar.gz" 
                                                           target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-primary">
                                                            <i className="fa fa-download" style={{marginRight: '5px'}}></i>Download
                                                        </a>
                                                    </td>
                                                </tr>
                                                <tr style={this.isMatchingPlatform('linux-arm64') ? highlightStyle : {}}>
                                                    <td>
                                                        <i className="fa fa-linux" style={{marginRight: '8px', color: '#333'}}></i>
                                                        Linux ARM64
                                                        <div style={{fontSize: '0.85em', color: '#666', marginTop: '3px'}}>
                                                            107.23 MB • Portable archive
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <a href="https://fsn1.your-objectstorage.com/speedbitspublic/rcloneauthhelper/RcloneAuthApp-Linux-ARM64.tar.gz" 
                                                           target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-primary">
                                                            <i className="fa fa-download" style={{marginRight: '5px'}}></i>Download
                                                        </a>
                                                    </td>
                                                </tr>
                                            </tbody>
                                        </Table>

                                        <h5 style={{marginTop: '20px'}}>
                                            <i className="fa fa-play-circle"></i> Using RcloneAuthApp
                                        </h5>
                                        <ol style={{fontSize: '14px'}}>
                                            <li><strong>Start RcloneAuthApp</strong> on your local computer <em>before</em> clicking "Authenticate"</li>
                                            <li>In the remote setup wizard (Step 2), click <strong>"Authenticate"</strong></li>
                                            <li>A browser popup opens to Google/Dropbox/etc.</li>
                                            <li>Log in with your credentials</li>
                                            <li>The provider redirects to <code>http://localhost:53682</code></li>
                                            <li>RcloneAuthApp captures the token and forwards it to the remote Rclone RCD</li>
                                            <li>✅ Authentication complete! You can close RcloneAuthApp</li>
                                        </ol>

                                        <div style={{padding: '12px', backgroundColor: '#d1ecf1', border: '1px solid #bee5eb', borderRadius: '4px', marginTop: '15px'}}>
                                            <i className="fa fa-info-circle" style={{marginRight: '8px', color: '#0c5460'}}></i>
                                            <strong>Tip:</strong> You only need to run RcloneAuthApp <strong>during authentication</strong>. 
                                            Once your remote is configured, you don't need it anymore until you authenticate a new provider.
                                        </div>
                                    </div>

                                    <h4 style={{marginTop: '25px'}}>
                                        <i className="fa fa-question-circle"></i> Why is RcloneAuthApp Needed?
                                    </h4>
                                    <div style={{backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '4px', border: '1px solid #dee2e6'}}>
                                        <p style={{fontSize: '14px', marginBottom: '10px'}}>
                                            OAuth providers (Google, Dropbox, etc.) redirect to <code>http://localhost:53682</code> after you log in. 
                                            This works fine when Rclone is running locally, but creates a problem for remote setups:
                                        </p>
                                        <ul style={{fontSize: '14px', marginBottom: '10px'}}>
                                            <li><strong>Problem:</strong> When you're accessing a remote Director, the OAuth callback goes to <em>your local machine</em> (localhost), not the remote server</li>
                                            <li><strong>Solution:</strong> RcloneAuthApp runs on your local machine, captures the OAuth token at localhost:53682, and forwards it to the remote Rclone RCD server</li>
                                        </ul>
                                        <p style={{fontSize: '14px', marginBottom: '0', fontStyle: 'italic', color: '#666'}}>
                                            Think of RcloneAuthApp as a "bridge" that forwards OAuth tokens from your browser to the remote Rclone server.
                                        </p>
                                    </div>

                                    <h4 style={{marginTop: '25px'}}>
                                        <i className="fa fa-wrench"></i> Troubleshooting OAuth Authentication
                                    </h4>
                                    <div style={{marginTop: '15px'}}>
                                        <p><strong>❌ Authentication fails or times out:</strong></p>
                                        <ul style={{fontSize: '14px'}}>
                                            <li>Make sure RcloneAuthApp is running <em>before</em> clicking "Authenticate"</li>
                                            <li>Check that no other application is using port 53682</li>
                                            <li>Disable browser popup blockers</li>
                                            <li>Try using a different browser</li>
                                        </ul>

                                        <p style={{marginTop: '15px'}}><strong>❌ "Connection refused" error:</strong></p>
                                        <ul style={{fontSize: '14px'}}>
                                            <li>Verify RcloneAuthApp is actually running (check for "Listening on..." message)</li>
                                            <li>On Windows: Check Windows Firewall isn't blocking port 53682</li>
                                            <li>On macOS: Check System Preferences → Security & Privacy</li>
                                        </ul>

                                        <p style={{marginTop: '15px'}}><strong>❌ Browser says "This site can't be reached":</strong></p>
                                        <ul style={{fontSize: '14px'}}>
                                            <li>This is normal! The browser tries to connect to localhost:53682</li>
                                            <li>RcloneAuthApp should still capture the token from the URL</li>
                                            <li>Close the browser tab and check if authentication succeeded in the Director UI</li>
                                        </ul>
                                    </div>

                                    <hr style={{marginTop: '30px', marginBottom: '30px'}} />

                                    {/* How to Set Up Mounts */}
                                    <h3 style={{color: '#20a8d8', marginTop: '20px'}}>
                                        <i className="fa fa-hdd-o"></i> How to Set Up Mounts
                                    </h3>
                                    
                                    <p>
                                        Mounts allow you to access remote storage as if it were a local directory on your host system. 
                                        This is useful for applications that need direct file system access.
                                    </p>

                                    <h4 style={{marginTop: '20px'}}>Prerequisites</h4>
                                    <ul>
                                        <li>You must have at least one configured remote</li>
                                        <li><strong>FUSE must be installed</strong> on the server where rclone runs (check the Dashboard → Overview card for FUSE status)</li>
                                    </ul>

                                    <div style={{padding: '15px', backgroundColor: '#d1ecf1', border: '2px solid #17a2b8', borderRadius: '5px', marginTop: '15px'}}>
                                        <h5 style={{color: '#0c5460', marginTop: '0px'}}>
                                            <i className="fa fa-info-circle"></i> FUSE Requirement
                                        </h5>
                                        <p style={{fontSize: '15px', marginBottom: '10px'}}>
                                            Rclone uses <strong>FUSE</strong> (Filesystem in Userspace) to mount remote storage as local directories. 
                                            FUSE must be installed on the server where the rclone RCD backend runs.
                                        </p>
                                        <div style={{backgroundColor: '#f8f9fa', padding: '10px', borderRadius: '4px', fontFamily: 'monospace', fontSize: '14px', marginTop: '10px'}}>
                                            <strong>Install FUSE:</strong><br/>
                                            <code>apt install fuse3</code> (Debian/Ubuntu)<br/>
                                            <code>apk add fuse3</code> (Alpine)
                                        </div>
                                        <p style={{fontSize: '14px', marginTop: '10px', marginBottom: '0px', color: '#0c5460'}}>
                                            <i className="fa fa-check-circle"></i> The Dashboard Overview card shows whether FUSE is available on your rclone server.
                                        </p>
                                    </div>

                                    <h4 style={{marginTop: '20px'}}>Creating a Mount</h4>
                                    <ol>
                                        <li>Navigate to <strong>"Mounts"</strong> in the sidebar</li>
                                        <li>Click <strong>"Create new mount"</strong></li>
                                        <li>Fill in the mount configuration:
                                            <ul style={{marginTop: '8px'}}>
                                                <li><strong>Remote / Filesystem:</strong> Select your configured remote. Click the <strong>X</strong> button to clear and select a different one.</li>
                                                <li><strong>Source Subfolder:</strong> (Optional) Restrict the mount to a specific folder within the remote. Click <strong>Browse</strong> to explore available folders.</li>
                                                <li><strong>Test Connection:</strong> Click to verify read/write access before mounting.</li>
                                                <li><strong>Mount Point:</strong> The local directory where the remote will appear. Click <strong>Browse</strong> to navigate the filesystem and <strong>create folders</strong> directly from the UI (no SSH needed).</li>
                                                <li><strong>Permanent:</strong> When checked, the mount survives reboots and is automatically recreated on startup.</li>
                                                <li><strong>Mount read-only:</strong> Protects cloud data from accidental changes. The mount table shows <strong>RO</strong>/<strong>RW</strong> badges for each mount.</li>
                                                <li><strong>Bandwidth Limit:</strong> Throttle transfer speed (e.g., 10 MB/s) to prevent the mount from saturating your network.</li>
                                            </ul>
                                        </li>
                                        <li>Click <strong>"Create"</strong> and wait for the mount to complete</li>
                                    </ol>

                                    <h4 style={{marginTop: '20px'}}>
                                        <i className="fa fa-th-list"></i> Bulk Mounting Containers/Buckets
                                    </h4>
                                    <p>
                                        For cloud storage providers like Azure Blob Storage, AWS S3, or Google Cloud Storage, you can mount 
                                        individual containers or buckets as separate subfolders:
                                    </p>
                                    <ol>
                                        <li>Click <strong>"Select Individual Containers/Buckets"</strong> in the mount form</li>
                                        <li>Use the <strong>checkboxes</strong> to pick specific containers (or <strong>Select all</strong>)</li>
                                        <li>The status banner shows whether the entire storage account or specific containers will be mounted</li>
                                        <li>Click <strong>"Mount N Containers"</strong> — each container is mounted as a subfolder under your chosen mount point</li>
                                    </ol>

                                    <h4 style={{marginTop: '20px'}}>Managing Mounts</h4>
                                    <ul>
                                        <li><strong>View Active Mounts:</strong> The Mounts page shows all currently mounted remotes with their mount point, access mode, and remote source</li>
                                        <li><strong>Access Column:</strong> Shows <strong style={{color: '#28a745'}}>RW</strong> (read-write) or <strong style={{color: '#e0a800'}}>RO</strong> (read-only) badges for each mount</li>
                                        <li><strong>Unmount:</strong> Click "Unmount" next to a mount to disconnect it</li>
                                        <li><strong>Unmount All:</strong> Removes all active mounts at once</li>
                                        <li><strong>Access Files:</strong> Navigate to your mount point on the host system (e.g., <code>/mnt/my-s3-storage</code>)</li>
                                    </ul>

                                    <div style={{padding: '12px', backgroundColor: '#fff3cd', border: '1px solid #ffc107', borderRadius: '4px', marginTop: '15px'}}>
                                        <i className="fa fa-exclamation-triangle" style={{marginRight: '8px', color: '#856404'}}></i>
                                        <strong>Important:</strong> Permanent mounts are recreated automatically after reboot. Temporary mounts are lost on restart.
                                    </div>

                                    <h4 style={{marginTop: '25px'}}>
                                        <i className="fa fa-wrench"></i> Troubleshooting: "Couldn't Remove Mount"
                                    </h4>
                                    <p>
                                        If unmounting fails with an error, it's usually because the mount is <strong>"busy"</strong> - 
                                        something is actively using files from the mount.
                                    </p>

                                    <div style={{backgroundColor: '#f8d7da', border: '1px solid #f5c6cb', borderRadius: '4px', padding: '15px', marginTop: '15px'}}>
                                        <h5 style={{color: '#721c24', marginTop: '0'}}>
                                            <i className="fa fa-ban"></i> Common Causes of Busy Mounts:
                                        </h5>
                                        <ul style={{fontSize: '14px', color: '#721c24', marginBottom: '0'}}>
                                            <li><strong>Terminal/SSH session is in the mount directory</strong> - Close the terminal or <code>cd</code> out of the mount</li>
                                            <li><strong>File is open in an application</strong> - Close any editors, viewers, or media players accessing mount files</li>
                                            <li><strong>Background process accessing files</strong> - Wait for operations to complete or stop the process</li>
                                            <li><strong>File transfer in progress</strong> - Wait for uploads/downloads to finish</li>
                                        </ul>
                                    </div>

                                    <h5 style={{marginTop: '20px'}}>Solution Steps:</h5>
                                    <ol style={{fontSize: '14px'}}>
                                        <li>Check which processes are using the mount:
                                            <div style={{backgroundColor: '#f8f9fa', padding: '10px', borderRadius: '4px', fontFamily: 'monospace', fontSize: '13px', marginTop: '8px'}}>
                                                <code>lsof +D /mnt/my-storage</code>
                                            </div>
                                        </li>
                                        <li>Close any terminals that are inside the mount directory</li>
                                        <li>Close applications with open files from the mount</li>
                                        <li>Try unmounting again from the UI</li>
                                    </ol>

                                    <h5 style={{marginTop: '20px'}}>
                                        <i className="fa fa-bolt"></i> Force Unmount (Last Resort):
                                    </h5>
                                    <div style={{backgroundColor: '#fff3cd', border: '2px solid #ffc107', borderRadius: '4px', padding: '12px', marginTop: '10px'}}>
                                        <p style={{fontSize: '14px', color: '#856404', marginBottom: '8px'}}>
                                            <strong>⚠️ WARNING:</strong> Force unmounting can cause data loss if files are being written! 
                                            Only use this as a last resort.
                                        </p>
                                        <div style={{backgroundColor: '#f8f9fa', padding: '10px', borderRadius: '4px', fontFamily: 'monospace', fontSize: '13px', marginTop: '10px'}}>
                                            <strong>Run via SSH on your server:</strong><br/>
                                            <code>sudo fusermount -uz /mnt/my-storage</code><br/>
                                            <strong>Or:</strong><br/>
                                            <code>sudo umount -l /mnt/my-storage</code>
                                        </div>
                                        <p style={{fontSize: '13px', color: '#856404', marginTop: '8px', marginBottom: '0', fontStyle: 'italic'}}>
                                            The <code>-uz</code> flag forces unmount even if busy. The <code>-l</code> flag (lazy unmount) detaches the filesystem immediately.
                                        </p>
                                    </div>

                                    <hr style={{marginTop: '30px', marginBottom: '30px'}} />

                                    {/* Where Configs Are Stored */}
                                    <h3 style={{color: '#20a8d8', marginTop: '20px'}}>
                                        <i className="fa fa-folder-open"></i> Where Configurations Are Stored
                                    </h3>

                                    <h4 style={{marginTop: '20px'}}>Docker Deployment Architecture</h4>
                                    <p>
                                        In the Speedbits Infinity Tools deployment, the Rclone Director runs as follows:
                                    </p>
                                    <ul>
                                        <li><strong>Frontend (Web UI):</strong> Runs in a Docker container</li>
                                        <li><strong>Rclone Backend:</strong> Runs on the <strong>host system</strong> (not in Docker)</li>
                                        <li><strong>Configuration Files:</strong> Stored on the <strong>host system</strong></li>
                                    </ul>

                                    <h4 style={{marginTop: '20px'}}>Configuration File Locations</h4>
                                    
                                    <div style={{backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '4px', marginTop: '15px', fontFamily: 'monospace'}}>
                                        <strong>Main Configuration Directory:</strong><br/>
                                        <code style={{fontSize: '14px'}}>/opt/speedbits/rclone-director-ui/</code>
                                    </div>

                                    <div style={{marginTop: '15px'}}>
                                        <h5><strong>Key Files:</strong></h5>
                                        <ul style={{fontFamily: 'monospace', fontSize: '14px'}}>
                                            <li><code>/opt/speedbits/rclone-director-ui/config/rclone.conf</code> - Rclone remote configurations</li>
                                            <li><code>/opt/speedbits/rclone-director-ui/docker-compose.yml</code> - Docker Compose configuration</li>
                                            <li><code>/opt/speedbits/rclone-director-ui/logs/</code> - Rclone logs (if configured)</li>
                                        </ul>
                                    </div>

                                    <h4 style={{marginTop: '20px'}}>Rclone Backend Service</h4>
                                    <p>The rclone backend runs as a systemd service on the host:</p>
                                    <div style={{backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '4px', marginTop: '10px', fontFamily: 'monospace'}}>
                                        <strong>Service Name:</strong> <code>rclone-ui-backend.service</code><br/>
                                        <strong>Status:</strong> <code>sudo systemctl status rclone-ui-backend</code><br/>
                                        <strong>Start:</strong> <code>sudo systemctl start rclone-ui-backend</code><br/>
                                        <strong>Stop:</strong> <code>sudo systemctl stop rclone-ui-backend</code><br/>
                                        <strong>Restart:</strong> <code>sudo systemctl restart rclone-ui-backend</code>
                                    </div>

                                    <h4 style={{marginTop: '20px'}}>Mount Points</h4>
                                    <p>Default mount points are created under:</p>
                                    <div style={{backgroundColor: '#f8f9fa', padding: '15px', borderRadius: '4px', marginTop: '10px', fontFamily: 'monospace'}}>
                                        <code>/mnt/&lt;remote_name&gt;/</code>
                                    </div>
                                    <p style={{marginTop: '10px'}}>
                                        For example, if you create a remote named "my-storage", 
                                        the mount point will be <code>/mnt/my-storage/</code>
                                    </p>

                                    <h4 style={{marginTop: '20px'}}>Backup Your Configuration</h4>
                                    <div style={{padding: '12px', backgroundColor: '#d1ecf1', border: '1px solid #bee5eb', borderRadius: '4px', marginTop: '15px'}}>
                                        <i className="fa fa-info-circle" style={{marginRight: '8px', color: '#0c5460'}}></i>
                                        <strong>Tip:</strong> Your rclone configuration is stored in plain text at 
                                        <code>/opt/speedbits/rclone-director-ui/config/rclone.conf</code>. 
                                        Back up this file regularly to preserve your remote configurations!
                                    </div>

                                    <hr style={{marginTop: '30px', marginBottom: '30px'}} />

                                    {/* Additional Resources */}
                                    <h3 style={{color: '#20a8d8', marginTop: '20px'}}>
                                        <i className="fa fa-book"></i> Additional Resources
                                    </h3>
                                    
                                    <ul>
                                        <li>
                                            <strong>Official Rclone Documentation:</strong> <a href="https://rclone.org/docs/" target="_blank" rel="noopener noreferrer">https://rclone.org/docs/</a>
                                        </li>
                                        <li>
                                            <strong>Rclone Commands Reference:</strong> <a href="https://rclone.org/commands/" target="_blank" rel="noopener noreferrer">https://rclone.org/commands/</a>
                                        </li>
                                        <li>
                                            <strong>Speedbits Infinity Tools:</strong> <a href="https://speedbits.io/infinity-tools/" target="_blank" rel="noopener noreferrer">https://speedbits.io/infinity-tools/</a>
                                        </li>
                                        <li>
                                            <strong>GitHub Repository:</strong> <a href="https://github.com/rclone/rclone-webui-react" target="_blank" rel="noopener noreferrer">https://github.com/rclone/rclone-webui-react</a>
                                        </li>
                                    </ul>

                                    <div style={{padding: '15px', backgroundColor: '#e7f3ff', border: '1px solid #b3d9ff', borderRadius: '4px', marginTop: '30px', textAlign: 'center'}}>
                                        <h4 style={{color: '#0066cc'}}>Need Help?</h4>
                                        <p>
                                            For support with Speedbits Infinity Tools, visit <a href="https://speedbits.io" target="_blank" rel="noopener noreferrer">speedbits.io</a>
                                        </p>
                                    </div>

                                </CardBody>
                            </Card>
                        </Col>
                    </Row>
                </Container>
            </div>
        );
    }
}

export default Help;

