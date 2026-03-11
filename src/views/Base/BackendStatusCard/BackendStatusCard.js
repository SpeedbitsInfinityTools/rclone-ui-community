import React from "react";
import {Card, CardBody, CardHeader} from "reactstrap";
import * as PropTypes from "prop-types";
import ReactDOM from "react-dom";
import RunningJobs from "../RunningJobs";
import {connect} from "react-redux";
import {enableCheckStatus, getStatus} from "../../../actions/statusActions";
import {MODAL_ROOT_ELEMENT, STATUS_REFRESH_TIMEOUT, USER_NAME_KEY} from "../../../utils/Constants";

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


    componentDidMount() {

        // Check if the connection to the backend is active
        this.props.getStatus();
        this.refreshInterval = setInterval(() => this.props.getStatus(), STATUS_REFRESH_TIMEOUT);
    }


    componentWillUnmount() {
        // Clear the interval before component is unmounted
        clearInterval(this.refreshInterval);
    }

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
                                    userName={username}/>

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
function StatusText({connectivityStatus, checkStatus, userName}) {

    let statusText = "";
    if(!checkStatus){
        statusText = "Not monitoring connectivity status. Tap the icon in navbar to start.";
    }else if(connectivityStatus){
        // Connected to backend
        statusText = "Rclone Director is connected and proxying to your configured rclone backend";
    }else{
        statusText = "Cannot connect to rclone backend. Check if Rclone Director and rclone services are running."
    }

    return (
        <>
            <p>
                <span className={"card-subtitle"}>Status: {" "}</span>
                <span className="card-text">{statusText}</span>
            </p>
            <p>
                <span className={"card-subtitle"}>Backend: {" "}</span>
                <span className="card-text">Rclone Director (multi-server)</span>
            </p>
            <p>
                <span className={"card-subtitle"}>Username: {" "}</span>
                <span className="card-text">{userName}</span>
            </p>
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
