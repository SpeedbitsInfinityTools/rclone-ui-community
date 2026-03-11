import React, {Component} from 'react';
import PropTypes from 'prop-types';
import appPackage from '../../../package.json';

const propTypes = {
    children: PropTypes.node,
};

const defaultProps = {};

class DefaultFooter extends Component {
    render() {

        // eslint-disable-next-line
        const {children, ...attributes} = this.props;
        const appVersion = process.env.REACT_APP_VERSION || appPackage.version || 'dev';

        return (
            <React.Fragment>
                <span>© <a href="https://speedbits.io" target="_blank" rel="noopener noreferrer">Speedbits Rclone Director UI</a> / Smart In Venture 2025, based on <a href="https://github.com/rclone/rclone-webui-react" target="_blank" rel="noopener noreferrer">rclone-webui-react</a>. Speedbits Director UI is included in the <a href="https://speedbits.io/infinity-tools/" target="_blank" rel="noopener noreferrer">Infinity Tools Pro+</a> and is not part of the official Rclone distribution.</span>
                <span style={{marginLeft: '8px', color: '#73818f'}}>UI v{appVersion}</span>
            </React.Fragment>
        );
    }
}

DefaultFooter.propTypes = propTypes;
DefaultFooter.defaultProps = defaultProps;

export default DefaultFooter;
