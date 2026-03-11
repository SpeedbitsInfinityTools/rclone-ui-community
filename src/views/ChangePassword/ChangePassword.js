import React, { Component } from 'react';
import {
    Button,
    Card,
    CardBody,
    CardHeader,
    Col,
    Form,
    FormGroup,
    Input,
    Label,
    Row
} from 'reactstrap';
import { toast } from 'react-toastify';
import { changePassword } from '../../utils/API/director';

class ChangePassword extends Component {
    constructor(props) {
        super(props);
        this.state = {
            oldPassword: '',
            newPassword: '',
            confirmPassword: '',
            loading: false
        };
    }

    handleInputChange = (e) => {
        const { name, value } = e.target;
        this.setState({ [name]: value });
    };

    handleSubmit = async (e) => {
        e.preventDefault();
        const { oldPassword, newPassword, confirmPassword } = this.state;

        // Validation
        if (!oldPassword || !newPassword || !confirmPassword) {
            toast.error('All fields are required');
            return;
        }

        if (newPassword !== confirmPassword) {
            toast.error('New passwords do not match');
            return;
        }

        if (newPassword.length < 6) {
            toast.error('New password must be at least 6 characters long');
            return;
        }

        if (oldPassword === newPassword) {
            toast.error('New password must be different from old password');
            return;
        }

        try {
            this.setState({ loading: true });
            await changePassword(oldPassword, newPassword);
            toast.success('✅ Password changed successfully! Please log in again with your new password.');
            
            // Clear form
            this.setState({
                oldPassword: '',
                newPassword: '',
                confirmPassword: ''
            });

            // Redirect to login after 2 seconds
            setTimeout(() => {
                sessionStorage.clear();
                window.location.href = '/login';
            }, 2000);
        } catch (error) {
            const errorMsg = error.response?.data?.error || error.message || 'Unknown error';
            toast.error('❌ Failed to change password: ' + errorMsg);
        } finally {
            this.setState({ loading: false });
        }
    };

    render() {
        const { oldPassword, newPassword, confirmPassword, loading } = this.state;

        return (
            <div className="animated fadeIn">
                <Row>
                    <Col xs="12" md="8" lg="6" className="mx-auto">
                        <Card>
                            <CardHeader>
                                <i className="fa fa-key"></i> <strong>Change Admin Password</strong>
                            </CardHeader>
                            <CardBody>
                                <p className="text-muted">
                                    Change your Rclone Director admin password. You will need to log in again after changing your password.
                                </p>

                                <Form onSubmit={this.handleSubmit}>
                                    <FormGroup>
                                        <Label for="oldPassword">Current Password *</Label>
                                        <Input
                                            type="password"
                                            name="oldPassword"
                                            id="oldPassword"
                                            placeholder="Enter your current password"
                                            value={oldPassword}
                                            onChange={this.handleInputChange}
                                            required
                                            autoComplete="current-password"
                                        />
                                    </FormGroup>

                                    <FormGroup>
                                        <Label for="newPassword">New Password *</Label>
                                        <Input
                                            type="password"
                                            name="newPassword"
                                            id="newPassword"
                                            placeholder="Enter your new password (min. 6 characters)"
                                            value={newPassword}
                                            onChange={this.handleInputChange}
                                            required
                                            autoComplete="new-password"
                                        />
                                        <small className="form-text text-muted">
                                            Password must be at least 6 characters long
                                        </small>
                                    </FormGroup>

                                    <FormGroup>
                                        <Label for="confirmPassword">Confirm New Password *</Label>
                                        <Input
                                            type="password"
                                            name="confirmPassword"
                                            id="confirmPassword"
                                            placeholder="Re-enter your new password"
                                            value={confirmPassword}
                                            onChange={this.handleInputChange}
                                            required
                                            autoComplete="new-password"
                                        />
                                    </FormGroup>

                                    <div className="form-actions" style={{ marginTop: '30px' }}>
                                        <Button
                                            type="submit"
                                            color="primary"
                                            disabled={loading}
                                            size="lg"
                                            block
                                        >
                                            {loading ? (
                                                <>
                                                    <i className="fa fa-spinner fa-spin"></i> Changing Password...
                                                </>
                                            ) : (
                                                <>
                                                    <i className="fa fa-check"></i> Change Password
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                </Form>

                                <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#fff3cd', border: '1px solid #ffc107', borderRadius: '4px' }}>
                                    <strong><i className="fa fa-exclamation-triangle"></i> Important:</strong>
                                    <ul style={{ marginTop: '10px', marginBottom: '0', paddingLeft: '20px' }}>
                                        <li>This changes the <strong>admin</strong> password for Rclone Director</li>
                                        <li>You will be logged out and need to log in again with the new password</li>
                                        <li>Store your new password securely</li>
                                    </ul>
                                </div>
                            </CardBody>
                        </Card>
                    </Col>
                </Row>
            </div>
        );
    }
}

export default ChangePassword;

