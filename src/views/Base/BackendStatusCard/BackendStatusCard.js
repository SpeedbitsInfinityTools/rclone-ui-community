import React from "react";
import {Card, CardBody, CardHeader, Badge} from "reactstrap";
import * as PropTypes from "prop-types";
import ReactDOM from "react-dom";
import RunningJobs from "../RunningJobs";
import {connect} from "react-redux";
import {enableCheckStatus, getStatus} from "../../../actions/statusActions";
import {MODAL_ROOT_ELEMENT, STATUS_REFRESH_TIMEOUT, USER_NAME_KEY} from "../../../utils/Constants";
import {checkHealth} from "../../../utils/API/director";

/**
 * Functional component Modal which is placed in the element with id "modal-root" in index.html using React.createPortal
 * @returns {{children, implementation, containerInfo, $$typeof, key}}
 * @constructor
 */
function TaskModal() {
    return ReactDOM.createPortal((
        <RunningJobs mode={"modal"}/>

    ), document.getElementById(MODAL_ROOT_ELEMENT));
}

/**
 * Component for display and monitoring of backend rclone status. Auto refresh status in redux store every 5 seconds.
 */
class BackendStatusCard extends React.Component {

    constructor(props) {
        super(props);
        this.state = {
            healthData: null
        };
    }

    componentDidMount() {
        this.props.getStatus();
        this.refreshInterval = setInterval(() => this.props.getStatus(), STATUS_REFRESH_TIMEOUT);
        this.fetchHealthData();
    }

    componentDidUpdate(prevProps) {
        if (!prevProps.isConnected && this.props.isConnected) {
            this.fetchHealthData();
        }
    }

    componentWillUnmount() {
        clearInterval(this.refreshInterval);
    }

    fetchHealthData = async () => {
        try {
            const data = await checkHealth();
            this.setState({ healthData: data });
        } catch (err) {
            // Health endpoint may not be available yet
        }
    };

    /**
     * Enable or disable checking of status request by http request to the backend.
     */
    toggleCheckStatus = () => {
        const {checkStatus, enableCheckStatus} = this.props;
        console.log(checkStatus, enableCheckStatus);
        enableCheckStatus(!checkStatus);
    };

    /**
     * Renders the component with mode.
     * Card: Enables the card mode.
     * Default: Table mode (Grid)
     * @returns {*}
     */
    render() {
        const {isConnected, mode, checkStatus} = this.props;
        const {healthData} = this.state;

        const username = sessionStorage.getItem(USER_NAME_KEY);


        if (mode === "card")
            return (

                <Card
                    className={"text-center " + (isConnected ? "card-accent-info" : "card-accent-warning")}>
                    <CardHeader>
                        Overview
                    </CardHeader>
                    <CardBody>
                        <StatusText checkStatus={checkStatus} connectivityStatus={isConnected}
                                    userName={username} healthData={healthData}/>

                    </CardBody>
                </Card>
            );
        else /*Default*/
            return (
                <React.Fragment>
                    <div className="d-none d-lg-flex align-items-center" style={{marginRight: '50px'}}>
                        <span 
                            className="badge badge-pill mr-2 px-3 py-2"
                            style={{
                                backgroundColor: checkStatus ? (isConnected ? '#28a745' : '#dc3545') : '#6c757d',
                                color: 'white',
                                fontSize: '14px',
                                fontWeight: '500'
                            }}
                        >
                            {checkStatus ? (isConnected ? "Connected" : "Disconnected") : "Disabled"}
                        </span>
                        <div className="custom-control custom-switch">
                            <input 
                                type="checkbox" 
                                className="custom-control-input" 
                                id="statusToggle"
                                checked={checkStatus}
                                onChange={this.toggleCheckStatus}
                            />
                            <label className="custom-control-label" htmlFor="statusToggle" style={{cursor: 'pointer'}}>
                                {checkStatus ? 'On' : 'Off'}
                            </label>
                        </div>
                    </div>
                    {/*Show current tasks in the side modal*/}
                    <TaskModal/>
                </React.Fragment>
            );
    }
}

