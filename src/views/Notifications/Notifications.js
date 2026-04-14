import React, { Component } from 'react';
import {
    Badge,
    Button,
    Card,
    CardBody,
    CardHeader,
    Col,
    Collapse,
    CustomInput,
    Form,
    FormGroup,
    Input,
    Label,
    Row,
    Table
} from 'reactstrap';
import { toast } from 'react-toastify';
import {
    getNotificationConfig,
    saveNotificationConfig,
    testNotification,
    getNotificationStatus,
    getNotificationLog,
    startMonitor,
    stopMonitor,
    runMonitorNow,
    updateMonitorInterval
} from '../../utils/API/director';

const EVENT_TYPES = {
    rclone_down: {
        label: 'Rclone Server Down',
        description: 'Notify when an RCD server becomes unreachable',
        icon: 'fa-times-circle text-danger'
    },
    rclone_recovered: {
        label: 'Rclone Server Recovered',
        description: 'Notify when a server comes back online',
        icon: 'fa-check-circle text-success'
    },
    mount_error: {
        label: 'Mount Error',
        description: 'Notify when a mount becomes inaccessible',
        icon: 'fa-exclamation-triangle text-warning'
    },
    auth_error: {
        label: 'Authentication Error',
        description: 'Notify when credentials expire (SAS tokens, OAuth, keys)',
        icon: 'fa-lock text-danger'
    }
};

const PRIORITY_OPTIONS = ['min', 'low', 'default', 'high', 'urgent'];

class Notifications extends Component {
    constructor(props) {
        super(props);
        this.state = {
            // ntfy config
            enabled: false,
            server: 'https://ntfy.sh',
            topic: '',
            authType: 'none',
            authUsername: '',
            authPassword: '',
            authToken: '',
            notifications: {},

            // Monitor config
            monitorEnabled: false,
            monitorPaused: false,
            intervalSeconds: 60,

            // Status
            monitorStatus: null,
            notifLog: [],
            loading: true,
            saving: false,
            testing: false,
            checking: false,

            // UI
            configOpen: true,
            eventsOpen: true,
            monitorOpen: true,
            logOpen: true
        };
        this.statusInterval = null;
    }

    componentDidMount() {
        this.loadAll();
        this.statusInterval = setInterval(() => this.loadStatus(), 15000);
    }

    componentWillUnmount() {
        if (this.statusInterval) clearInterval(this.statusInterval);
    }

    loadAll = async () => {
        this.setState({ loading: true });
        try {
            await Promise.all([this.loadConfig(), this.loadStatus(), this.loadLog()]);
        } catch (error) {
            console.error('[Notifications] Failed to load:', error);
        } finally {
            this.setState({ loading: false });
        }
    };

    loadConfig = async () => {
        try {
            const config = await getNotificationConfig();
            this.setState({
                enabled: config.enabled || false,
                server: config.server || 'https://ntfy.sh',
                topic: config.topic || '',
                authType: config.auth?.type || 'none',
                authUsername: config.auth?.username || '',
                authPassword: config.auth?.password || '',
                authToken: config.auth?.token || '',
                notifications: config.notifications || {},
                monitorEnabled: config.monitoring?.enabled || false,
                monitorPaused: config.monitoring?.paused || false,
                intervalSeconds: config.monitoring?.intervalSeconds || 60
            });
        } catch (error) {
            if (error.response?.status !== 401) {
                toast.error('Failed to load notification configuration');
            }
        }
    };

    loadStatus = async () => {
        try {
            const status = await getNotificationStatus();
            this.setState({ monitorStatus: status.monitor });
        } catch {
            // Silently ignore status load failures (e.g. during initial page load)
        }
    };

    loadLog = async () => {
        try {
            const data = await getNotificationLog();
            this.setState({ notifLog: data.log || [] });
        } catch {
            // Silently ignore
        }
    };

    buildConfig = () => {
        const {
            enabled, server, topic, authType, authUsername, authPassword, authToken,
            notifications, monitorPaused, intervalSeconds
        } = this.state;
        return {
            enabled,
            server,
            topic,
            auth: {
                type: authType,
                username: authUsername,
                password: authPassword,
                token: authToken
            },
            defaults: { priority: 'default', tags: ['rclone-ui'] },
            monitoring: {
                paused: monitorPaused || false,
                intervalSeconds: parseInt(intervalSeconds, 10) || 60
            },
            notifications
        };
    };

