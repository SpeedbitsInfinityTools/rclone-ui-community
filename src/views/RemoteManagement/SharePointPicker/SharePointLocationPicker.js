/**
 * SharePointLocationPicker
 *
 * A reusable modal that lets the user pick where a OneDrive-typed rclone
 * remote should connect: their personal OneDrive, a SharePoint document
 * library reachable through the OAuth account, or — if the tenant blocks
 * SharePoint enumeration — a site identified by URL.
 *
 * Used in two places (controlled by `mode`):
 *
 *   "in-form"  : NewDrive wizard. On confirm, the parent updates its
 *                form state (drive_id / drive_type). The picker just
 *                surfaces the selection and closes — no API call to
 *                save the remote happens inside the picker itself.
 *
 *   "clone"    : Show Config "Add SharePoint library..." action.
 *                On confirm, the picker calls /clone-remote, which
 *                creates a brand-new rclone remote sharing the source
 *                remote's OAuth token.
 *
 * All Microsoft Graph calls are proxied through the Director using the
 * existing OAuth token of `sourceRemote` — the user never re-authenticates.
 */

import React from 'react';
import {
    Modal, ModalHeader, ModalBody, ModalFooter,
    Button, Input, InputGroup, InputGroupAddon,
    Alert, Spinner, Badge, FormGroup, Label
} from 'reactstrap';
import PropTypes from 'prop-types';
import { toast } from 'react-toastify';
import {
    discoverOneDriveLocations,
    searchOneDriveSites,
    resolveOneDriveSiteUrl,
    listOneDriveSiteDrives,
    cloneOneDriveRemote
} from '../../../utils/API/director';

const SEARCH_DEBOUNCE_MS = 350;
// Rclone OneDrive backend recognizes exactly these three drive_type values.
// SharePoint occasionally returns sub-types like `mediaLibrary` for asset
// libraries — those still work when written as `documentLibrary`, so we
// normalize before stamping into form state or sending to clone-remote.
const KNOWN_RCLONE_TYPES = ['personal', 'business', 'documentLibrary'];
function normalizeDriveType(t) {
    return KNOWN_RCLONE_TYPES.includes(t) ? t : 'documentLibrary';
}

class SharePointLocationPicker extends React.Component {
    constructor(props) {
        super(props);
        this.state = this._initialState();
        this._searchTimer = null;
        this._isMounted = false;
    }

    _initialState() {
        return {
            loading: false,
            error: null,
            personalDrives: [],
            sites: [],
            restricted: false,
            sitesError: null,
            current: null,
            // search state
            query: '',
            searching: false,
            searchError: null,
            // expanded site drives cache: { [siteId]: { loading, drives, error } }
            siteDrives: {},
            expandedSiteId: null,
            // selection: { kind: 'personal'|'site', drive: {...}, site?: {...} }
            selection: null,
            // url fallback
            showUrlEntry: false,
            urlInput: '',
            urlResolving: false,
            urlError: null,
            // clone-mode UI
            cloneNewName: '',
            cloneSubmitting: false
        };
    }

    componentDidMount() {
        this._isMounted = true;
        if (this.props.isOpen) {
            this._discover();
        }
    }

    componentDidUpdate(prevProps) {
        // (Re)load whenever the modal becomes visible.
        if (this.props.isOpen && !prevProps.isOpen) {
            this.setState(this._initialState(), () => {
                this._discover();
            });
        }
    }

    componentWillUnmount() {
        this._isMounted = false;
        if (this._searchTimer) clearTimeout(this._searchTimer);
    }

    _safeSetState(updater, callback) {
        if (this._isMounted) this.setState(updater, callback);
    }

    async _discover() {
        const { sourceRemote } = this.props;
        if (!sourceRemote) {
            this._safeSetState({ loading: false, error: 'No source remote provided' });
            return;
        }
        this._safeSetState({ loading: true, error: null });
        try {
            const res = await discoverOneDriveLocations(sourceRemote);
            const personalDrives = res?.personal?.drives || [];
            const sites = res?.sites || [];
            const current = res?.current || null;

            // Pre-select the current drive if we can find it in the lists we got.
            let selection = null;
            if (current?.drive_id) {
                const matchedPersonal = personalDrives.find(d => d.drive_id === current.drive_id);
                if (matchedPersonal) {
                    selection = { kind: 'personal', drive: matchedPersonal };
                }
            }
            // If current is a SharePoint drive we haven't loaded yet, preserve
            // that current selection instead of silently defaulting to personal.
            if (!selection && current?.drive_id) {
                selection = {
                    kind: 'site',
                    site: { displayName: 'Current SharePoint location' },
                    drive: {
                        drive_id: current.drive_id,
                        drive_type: normalizeDriveType(current.drive_type || 'documentLibrary'),
                        name: 'Current library'
                    }
                };
            }
            // Otherwise, default to personal[0] as a sane suggestion.
            if (!selection && personalDrives.length > 0) {
                selection = { kind: 'personal', drive: personalDrives[0] };
            }

            this._safeSetState({
                loading: false,
                personalDrives,
                sites,
                restricted: !!res?.restricted,
                sitesError: res?.sitesError || null,
                current,
                selection,
                showUrlEntry: !!res?.restricted
            });
        } catch (e) {
            this._safeSetState({ loading: false, error: e.message || 'Failed to discover locations' });
        }
    }

