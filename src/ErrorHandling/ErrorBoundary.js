import React from "react";
import {Col, Container, Row, Button} from "reactstrap";

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = {hasError: false, errorType: 'generic'};
    }

    static getDerivedStateFromError(error) {
        // Update state so the next render will show the fallback UI.
        // Detect chunk loading errors
        const isChunkLoadError = error.name === 'ChunkLoadError' || 
                                 (error.message && error.message.includes('Loading chunk')) ||
                                 (error.message && error.message.includes('chunk'));
        
        return {
            hasError: true,
            errorType: isChunkLoadError ? 'chunk' : 'generic'
        };
    }

    componentDidCatch(error, info) {
        // Log error details
        console.error('[ErrorBoundary] Caught error:', error, info);
        this.setState({error, info});
    }

    handleReload = () => {
        window.location.reload();
    }

    handleClearCache = () => {
        try {
            localStorage.clear();
            sessionStorage.clear();
            console.log('[ErrorBoundary] Cache cleared, reloading...');
            window.location.reload();
        } catch (e) {
            console.error('[ErrorBoundary] Failed to clear cache:', e);
            window.location.reload();
        }
    }

    render() {
        if (this.state.hasError) {
            const {errorType, error} = this.state;
            
            // Chunk loading error - likely due to backend not running or network issues
            if (errorType === 'chunk') {
                return (
                    <div className="d-flex align-items-center justify-content-center" style={{minHeight: '100vh', backgroundColor: '#f4f4f4'}}>
                        <Container fluid={true}>
                            <Row>
                                <Col lg={3} sm={12}/>
                                <Col lg={6} sm={12}>
                                    <div style={{
                                        backgroundColor: 'white',
                                        padding: '40px',
                                        borderRadius: '8px',
                                        boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
                                    }}>
                                        <div style={{textAlign: 'center', marginBottom: '30px'}}>
                                            <i className="fa fa-exclamation-triangle" style={{
                                                fontSize: '60px',
                                                color: '#ffc107',
                                                marginBottom: '20px'
                                            }}></i>
                                            <h3 style={{color: '#333', marginBottom: '15px'}}>
                                                Unable to Load Application
                                            </h3>
                                        </div>
                                        
                                        <div style={{
                                            backgroundColor: '#fff3cd',
                                            border: '1px solid #ffc107',
                                            borderRadius: '4px',
                                            padding: '15px',
                                            marginBottom: '25px'
                                        }}>
                                            <p style={{marginBottom: '10px', fontSize: '15px'}}>
                                                <strong>Possible causes:</strong>
                                            </p>
                                            <ul style={{marginBottom: '0', fontSize: '14px'}}>
                                                <li>The <strong>Rclone Director backend</strong> is not running</li>
                                                <li>Network connectivity issues</li>
                                                <li>Cached application files are outdated</li>
                                            </ul>
                                        </div>
                                        
                                        <div style={{marginBottom: '25px'}}>
                                            <h5 style={{color: '#20a8d8', marginBottom: '15px'}}>
                                                <i className="fa fa-wrench"></i> Troubleshooting Steps:
                                            </h5>
                                            <ol style={{fontSize: '14px', lineHeight: '1.8'}}>
                                                <li>
                                                    <strong>Check if the Rclone Director backend is running:</strong>
                                                    <ul style={{marginTop: '5px'}}>
                                                        <li>Linux/Mac: Run <code>./start-dev.sh</code> in the project directory</li>
                                                        <li>Windows: Run <code>.\start-dev-windows.ps1</code> in PowerShell</li>
                                                    </ul>
                                                </li>
                                                <li><strong>Try reloading the page</strong> using the button below</li>
                                                <li><strong>Clear the browser cache</strong> and reload</li>
                                                <li>If the issue persists, check the browser console (F12) for more details</li>
                                            </ol>
                                        </div>
                                        
                                        <div style={{textAlign: 'center'}}>
                                            <Button 
                                                color="primary" 
                                                size="lg" 
                                                onClick={this.handleReload}
                                                style={{marginRight: '10px'}}
                                            >
                                                <i className="fa fa-refresh"></i> Reload Page
                                            </Button>
                                            <Button 
                                                color="warning" 
                                                size="lg" 
                                                onClick={this.handleClearCache}
                                            >
                                                <i className="fa fa-trash"></i> Clear Cache & Reload
                                            </Button>
                                        </div>
                                        
                                        {error && (
                                            <details style={{
                                                marginTop: '25px',
                                                padding: '10px',
                                                backgroundColor: '#f8f9fa',
                                                border: '1px solid #dee2e6',
                                                borderRadius: '4px',
                                                fontSize: '13px'
                                            }}>
                                                <summary style={{cursor: 'pointer', fontWeight: 'bold'}}>
                                                    Technical Details
                                                </summary>
                                                <pre style={{
                                                    marginTop: '10px',
                                                    marginBottom: '0',
                                                    whiteSpace: 'pre-wrap',
                                                    wordWrap: 'break-word'
                                                }}>
                                                    {error.toString()}
                                                    {error.stack && `\n\n${error.stack}`}
                                                </pre>
                                            </details>
                                        )}
                                    </div>
                                </Col>
                                <Col lg={3} sm={12}/>
                            </Row>
                        </Container>
                    </div>
                );
            }
            
            // Generic error
            return (
                <div className="d-flex align-items-center justify-content-center" style={{minHeight: '100vh', backgroundColor: '#f4f4f4'}}>
                    <Container fluid={true}>
                        <Row>
                            <Col lg={3} sm={12}/>
                            <Col lg={6} sm={12}>
                                <div style={{
                                    backgroundColor: 'white',
                                    padding: '40px',
                                    borderRadius: '8px',
                                    boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
                                }}>
                                    <div style={{textAlign: 'center', marginBottom: '20px'}}>
                                        <i className="fa fa-exclamation-circle" style={{
                                            fontSize: '60px',
                                            color: '#f86c6b',
                                            marginBottom: '20px'
                                        }}></i>
                                        <h3 style={{color: '#333'}}>Something went wrong</h3>
                                    </div>
                                    
                                    <p style={{fontSize: '15px', marginBottom: '20px'}}>
                                        An unexpected error occurred. Try refreshing the page or clearing your browser cache.
                                    </p>
                                    
                                    <div style={{marginBottom: '20px'}}>
                                        <p style={{fontSize: '14px', fontWeight: 'bold'}}>You can try:</p>
                                        <ol style={{fontSize: '14px', lineHeight: '1.8'}}>
                                            <li>Click the "Reload Page" button below</li>
                                            <li>Clear your browser cache and cookies</li>
                                            <li><a href="/#/login">Go to the login page</a></li>
                                            <li>
                                                If the issue persists, 
                                                <a href="https://github.com/rclone/rclone-webui-react/issues" target="_blank" rel="noopener noreferrer">
                                                    {' '}report an issue on GitHub
                                                </a>
                                            </li>
                                        </ol>
                                    </div>
                                    
                                    <div style={{textAlign: 'center', marginBottom: '20px'}}>
                                        <Button 
                                            color="primary" 
                                            size="lg" 
                                            onClick={this.handleReload}
                                            style={{marginRight: '10px'}}
                                        >
                                            <i className="fa fa-refresh"></i> Reload Page
                                        </Button>
                                        <Button 
                                            color="warning" 
                                            size="lg" 
                                            onClick={this.handleClearCache}
                                        >
                                            <i className="fa fa-trash"></i> Clear Cache & Reload
                                        </Button>
                                    </div>
                                    
                                    {error && (
                                        <details style={{
                                            padding: '10px',
                                            backgroundColor: '#f8f9fa',
                                            border: '1px solid #dee2e6',
                                            borderRadius: '4px',
                                            fontSize: '13px'
                                        }}>
                                            <summary style={{cursor: 'pointer', fontWeight: 'bold'}}>
                                                Technical Details
                                            </summary>
                                            <pre style={{
                                                marginTop: '10px',
                                                marginBottom: '0',
                                                whiteSpace: 'pre-wrap',
                                                wordWrap: 'break-word'
                                            }}>
                                                {error.toString()}
                                                {error.stack && `\n\n${error.stack}`}
                                            </pre>
                                        </details>
                                    )}
                                </div>
                            </Col>
                            <Col lg={3} sm={12}/>
                        </Row>
                    </Container>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;