    handleSave = async (e) => {
        e.preventDefault();
        if (!this.state.topic) {
            toast.error('ntfy topic is required');
            return;
        }
        this.setState({ saving: true });
        try {
            const config = this.buildConfig();
            await saveNotificationConfig(config);
            toast.success('Notification settings saved');

            // Backend auto-starts monitor when ntfy is enabled+configured,
            // but it takes a moment to spin up. Briefly wait, then refresh.
            const willRun = config.enabled && config.topic;
            this.setState({
                monitorEnabled: willRun,
                monitorStatus: {
                    ...(this.state.monitorStatus || {}),
                    running: willRun
                }
            });
            setTimeout(() => this.loadStatus(), 1500);
        } catch (error) {
            toast.error('Failed to save: ' + (error.response?.data?.error || error.message));
        } finally {
            this.setState({ saving: false });
        }
    };

    handleTest = async () => {
        this.setState({ testing: true });
        try {
            const config = this.buildConfig();
            const result = await testNotification(config);
            if (result.success) {
                toast.success('Test notification sent! Check your ntfy app.');
            } else {
                toast.error('Test failed: ' + (result.error || 'Unknown error'));
            }
        } catch (error) {
            toast.error('Test failed: ' + (error.response?.data?.error || error.message));
        } finally {
            this.setState({ testing: false });
        }
    };

    handleStartMonitor = async () => {
        try {
            await startMonitor();
            this.setState({
                monitorEnabled: true,
                monitorPaused: false,
                monitorStatus: { ...(this.state.monitorStatus || {}), running: true }
            });
            toast.success('Health monitor resumed');
            setTimeout(() => this.loadStatus(), 1500);
        } catch (error) {
            toast.error('Failed to start monitor: ' + (error.response?.data?.error || error.message));
        }
    };

    handleStopMonitor = async () => {
        try {
            await stopMonitor();
            this.setState({
                monitorEnabled: false,
                monitorPaused: true,
                monitorStatus: { ...(this.state.monitorStatus || {}), running: false }
            });
            toast.success('Health monitor paused');
            await this.loadStatus();
        } catch (error) {
            toast.error('Failed to stop monitor: ' + (error.response?.data?.error || error.message));
        }
    };

    handleCheckNow = async () => {
        this.setState({ checking: true });
        try {
            const result = await runMonitorNow();
            toast.success('Health check completed');
            this.setState({ checking: false });
            await Promise.all([this.loadStatus(), this.loadLog()]);
            if (result.results) {
                const errors = result.results.flatMap(r => r.checks?.filter(c => c.status === 'error') || []);
                if (errors.length > 0) {
                    toast.warn(`Found ${errors.length} issue(s) across servers`);
                }
            }
        } catch (error) {
            this.setState({ checking: false });
            toast.error('Health check failed: ' + (error.response?.data?.error || error.message));
        }
    };

    handleIntervalChange = async (value) => {
        const seconds = parseInt(value, 10);
        if (isNaN(seconds) || seconds < 10) return;
        this.setState({ intervalSeconds: seconds });
        try {
            await updateMonitorInterval(seconds);
        } catch {
            // Will be saved with main config save
        }
    };

    updateNotificationType = (type, field, value) => {
        this.setState(prev => ({
            notifications: {
                ...prev.notifications,
                [type]: {
                    ...prev.notifications[type],
                    [field]: value
                }
            }
        }));
    };

    // =========================================================================
    // RENDER
    // =========================================================================