    _onQueryChange = (e) => {
        const query = e.target.value;
        this.setState({ query });
        if (this._searchTimer) clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => this._runSearch(query), SEARCH_DEBOUNCE_MS);
    };

    async _runSearch(query) {
        const { sourceRemote } = this.props;
        const q = (query || '').trim();
        this._safeSetState({ searching: true, searchError: null });
        try {
            const res = await searchOneDriveSites(sourceRemote, q.length > 0 ? q : '*');
            this._safeSetState({
                searching: false,
                sites: res?.sites || [],
                restricted: !!res?.restricted,
                searchError: null,
                // collapsing any expanded site if it's no longer in the list
                expandedSiteId: this.state.expandedSiteId &&
                    (res?.sites || []).some(s => s.site_id === this.state.expandedSiteId)
                    ? this.state.expandedSiteId : null
            });
        } catch (e) {
            this._safeSetState({ searching: false, searchError: e.message || 'Search failed' });
        }
    }

    _toggleSite = async (site) => {
        const isOpen = this.state.expandedSiteId === site.site_id;
        if (isOpen) {
            this._safeSetState({ expandedSiteId: null });
            return;
        }
        this._safeSetState({ expandedSiteId: site.site_id });

        // Load drives if not cached.
        const cached = this.state.siteDrives[site.site_id];
        if (cached && (cached.drives || cached.error)) return;

        this._safeSetState(prev => ({
            siteDrives: { ...prev.siteDrives, [site.site_id]: { loading: true } }
        }));
        try {
            const res = await listOneDriveSiteDrives(this.props.sourceRemote, site.site_id);
            this._safeSetState(prev => ({
                siteDrives: {
                    ...prev.siteDrives,
                    [site.site_id]: { loading: false, drives: res?.drives || [] }
                }
            }));
        } catch (e) {
            this._safeSetState(prev => ({
                siteDrives: {
                    ...prev.siteDrives,
                    [site.site_id]: { loading: false, error: e.message || 'Failed to list drives' }
                }
            }));
        }
    };

    _toggleUrlEntry = () => {
        this.setState(prev => ({ showUrlEntry: !prev.showUrlEntry, urlError: null }));
    };

    _resolveUrl = async () => {
        const { sourceRemote } = this.props;
        const url = (this.state.urlInput || '').trim();
        if (!url) {
            this.setState({ urlError: 'Paste a SharePoint site URL (e.g. https://contoso.sharepoint.com/sites/Marketing)' });
            return;
        }
        this._safeSetState({ urlResolving: true, urlError: null });
        try {
            const res = await resolveOneDriveSiteUrl(sourceRemote, url);
            const site = res?.site;
            if (!site) throw new Error('No site returned');
            // Merge the resolved site into the visible list (deduped) and auto-expand it.
            this._safeSetState(prev => {
                const existing = prev.sites.find(s => s.site_id === site.site_id);
                const newSites = existing ? prev.sites : [site, ...prev.sites];
                return {
                    urlResolving: false,
                    urlError: null,
                    urlInput: '',
                    showUrlEntry: false,
                    sites: newSites
                };
            }, () => this._toggleSite(site));
        } catch (e) {
            this._safeSetState({ urlResolving: false, urlError: e.message || 'Could not resolve site URL' });
        }
    };

    _selectPersonal = (drive) => {
        this.setState({ selection: { kind: 'personal', drive } });
    };

    _selectSiteDrive = (site, drive) => {
        this.setState({ selection: { kind: 'site', site, drive } });
    };

    _onCancel = () => {
        if (this.state.cloneSubmitting) return; // don't allow close while submitting
        if (this.props.onCancel) this.props.onCancel();
    };

    _onConfirm = async () => {
        const { mode, onConfirm, sourceRemote } = this.props;
        const { selection, cloneNewName } = this.state;
        if (!selection || !selection.drive) {
            toast.warning('Please choose a location first.');
            return;
        }
        // Normalize the drive_type before handing the selection off in either
        // mode, so callers don't have to repeat this logic.
        const normalizedSelection = {
            ...selection,
            drive: {
                ...selection.drive,
                drive_type: normalizeDriveType(selection.drive.drive_type)
            }
        };

        if (mode === 'clone') {
            const name = (cloneNewName || this._suggestedCloneName(normalizedSelection) || '').trim();
            if (!name) {
                toast.warning('Please enter a name for the new remote.');
                return;
            }
            this._safeSetState({ cloneSubmitting: true });
            try {
                const siteLabel = normalizedSelection.kind === 'site' ? normalizedSelection.site?.displayName : null;
                const result = await cloneOneDriveRemote(
                    sourceRemote, name,
                    normalizedSelection.drive.drive_id, normalizedSelection.drive.drive_type,
                    siteLabel
                );
                toast.success(`Created remote "${result?.name || name}".`);
                if (onConfirm) onConfirm({ ...normalizedSelection, cloneResult: result });
            } catch (e) {
                this._safeSetState({ cloneSubmitting: false });
                toast.error(e.message || 'Failed to create remote');
                return;
            }
            this._safeSetState({ cloneSubmitting: false });
        } else {
            // in-form mode: parent applies selection to its form state
            if (onConfirm) onConfirm(normalizedSelection);
        }
    };

    _suggestedCloneName(selection) {
        const { sourceRemote } = this.props;
        if (!selection) return '';
        const label = selection.kind === 'site' ? (selection.site?.name || selection.site?.displayName) :
            (selection.drive?.name || 'onedrive');
        const slug = String(label || '').toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .substring(0, 40);
        return slug ? `${sourceRemote}-${slug}` : `${sourceRemote}-sharepoint`;
    }

    _renderPersonalSection() {
        const { personalDrives, selection } = this.state;
        if (!personalDrives || personalDrives.length === 0) return null;

        return (
            <div style={{ marginBottom: '16px' }}>
                <div style={{ fontWeight: 600, marginBottom: '6px', fontSize: '13px', color: '#555' }}>
                    Personal OneDrive
                </div>
                <div style={{ border: '1px solid #e5e5e5', borderRadius: '6px' }}>
                    {personalDrives.map(d => {
                        const sel = selection?.kind === 'personal' && selection.drive.drive_id === d.drive_id;
                        return (
                            <div
                                key={d.drive_id}
                                onClick={() => this._selectPersonal(d)}
                                style={{
                                    padding: '10px 12px',
                                    borderTop: '1px solid #f1f1f1',
                                    cursor: 'pointer',
                                    background: sel ? '#e7f3ff' : 'transparent',
                                    display: 'flex',
                                    alignItems: 'center'
                                }}
                            >
                                <i className="fa fa-user-circle" style={{ marginRight: '8px', color: '#0a82be' }} />
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '14px', fontWeight: 500 }}>{d.name || 'OneDrive'}</div>
                                    {d.owner && (
                                        <div style={{ fontSize: '11px', color: '#777' }}>{d.owner}</div>
                                    )}
                                </div>
                                {sel && <i className="fa fa-check-circle" style={{ color: '#0a82be' }} />}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    _renderSiteRow(site) {
        const { expandedSiteId, siteDrives, selection } = this.state;
        const isOpen = expandedSiteId === site.site_id;
        const cache = siteDrives[site.site_id];

        return (
            <div key={site.site_id} style={{ borderTop: '1px solid #f1f1f1' }}>
                <div
                    onClick={() => this._toggleSite(site)}
                    style={{ padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                >
                    <i
                        className={`fa fa-chevron-${isOpen ? 'down' : 'right'}`}
                        style={{ marginRight: '8px', color: '#888', width: '12px' }}
                    />
                    <i className="fa fa-sitemap" style={{ marginRight: '8px', color: '#28a745' }} />
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '14px', fontWeight: 500 }}>{site.displayName}</div>
                        {site.webUrl && (
                            <div style={{ fontSize: '11px', color: '#777' }}>{site.webUrl}</div>
                        )}
                    </div>
                </div>
                {isOpen && (
                    <div style={{ paddingLeft: '32px', paddingRight: '12px', paddingBottom: '8px' }}>
                        {cache?.loading && (
                            <div style={{ padding: '8px 0', color: '#777', fontSize: '12px' }}>
                                <Spinner size="sm" /> Loading document libraries...
                            </div>
                        )}
                        {cache?.error && (
                            <Alert color="warning" style={{ fontSize: '12px', padding: '6px 10px' }}>
                                {cache.error}
                            </Alert>
                        )}
                        {cache?.drives && cache.drives.length === 0 && !cache.loading && (
                            <div style={{ color: '#777', fontSize: '12px', padding: '4px 0' }}>
                                This site has no document libraries you can access.
                            </div>
                        )}
                        {cache?.drives && cache.drives.map(d => {
                            const sel = selection?.kind === 'site'
                                && selection.site?.site_id === site.site_id
                                && selection.drive?.drive_id === d.drive_id;
                            return (
                                <div
                                    key={d.drive_id}
                                    onClick={() => this._selectSiteDrive(site, d)}
                                    style={{
                                        padding: '6px 10px',
                                        marginTop: '4px',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        background: sel ? '#e7f3ff' : 'transparent',
                                        display: 'flex',
                                        alignItems: 'center'
                                    }}
                                >
                                    <i className="fa fa-folder-open" style={{ marginRight: '8px', color: '#888' }} />
                                    <div style={{ flex: 1, fontSize: '13px' }}>
                                        <span style={{ fontWeight: 500 }}>{d.name}</span>
                                        <Badge color="light" style={{ marginLeft: '6px', fontSize: '10px' }}>
                                            {d.drive_type}
                                        </Badge>
                                    </div>
                                    {sel && <i className="fa fa-check-circle" style={{ color: '#0a82be' }} />}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    }

    _renderSitesSection() {
        const { sites, searching, searchError, restricted, sitesError, showUrlEntry, urlInput, urlResolving, urlError } = this.state;

        return (
            <div>
                <div style={{
                    display: 'flex', alignItems: 'center', marginBottom: '6px',
                    fontWeight: 600, fontSize: '13px', color: '#555'
                }}>
                    <span>SharePoint sites</span>
                    <Button color="link" size="sm" style={{ marginLeft: 'auto', padding: 0 }}
                        onClick={this._toggleUrlEntry}>
                        {showUrlEntry ? 'Hide URL input' : 'Paste a site URL...'}
                    </Button>
                </div>

                {restricted && (
                    <Alert color="warning" style={{ fontSize: '12px', padding: '8px 10px' }}>
                        Your account isn't allowed to search SharePoint sites in this tenant
                        (Sites.Read.All consent missing). Paste a site URL below instead.
                    </Alert>
                )}
                {sitesError && !restricted && (
                    <Alert color="warning" style={{ fontSize: '12px', padding: '8px 10px' }}>
                        {sitesError}
                    </Alert>
                )}

                {showUrlEntry && (
                    <div style={{ marginBottom: '10px' }}>
                        <InputGroup size="sm">
                            <Input
                                placeholder="https://yourcompany.sharepoint.com/sites/SiteName"
                                value={urlInput}
                                onChange={(e) => this.setState({ urlInput: e.target.value, urlError: null })}
                                onKeyPress={(e) => e.key === 'Enter' && this._resolveUrl()}
                                disabled={urlResolving}
                            />
                            <InputGroupAddon addonType="append">
                                <Button color="primary" onClick={this._resolveUrl} disabled={urlResolving}>
                                    {urlResolving ? <Spinner size="sm" /> : 'Resolve'}
                                </Button>
                            </InputGroupAddon>
                        </InputGroup>
                        {urlError && (
                            <div style={{ color: '#dc3545', fontSize: '12px', marginTop: '4px' }}>
                                {urlError}
                            </div>
                        )}
                    </div>
                )}

                <InputGroup size="sm" style={{ marginBottom: '8px' }}>
                    <Input
                        placeholder="Search sites by name..."
                        value={this.state.query}
                        onChange={this._onQueryChange}
                    />
                    {searching && (
                        <InputGroupAddon addonType="append">
                            <span style={{ padding: '6px 10px' }}><Spinner size="sm" /></span>
                        </InputGroupAddon>
                    )}
                </InputGroup>

                {searchError && (
                    <Alert color="warning" style={{ fontSize: '12px', padding: '6px 10px' }}>
                        {searchError}
                    </Alert>
                )}

                <div style={{
                    border: '1px solid #e5e5e5', borderRadius: '6px',
                    maxHeight: '320px', overflowY: 'auto'
                }}>
                    {sites.length === 0 && !searching && (
                        <div style={{ padding: '14px', color: '#777', fontSize: '13px', textAlign: 'center' }}>
                            {restricted
                                ? 'Paste a SharePoint site URL above to add it.'
                                : (this.state.query
                                    ? 'No sites match your search.'
                                    : 'No SharePoint sites visible to this account.')}
                        </div>
                    )}
                    {sites.map(s => this._renderSiteRow(s))}
                </div>
            </div>
        );
    }

    _renderSelectionSummary() {
        const { selection } = this.state;
        if (!selection?.drive) {
            return (
                <div style={{ fontSize: '12px', color: '#777' }}>
                    No location selected.
                </div>
            );
        }
        if (selection.kind === 'personal') {
            return (
                <div style={{ fontSize: '13px' }}>
                    <i className="fa fa-user-circle" style={{ marginRight: '6px', color: '#0a82be' }} />
                    <strong>{selection.drive.name || 'Personal OneDrive'}</strong>
                </div>
            );
        }
        return (
            <div style={{ fontSize: '13px' }}>
                <i className="fa fa-sitemap" style={{ marginRight: '6px', color: '#28a745' }} />
                <strong>{selection.site?.displayName}</strong>
                <span style={{ color: '#888' }}> &raquo; </span>
                <strong>{selection.drive.name}</strong>
                <Badge color="light" style={{ marginLeft: '6px', fontSize: '10px' }}>
                    {selection.drive.drive_type}
                </Badge>
            </div>
        );
    }

    render() {
        const { isOpen, mode, sourceRemote } = this.props;
        const { loading, error, selection, cloneSubmitting } = this.state;
        const cloneNameValue = this.state.cloneNewName ||
            (mode === 'clone' && selection ? this._suggestedCloneName(selection) : '');

        return (
            <Modal isOpen={isOpen} toggle={this._onCancel} size="lg" backdrop={cloneSubmitting ? 'static' : true}>
                <ModalHeader toggle={cloneSubmitting ? undefined : this._onCancel}>
                    {mode === 'clone' ? (
                        <>Add SharePoint library from <code>{sourceRemote}</code></>
                    ) : (
                        <>Where do you want to connect?</>
                    )}
                </ModalHeader>
                <ModalBody>
                    {loading && (
                        <div style={{ textAlign: 'center', padding: '30px' }}>
                            <Spinner /> <span style={{ marginLeft: '8px' }}>Loading locations from Microsoft Graph...</span>
                        </div>
                    )}
                    {error && (
                        <Alert color="danger">{error}</Alert>
                    )}
                    {!loading && !error && (
                        <>
                            {this._renderPersonalSection()}
                            {this._renderSitesSection()}

                            {mode === 'clone' && (
                                <FormGroup style={{ marginTop: '16px' }}>
                                    <Label for="cloneNewName" style={{ fontSize: '13px', fontWeight: 600 }}>
                                        Name for the new remote
                                    </Label>
                                    <Input
                                        id="cloneNewName"
                                        value={cloneNameValue}
                                        onChange={(e) => this.setState({ cloneNewName: e.target.value })}
                                        placeholder={`${sourceRemote}-sharepoint`}
                                        disabled={cloneSubmitting}
                                    />
                                    <small className="text-muted">
                                        Letters, digits, _ - . (must not start with - or .). A new rclone remote
                                        with this name will be created sharing the OAuth token of <code>{sourceRemote}</code>.
                                    </small>
                                </FormGroup>
                            )}
                        </>
                    )}
                </ModalBody>
                <ModalFooter style={{ alignItems: 'center' }}>
                    <div style={{ flex: 1, textAlign: 'left' }}>
                        {this._renderSelectionSummary()}
                    </div>
                    <Button color="secondary" onClick={this._onCancel} disabled={cloneSubmitting}>
                        Cancel
                    </Button>
                    <Button
                        color="primary"
                        onClick={this._onConfirm}
                        disabled={loading || !selection?.drive || cloneSubmitting}
                    >
                        {cloneSubmitting ? (
                            <><Spinner size="sm" /> Creating...</>
                        ) : mode === 'clone' ? (
                            'Create remote'
                        ) : (
                            'Use this location'
                        )}
                    </Button>
                </ModalFooter>
            </Modal>
        );
    }
}

SharePointLocationPicker.propTypes = {
    isOpen: PropTypes.bool.isRequired,
    // Remote whose OAuth token we use for Graph calls (and, in clone mode, copy from)
    sourceRemote: PropTypes.string.isRequired,
    mode: PropTypes.oneOf(['in-form', 'clone']).isRequired,
    // (selection) => void  — selection = { kind: 'personal'|'site', drive, site? [, cloneResult] }
    onConfirm: PropTypes.func.isRequired,
    onCancel: PropTypes.func.isRequired
};

export default SharePointLocationPicker;
