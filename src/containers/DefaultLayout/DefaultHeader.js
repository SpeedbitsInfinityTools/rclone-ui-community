import React from 'react';
import {Nav} from 'reactstrap';
import PropTypes from 'prop-types';

import {AppNavbarBrand, AppSidebarToggler} from '@coreui/react';
import logo from '../../assets/img/brand/speedbits-logo.svg'
import favicon from '../../assets/img/brand/favicon.png'
import ServerSelector from "../../views/Base/ServerSelector/ServerSelector";

const propTypes = {
    children: PropTypes.node,
};

const defaultProps = {};

function DefaultHeader(props) {
    // eslint-disable-next-line
    const {children, ...attributes} = props;

    return (
        <React.Fragment>
            <AppSidebarToggler className="d-lg-none" display="md" mobile/>
            {/* Logo - hidden on mobile, shown on desktop */}
            <div className="d-none d-lg-block" style={{marginLeft: '8px'}}>
                <AppNavbarBrand
                    full={{src: logo, width: 360, height: 50, alt: 'Speedbits Logo'}}
                    minimized={{src: favicon, width: 30, height: 30, alt: 'Speedbits'}}
                />
            </div>
            <span className="navbar-text d-none d-lg-inline" style={{fontSize: '16px', fontWeight: 'normal', color: '#73818f', marginLeft: '0'}}>
                Rclone Director
            </span>

            <Nav className="ml-auto" navbar style={{alignItems: 'center', gap: '12px'}}>
                {/* Report an Error Button */}
                <a 
                    href="https://speedbits.io/contact/?type=Rclone%20UI" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '6px 12px',
                        fontSize: '12px',
                        fontWeight: '500',
                        color: '#4b5563',
                        backgroundColor: '#f3f4f6',
                        border: '1px solid #ef4444',
                        borderRadius: '6px',
                        textDecoration: 'none',
                        transition: 'background-color 0.15s ease',
                    }}
                    onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#e5e7eb'}
                    onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
                >
                    <svg 
                        xmlns="http://www.w3.org/2000/svg" 
                        width="14" 
                        height="14" 
                        viewBox="0 0 24 24" 
                        fill="none" 
                        stroke="currentColor" 
                        strokeWidth="2" 
                        strokeLinecap="round" 
                        strokeLinejoin="round"
                        style={{marginRight: '6px'}}
                    >
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                    Report an error
                </a>
                <ServerSelector />
            </Nav>

        </React.Fragment>
    );
}

DefaultHeader.propTypes = propTypes;
DefaultHeader.defaultProps = defaultProps;

export default DefaultHeader;