    renderNtfyConfig() {
        const {
            enabled, server, topic, authType, authUsername, authPassword, authToken,
            saving, testing, configOpen
        } = this.state;

        return (
            <Card className="mb-3">
                <CardHeader
                    style={{ cursor: 'pointer' }}
                    onClick={() => this.setState({ configOpen: !configOpen })}
                >
                    <i className="fa fa-bell"></i> <strong>ntfy Server Configuration</strong>
                    <div className="float-right">
                        {enabled
                            ? <Badge color="success">Enabled</Badge>
                            : <Badge color="secondary">Disabled</Badge>}
                        <i className={`fa fa-chevron-${configOpen ? 'up' : 'down'} ml-2`}></i>
                    </div>
                </CardHeader>
                <Collapse isOpen={configOpen}>
                    <CardBody>
                        <Form onSubmit={this.handleSave}>
                            <FormGroup>
                                <CustomInput
                                    type="switch"
                                    id="ntfyEnabled"
                                    label="Enable ntfy notifications"
                                    checked={enabled}
                                    onChange={(e) => this.setState({ enabled: e.target.checked })}
                                />
                            </FormGroup>

                            <Row>
                                <Col md="8">
                                    <FormGroup>
                                        <Label>Server URL</Label>
                                        <Input
                                            type="url"
                                            value={server}
                                            onChange={(e) => this.setState({ server: e.target.value })}
                                            placeholder="https://ntfy.sh"
                                        />
                                        <small className="form-text text-muted">
                                            Default: https://ntfy.sh (public). Use your own ntfy server for privacy.
                                        </small>
                                    </FormGroup>
                                </Col>
                                <Col md="4">
                                    <FormGroup>
                                        <Label>Topic *</Label>
                                        <Input
                                            type="text"
                                            value={topic}
                                            onChange={(e) => this.setState({ topic: e.target.value })}
                                            placeholder="my-rclone-alerts"
                                            required
                                        />
                                        <small className="form-text text-muted">
                                            Unique topic name for your notifications
                                        </small>
                                    </FormGroup>
                                </Col>
                            </Row>

                            <FormGroup>
                                <Label>Authentication</Label>
                                <div>
                                    <CustomInput
                                        type="radio"
                                        id="authNone"
                                        name="authType"
                                        label="None"
                                        inline
                                        checked={authType === 'none'}
                                        onChange={() => this.setState({ authType: 'none' })}
                                    />
                                    <CustomInput
                                        type="radio"
                                        id="authBasic"
                                        name="authType"
                                        label="Username / Password"
                                        inline
                                        checked={authType === 'basic'}
                                        onChange={() => this.setState({ authType: 'basic' })}
                                    />
                                    <CustomInput
                                        type="radio"
                                        id="authToken"
                                        name="authType"
                                        label="Access Token"
                                        inline
                                        checked={authType === 'token'}
                                        onChange={() => this.setState({ authType: 'token' })}
                                    />
                                </div>
                            </FormGroup>

                            {authType === 'basic' && (
                                <Row>
                                    <Col md="6">
                                        <FormGroup>
                                            <Label>Username</Label>
                                            <Input
                                                type="text"
                                                value={authUsername}
                                                onChange={(e) => this.setState({ authUsername: e.target.value })}
                                                placeholder="ntfy username"
                                            />
                                        </FormGroup>
                                    </Col>
                                    <Col md="6">
                                        <FormGroup>
                                            <Label>Password</Label>
                                            <Input
                                                type="password"
                                                value={authPassword}
                                                onChange={(e) => this.setState({ authPassword: e.target.value })}
                                                placeholder="ntfy password"
                                            />
                                        </FormGroup>
                                    </Col>
                                </Row>
                            )}

                            {authType === 'token' && (
                                <FormGroup>
                                    <Label>Access Token</Label>
                                    <Input
                                        type="password"
                                        value={authToken}
                                        onChange={(e) => this.setState({ authToken: e.target.value })}
                                        placeholder="tk_..."
                                    />
                                </FormGroup>
                            )}

                            <div className="d-flex mt-3">
                                <Button color="primary" type="submit" disabled={saving} className="mr-2">
                                    {saving
                                        ? <><i className="fa fa-spinner fa-spin"></i> Saving...</>
                                        : <><i className="fa fa-save"></i> Save Configuration</>}
                                </Button>
                                <Button
                                    type="button"
                                    color="info"
                                    outline
                                    onClick={this.handleTest}
                                    disabled={testing || !topic}
                                >
                                    {testing
                                        ? <><i className="fa fa-spinner fa-spin"></i> Sending...</>
                                        : <><i className="fa fa-paper-plane"></i> Send Test Notification</>}
                                </Button>
                            </div>
                        </Form>
                    </CardBody>
                </Collapse>
            </Card>
        );
    }

