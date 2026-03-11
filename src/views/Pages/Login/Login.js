import React, {Component} from 'react';
import {
	Button,
	Card,
	CardBody,
	Col,
	Container,
	Form,
	Input,
	InputGroup,
	InputGroupAddon,
	InputGroupText,
	Row,
	UncontrolledAlert
} from 'reactstrap';
import {connect} from "react-redux";
import {changeAuthKey, changeUserNamePassword, signOut} from "../../../actions/userActions";
import {login as directorLogin} from "../../../utils/API/director";
import logo from '../../../assets/img/brand/logo_symbol.png';
import speedbitsLogo from '../../../assets/img/brand/speedbits-logo.svg';
import {LOGIN_TOKEN, SESSION_KEY} from "../../../utils/Constants";
import {withRouter} from "../../../utils/withRouter";


function removeParam(parameter) {
    let url = document.location.href;
    let urlparts = url.split('?');

    if (urlparts.length >= 2) {
        let urlBase = urlparts.shift();
        let queryString = urlparts.join("?");

        let prefix = encodeURIComponent(parameter) + '=';
        let pars = queryString.split(/[&;]/g);
        for (let i = pars.length; i-- > 0;)
            if (pars[i].lastIndexOf(prefix, 0) !== -1)
                pars.splice(i, 1);
        if (pars.length > 0)
            url = urlBase + '?' + pars.join('&');
        else
            url = urlBase;
        url = url.replace(window.location.origin, ''); // history.pushState requires same-origin
        window.history.pushState('', document.title, url); // added this line to push the new url directly to url bar .

    }
    return url;
}

class Login extends Component {

    constructor(props) {
        super(props);
        
        // Check if there's an error message from a redirect (e.g., 401 or backend down)
        const storedError = sessionStorage.getItem('LOGIN_ERROR');
        
        this.state = {
            username: "",
            password: "",
            error: storedError || ""
        };
        
        // Clear the stored error after reading it
        if (storedError) {
            sessionStorage.removeItem('LOGIN_ERROR');
        }
    }

    changeUserName = e => {
        this.setState({
            username: e.target.value,
        });
    };
    changePassword = e => {
        this.setState({
            password: e.target.value,

        })
    };

    redirectToDashboard = () => {
        this.props.history.push('/dashboard');
    };


	onSubmit = async (e) => {
		if (e)
			e.preventDefault();

		const {username, password} = this.state;
		const {changeUserNamePassword} = this.props;

		try {
			// Authenticate with Rclone Director backend
			const loginResult = await directorLogin(username, password);
			
			if (loginResult.success && loginResult.sessionKey) {
				// Store session key in sessionStorage (REQUIRED for all API calls)
				// This is a RANDOM token, NOT the password or master key
				// The master key is stored on the backend in server memory
				sessionStorage.setItem(SESSION_KEY, loginResult.sessionKey);
				console.log("✅ Session key stored in sessionStorage (random token, not password!)");
				console.log("✅ Master encryption key stored on BACKEND (not in browser memory)");
				
				// CRITICAL: Explicitly set localStorage for rclone-api library BEFORE Redux action
				// The rclone-api library reads these values from localStorage on every request
				const authKey = btoa(username + ":" + password);
				localStorage.setItem("authKey", authKey);
				localStorage.setItem("ipAddress", "/api/rclone");
				console.log("✅ Explicitly set localStorage:", {
					authKey: authKey.substring(0, 10) + "...",
					ipAddress: localStorage.getItem("ipAddress")
				});
				
				// Also store in Redux for backward compatibility
				await changeUserNamePassword(username, password);
				
				console.log("✅ Authentication successful - redirecting to dashboard");
				this.redirectToDashboard();
			} else {
				this.setState({
					error: "Invalid credentials. Please check your username and password."
				});
			}
		} catch (error) {
			console.error("Login error:", error);
			
			// Detect if the error is due to backend not running (network error)
			if (error.code === 'ERR_NETWORK' || error.message === 'Network Error' || !error.response) {
				this.setState({
					error: "The Rclone Director backend server is not running! Please start it and try again."
				});
			} 
			// Detect 401 Unauthorized (invalid credentials)
			else if (error.response && error.response.status === 401) {
				this.setState({
					error: "Invalid credentials. Please check your username and password."
				});
			}
			// All other errors
			else {
				const errorMessage = error.response?.data?.error || error.response?.data?.message || error.message || "Unknown error";
				this.setState({
					error: `Login failed: ${errorMessage}`
				});
			}
		}
	};

	// checkConnection = (e) => {
	//     e.preventDefault();
	//
	//     // Set the localStorage parameters temporarily.
	//     const {ipAddress, username, password} = this.state;
	//     const {changeUserNamePassword, changeIPAddress} = this.props;
	//
	//     Promise.all([
	//         changeUserNamePassword(username, password),
	//         changeIPAddress(ipAddress)
	//     ]).then(() => {
	//         axiosInstance.post(urls.noopAuth).then((data) => {
	//             console.log("Connection successful.");
	//             this.setState({
	//                 connectionSuccess: true,
	//                 error: ""
	//             })
	//         }, (error) => {
	//             console.log(error);
	//             this.setState({
	//                 connectionSuccess: false,
	//                 error: "Error connecting. Please check username password and verify if rclone is working at the specified IP."
	//             })
	//         })
	//     })
	//
	//
	// };