/**
 * Displays the current backend connectivity status
 * @param connectivityStatus    {boolean}   Current connectivity status to the backend.
 * @param checkStatus           {boolean}   Specify whether to check the status or skip.
 * @param userName              {string}    User name of the currently logged in user.
 * @returns {*}
 * @constructor
 */
function StatusText({connectivityStatus, checkStatus, userName, healthData}) {

    let statusText = "";
    if(!checkStatus){
        statusText = "Not monitoring connectivity status. Tap the icon in navbar to start.";
    }else if(connectivityStatus){
        statusText = "Rclone Director is connected and proxying to your configured rclone backend";
    }else{
        statusText = "Cannot connect to rclone backend. Check if Rclone Director and rclone services are running."
    }

    const backend = healthData?.backend;
    const fuse = healthData?.fuse;
    const rcloneVersion = backend?.server?.version;

    return (
        <>
            <p>
                <span className={"card-subtitle"}>Status: {" "}</span>
                <span className="card-text">{statusText}</span>
            </p>
            <p>
                <span className={"card-subtitle"}>Backend: {" "}</span>
                <span className="card-text">
                    Rclone Director (multi-server)
                    {rcloneVersion && <Badge color="info" style={{ marginLeft: '8px', fontSize: '11px' }}>rclone {rcloneVersion}</Badge>}
                </span>
            </p>
            <p>
                <span className={"card-subtitle"}>Username: {" "}</span>
                <span className="card-text">{userName}</span>
            </p>
            {connectivityStatus && fuse && (
                <p>
                    <span className={"card-subtitle"}>FUSE (Mounting): {" "}</span>
                    {fuse.available === true && (
                        <Badge color="success" style={{ fontSize: '12px' }}>
                            <i className="fa fa-check" style={{ marginRight: '4px' }}></i>Available
                        </Badge>
                    )}
                    {fuse.available === false && (
                        <span>
                            <Badge color="danger" style={{ fontSize: '12px' }}>
                                <i className="fa fa-times" style={{ marginRight: '4px' }}></i>Not Installed
                            </Badge>
                            <span className="text-danger" style={{ fontSize: '12px', display: 'block', marginTop: '4px' }}>
                                <i className="fa fa-exclamation-triangle" style={{ marginRight: '4px' }}></i>
                                FUSE is required for mounting drives. Install it on the rclone server:{' '}
                                <code style={{ fontSize: '11px' }}>apt install fuse3</code> (Debian/Ubuntu) or{' '}
                                <code style={{ fontSize: '11px' }}>apk add fuse3</code> (Alpine)
                            </span>
                        </span>
                    )}
                    {fuse.available === null && fuse.error && (
                        <Badge color="secondary" style={{ fontSize: '12px' }}>
                            <i className="fa fa-question" style={{ marginRight: '4px' }}></i>Unknown
                        </Badge>
                    )}
                </p>
            )}
            <p className="text-muted" style={{ fontSize: '12px', marginTop: '10px' }}>
                <i className="fa fa-info-circle"></i> Manage servers in Menu → Rclone Servers
            </p>
        </>
    )
}

const propTypes = {
    /**
     * Used to specify mode of render : card/ grid.
     */
    mode: PropTypes.string.isRequired,
    /**
     * Boolean to represent internet connectivity
     */
    isConnected: PropTypes.bool.isRequired,
    /**
     * Boolean to represent whether checking for status at interval is allowed
     */
    checkStatus: PropTypes.bool.isRequired,

    /**
     * Function to enable or disable status check
     */
    enableCheckStatus: PropTypes.func.isRequired,

    /**
     * Get the current status
     */
    getStatus: PropTypes.func.isRequired
};

const defaultProps = {
    mode: "card",
};


BackendStatusCard.propTypes = propTypes;
BackendStatusCard.defaultProps = defaultProps;

const mapStateToProps = state => ({
    isConnected: state.status.isConnected,
    isDisabled: state.status.isDisabled,
    checkStatus: state.status.checkStatus
});

export default connect(mapStateToProps, {getStatus, enableCheckStatus})(BackendStatusCard);