    renderEventTypes() {
        const { notifications, eventsOpen } = this.state;

        return (
            <Card className="mb-3">
                <CardHeader
                    style={{ cursor: 'pointer' }}
                    onClick={() => this.setState({ eventsOpen: !eventsOpen })}
                >
                    <i className="fa fa-list"></i> <strong>Event Types</strong>
                    <div className="float-right">
                        <i className={`fa fa-chevron-${eventsOpen ? 'up' : 'down'}`}></i>
                    </div>
                </CardHeader>
                <Collapse isOpen={eventsOpen}>
                    <CardBody>
                        <p className="text-muted mb-3">
                            Choose which events trigger notifications and their priority level.
                        </p>
                        <Table responsive>
                            <thead>
                                <tr>
                                    <th style={{ width: '50px' }}>Active</th>
                                    <th>Event</th>
                                    <th style={{ width: '150px' }}>Priority</th>
                                </tr>
                            </thead>
                            <tbody>
                                {Object.entries(EVENT_TYPES).map(([type, meta]) => {
                                    const notif = notifications[type] || {};
                                    return (
                                        <tr key={type}>
                                            <td className="text-center align-middle">
                                                <input
                                                    type="checkbox"
                                                    checked={notif.enabled !== false}
                                                    onChange={(e) => this.updateNotificationType(type, 'enabled', e.target.checked)}
                                                    style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                                                />
                                            </td>
                                            <td>
                                                <div>
                                                    <i className={`fa ${meta.icon} mr-1`}></i>
                                                    <strong>{meta.label}</strong>
                                                </div>
                                                <small className="text-muted">{meta.description}</small>
                                            </td>
                                            <td className="align-middle">
                                                <Input
                                                    type="select"
                                                    bsSize="sm"
                                                    value={notif.priority || 'default'}
                                                    onChange={(e) => this.updateNotificationType(type, 'priority', e.target.value)}
                                                >
                                                    {PRIORITY_OPTIONS.map(p => (
                                                        <option key={p} value={p}>{p}</option>
                                                    ))}
                                                </Input>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </Table>
                    </CardBody>
                </Collapse>
            </Card>
        );
    }

    renderHealthMonitor() {
        const { enabled, topic, intervalSeconds, monitorStatus, checking, monitorOpen } = this.state;
        const ntfyConfigured = enabled && topic;

        return (
            <Card className="mb-3">
                <CardHeader
                    style={{ cursor: 'pointer' }}
                    onClick={() => this.setState({ monitorOpen: !monitorOpen })}
                >
                    <i className="fa fa-heartbeat"></i> <strong>Health Monitor</strong>
                    <div className="float-right">
                        {monitorStatus?.running
                            ? <Badge color="success">Running</Badge>
                            : <Badge color="secondary">Stopped</Badge>}
                        <i className={`fa fa-chevron-${monitorOpen ? 'up' : 'down'} ml-2`}></i>
                    </div>
                </CardHeader>
                <Collapse isOpen={monitorOpen}>
                    <CardBody>
                        <p className="text-muted mb-3">
                            The health monitor starts automatically when ntfy is enabled and a topic is configured.
                            It periodically checks all your rclone servers for connectivity, mount health,
                            and expired credentials. Identical errors are sent at most once per 24 hours.
                        </p>

                        {!ntfyConfigured && !monitorStatus?.running && (
                            <div className="mb-3 p-3" style={{ backgroundColor: '#fff3cd', border: '1px solid #ffc107', borderRadius: '4px' }}>
                                <i className="fa fa-info-circle"></i>{' '}
                                Enable ntfy notifications above and set a topic, then save. The monitor will start automatically.
                            </div>
                        )}

                        <Row>
                            <Col md="4">
                                <FormGroup>
                                    <Label>Check Interval (seconds)</Label>
                                    <Input
                                        type="number"
                                        min="10"
                                        value={intervalSeconds}
                                        onChange={(e) => this.handleIntervalChange(e.target.value)}
                                    />
                                    <small className="form-text text-muted">Minimum: 10 seconds</small>
                                </FormGroup>
                            </Col>
                            <Col md="8">
                                <Label>&nbsp;</Label>
                                <div>
                                    {monitorStatus?.running ? (
                                        <Button color="warning" outline onClick={this.handleStopMonitor} className="mr-2" title="Temporarily pause monitoring (e.g. during maintenance)">
                                            <i className="fa fa-pause"></i> Pause
                                        </Button>
                                    ) : (
                                        <Button color="success" onClick={this.handleStartMonitor} className="mr-2">
                                            <i className="fa fa-play"></i> Resume
                                        </Button>
                                    )}
                                    <Button color="info" outline onClick={this.handleCheckNow} disabled={checking}>
                                        {checking
                                            ? <><i className="fa fa-spinner fa-spin"></i> Checking...</>
                                            : <><i className="fa fa-refresh"></i> Check Now</>}
                                    </Button>
                                </div>
                            </Col>
                        </Row>

                        {monitorStatus && (
                            <div className="mt-3 p-3" style={{ backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
                                <Row>
                                    <Col sm="4">
                                        <strong>Status:</strong>{' '}
                                        {monitorStatus.running
                                            ? <Badge color="success">Running</Badge>
                                            : <Badge color="secondary">Stopped</Badge>}
                                    </Col>
                                    <Col sm="4">
                                        <strong>Last Check:</strong>{' '}
                                        {monitorStatus.lastCheckTime
                                            ? new Date(monitorStatus.lastCheckTime).toLocaleString()
                                            : 'Never'}
                                    </Col>
                                    <Col sm="4">
                                        <strong>Dedup Entries:</strong>{' '}
                                        {monitorStatus.dedupEntries || 0}
                                    </Col>
                                </Row>
                                {monitorStatus.serversDown && monitorStatus.serversDown.length > 0 && (
                                    <div className="mt-2">
                                        <strong className="text-danger">
                                            <i className="fa fa-exclamation-triangle"></i>{' '}
                                            Servers currently down:
                                        </strong>{' '}
                                        {monitorStatus.serversDown.join(', ')}
                                    </div>
                                )}
                            </div>
                        )}
                    </CardBody>
                </Collapse>
            </Card>
        );
    }

    renderNotificationLog() {
        const { notifLog, logOpen } = this.state;

        return (
            <Card className="mb-3">
                <CardHeader
                    style={{ cursor: 'pointer' }}
                    onClick={() => this.setState({ logOpen: !logOpen })}
                >
                    <i className="fa fa-history"></i> <strong>Recent Notifications</strong>
                    <div className="float-right">
                        <Badge color="info">{notifLog.length}</Badge>
                        <i className={`fa fa-chevron-${logOpen ? 'up' : 'down'} ml-2`}></i>
                    </div>
                </CardHeader>
                <Collapse isOpen={logOpen}>
                    <CardBody>
                        {notifLog.length === 0 ? (
                            <p className="text-muted text-center my-3">
                                <i className="fa fa-inbox"></i> No notifications sent yet.
                                Start the health monitor to begin monitoring your rclone servers.
                            </p>
                        ) : (
                            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                                <Table responsive size="sm" striped>
                                    <thead>
                                        <tr>
                                            <th>Time</th>
                                            <th>Server</th>
                                            <th>Event</th>
                                            <th>Message</th>
                                            <th>Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {notifLog.map((entry, i) => (
                                            <tr key={i}>
                                                <td style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>
                                                    {entry.timestamp
                                                        ? new Date(entry.timestamp).toLocaleString()
                                                        : '-'}
                                                </td>
                                                <td>{entry.server || '-'}</td>
                                                <td>
                                                    <Badge color={this.getEventBadgeColor(entry.type)}>
                                                        {entry.type || 'unknown'}
                                                    </Badge>
                                                </td>
                                                <td style={{ fontSize: '0.85rem', maxWidth: '400px', wordBreak: 'break-word' }}>
                                                    {entry.message || '-'}
                                                </td>
                                                <td className="text-center">
                                                    {entry.sent
                                                        ? <i className="fa fa-check text-success" title="Sent"></i>
                                                        : <i className="fa fa-times text-danger" title="Failed"></i>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            </div>
                        )}
                    </CardBody>
                </Collapse>
            </Card>
        );
    }

    getEventBadgeColor(type) {
        switch (type) {
            case 'rclone_down': return 'danger';
            case 'rclone_recovered': return 'success';
            case 'mount_error': return 'warning';
            case 'auth_error': return 'danger';
            default: return 'secondary';
        }
    }

    render() {
        const { loading } = this.state;

        if (loading) {
            return (
                <div className="animated fadeIn text-center mt-5">
                    <i className="fa fa-spinner fa-spin fa-2x"></i>
                    <p className="mt-2">Loading notification settings...</p>
                </div>
            );
        }

        return (
            <div className="animated fadeIn">
                <Row>
                    <Col xs="12" lg="10" className="mx-auto">
                        <h4 className="mb-3">
                            <i className="fa fa-bell"></i> Notifications
                        </h4>
                        <p className="text-muted mb-4">
                            Configure push notifications via <a href="https://ntfy.sh" target="_blank" rel="noopener noreferrer">ntfy</a> to
                            get alerted when rclone servers go down, mounts fail, or credentials expire.
                        </p>

                        {this.renderNtfyConfig()}
                        {this.renderEventTypes()}
                        {this.renderHealthMonitor()}
                        {this.renderNotificationLog()}
                    </Col>
                </Row>
            </div>
        );
    }
}

export default Notifications;