	componentDidMount() {
		sessionStorage.clear();
		this.props.signOut();

		// Handle login token if present in URL (for direct links)
		let url_string = window.location.href;
		let url = new URL(url_string);
		let loginToken = url.searchParams.get(LOGIN_TOKEN);
        if (loginToken) {
            this.props.changeAuthKey(loginToken);
            removeParam(LOGIN_TOKEN);
            this.redirectToDashboard();
        }
    }




    render() {
		const {username, password, error} = this.state;

        return (
            <div className="app flex-row align-items-center" data-test="loginComponent" style={{ minHeight: '100vh', backgroundColor: '#f5f5f5' }}>
                <Container>
                    <Row className="justify-content-center">
                        <Col md="6" lg="5" xl="4">
                            <div style={{ 
                                textAlign: 'center', 
                                paddingTop: '60px',
                                paddingBottom: '40px'
                            }}>
                                {/* Rclone Logo at top */}
                                <img 
                                    src={logo} 
                                    alt="Rclone logo"
                                    style={{ 
                                        maxWidth: '120px', 
                                        height: 'auto',
                                        marginBottom: '30px'
                                    }}
                                />
                                
                                {/* Title */}
                                <h1 style={{ 
                                    fontSize: '32px',
                                    fontWeight: '700',
                                    color: '#23282c',
                                    marginBottom: '40px',
                                    lineHeight: '1.2'
                                }}>
                                    Rclone Director UI
                                </h1>
                                
                                {/* Subtitle */}
                                <p style={{ 
                                    fontSize: '16px',
                                    color: '#73818f',
                                    marginBottom: '30px'
                                }}>
                                    Sign in to manage your backups
                                </p>
                                
                                {/* Login Form */}
                                <Card style={{ 
                                    border: 'none',
                                    boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
                                    borderRadius: '8px',
                                    marginBottom: '30px'
                                }}>
                                    <CardBody className="p-4">
                                        <Form onSubmit={this.onSubmit}>
                                            {error && (
                                                <UncontrolledAlert color="danger" className="mb-3" children={error}/>
                                            )}

                                            <InputGroup className="mb-3">
                                                <InputGroupAddon addonType="prepend">
                                                    <InputGroupText style={{ backgroundColor: '#fff', borderRight: 'none' }}>
                                                        <i className="icon-user" style={{ color: '#73818f' }}/>
                                                    </InputGroupText>
                                                </InputGroupAddon>
                                                <Input 
                                                    type="text" 
                                                    placeholder="Username" 
                                                    autoComplete="username"
                                                    data-testid="LoginForm-userName"
                                                    onChange={this.changeUserName} 
                                                    value={username}
                                                    style={{ 
                                                        borderLeft: 'none',
                                                        backgroundColor: '#fff'
                                                    }}
                                                />
                                            </InputGroup>
                                            
                                            <InputGroup className="mb-4">
                                                <InputGroupAddon addonType="prepend">
                                                    <InputGroupText style={{ backgroundColor: '#fff', borderRight: 'none' }}>
                                                        <i className="icon-lock" style={{ color: '#73818f' }}/>
                                                    </InputGroupText>
                                                </InputGroupAddon>
                                                <Input 
                                                    type="password" 
                                                    placeholder="Password"
                                                    data-testid="LoginForm-password"
                                                    autoComplete="current-password" 
                                                    onChange={this.changePassword}
                                                    value={password}
                                                    style={{ 
                                                        borderLeft: 'none',
                                                        backgroundColor: '#fff'
                                                    }}
                                                />
                                            </InputGroup>
                                            
                                            <Button 
                                                color="primary" 
                                                className="w-100" 
                                                type="submit"
                                                data-testid="LoginForm-BtnLogin"
                                                style={{
                                                    fontSize: '16px',
                                                    fontWeight: '600',
                                                    padding: '12px',
                                                    borderRadius: '6px'
                                                }}
                                            >
                                                Sign in
                                            </Button>
                                        </Form>
                                    </CardBody>
                                </Card>
                                
                                {/* Credentials info */}
                                <p style={{ 
                                    fontSize: '14px',
                                    color: '#73818f',
                                    marginBottom: '50px'
                                }}>
                                    Credentials will be generated during first setup
                                </p>
                                
                                {/* Speedbits Logo */}
                                <div style={{ marginBottom: '30px' }}>
                                    <img 
                                        src={speedbitsLogo} 
                                        alt="Speedbits logo" 
                                        style={{ 
                                            height: '40px', 
                                            maxWidth: '100%'
                                        }}
                                    />
                                </div>
                            </div>
                        </Col>
                    </Row>
                    
                    {/* Footer Copyright */}
                    <Row>
                        <Col className="text-center">
                            <small style={{ 
                                color: '#73818f', 
                                fontSize: '12px',
                                lineHeight: '1.6'
                            }}>
                                © Smart In Venture GmbH 2025. This is proprietary software and can be downloaded at <a href="https://www.speedbits.io" target="_blank" rel="noopener noreferrer" style={{ color: '#20a8d8', textDecoration: 'none' }}>www.speedbits.io</a>.
                            </small>
                        </Col>
                    </Row>
                </Container>
            </div>
        );
    }
}


export default withRouter(connect(null, {signOut, changeUserNamePassword, changeAuthKey})(Login));
