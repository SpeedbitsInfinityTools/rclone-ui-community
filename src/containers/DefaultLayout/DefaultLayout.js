import React, {Component, Suspense} from 'react';
import {Navigate, Route, Routes} from 'react-router-dom';
import {Container} from 'reactstrap';
import {getVersion} from "../../actions/versionActions";
import {withRouter} from "../../utils/withRouter";
import {checkHealth} from "../../utils/API/director";
import appPackage from '../../../package.json';

import {
    AppFooter,
    AppHeader,
    AppSidebar,
    AppSidebarFooter,
    AppSidebarForm,
    AppSidebarHeader,
    AppSidebarMinimizer,
    AppSidebarNav,
} from '@coreui/react';
// sidebar nav config
import navigation from '../../_nav';
// routes config
import routes from '../../routes';
import {connect} from "react-redux";
import {AUTH_KEY, LOGIN_TOKEN} from "../../utils/Constants";
import ErrorBoundary from "../../ErrorHandling/ErrorBoundary";
import RcloneWarningBanner from "../../views/Base/RcloneWarningBanner/RcloneWarningBanner";

// const DefaultAside = React.lazy(() => import('./DefaultAside'));
const DefaultFooter = React.lazy(() => import('./DefaultFooter'));
const DefaultHeader = React.lazy(() => import('./DefaultHeader'));

const VERSION_NAV_ITEM_ATTRS = {
    attributes: { target: '_blank' },
    class: 'mt-auto',
    icon: 'cui-cog',
    url: 'https://rclone.org/changelog',
    variant: 'success'
}
class DefaultLayout extends Component {

    constructor(props) {
        super(props);
        this.state = {
            edition: null
        };
    }

    loading = () => <div className="animated fadeIn pt-1 text-center">Loading...</div>;

    get navConfig() {
        const { edition } = this.state;
        const appVersion = process.env.REACT_APP_VERSION || appPackage.version || '';
        const editionLabel = edition === 'community' ? 'Community' : edition === 'commercial' ? 'Commercial' : '';
        const editionSuffix = editionLabel ? ` · ${editionLabel}` : '';

        return {
            items: [
                ...navigation.items,
                {
                    name: this.props.version.version,
                    ...VERSION_NAV_ITEM_ATTRS
                },
                {
                    name: `UI v${appVersion}${editionSuffix}`,
                    icon: edition === 'community' ? 'fa fa-users' : 'fa fa-building',
                    class: 'nav-edition-info',
                    url: '#',
                    attributes: { onClick: (e) => e.preventDefault(), style: { cursor: 'default' } }
                }
            ]
        }
    }

    componentDidMount() {
        // Only fetch version if authenticated
        if (sessionStorage.getItem(AUTH_KEY) && window.location.href.indexOf(LOGIN_TOKEN) === -1) {
            this.props.getVersion();
            this.fetchEdition();
        }
    }

    async fetchEdition() {
        try {
            const health = await checkHealth();
            if (health && health.edition) {
                this.setState({ edition: health.edition });
            }
        } catch (e) {
            // Silently ignore - edition badge just won't show
        }
    }

    render() {
        // Redirect to login if not authenticated
        if (!sessionStorage.getItem(AUTH_KEY) || window.location.href.indexOf(LOGIN_TOKEN) > 0) {
            return <Navigate to="/login" replace />;
        }
        
        // console.log("isConnected, default layout", this.props.isConnected);
        return (


            <div className="app" data-test="defaultLayout">
                <ErrorBoundary>
                    <AppHeader fixed>
                        <Suspense fallback={this.loading()}>
                            <DefaultHeader onLogout={e => this.signOut(e)}/>
                        </Suspense>
                    </AppHeader>
                    <div className="app-body">
                        <AppSidebar fixed display="lg">
                            <AppSidebarHeader/>
                            <AppSidebarForm/>
                            <Suspense fallback={this.loading()}>
                                <AppSidebarNav navConfig={this.navConfig} />
                            </Suspense>
                            <AppSidebarFooter/>
                            <AppSidebarMinimizer/>
                        </AppSidebar>
                        <main className="main">
                            {/* <AppBreadcrumb appRoutes={routes}/> */}
                            <RcloneWarningBanner hasError={this.props.version.hasError} error={this.props.version.error} version={this.props.version} />
                            <Container fluid>
                                <Suspense fallback={this.loading()}>
                                    <Routes>
                                        {
                                            routes.map((route, idx) => {
                                                return route.component ? (
                                                    <Route
                                                        key={idx}
                                                        path={route.path}
                                                        element={<route.component />}
                                                    />
                                                ) : (null);
                                            })
                                        }
                                        <Route index element={<Navigate to="dashboard" replace />} />
                                        <Route path="*" element={<Navigate to="dashboard" replace />} />
                                    </Routes>
                                </Suspense>
                            </Container>
                        </main>
                    </div>
                    <AppFooter>
                        <Suspense fallback={this.loading()}>
                            <DefaultFooter/>
                        </Suspense>
                    </AppFooter>
                </ErrorBoundary>
            </div>
        );
    }
}

const mapStateToProps = (state) => ({
    isConnected: state.status.isConnected,
    version: state.version,
});

export default withRouter(connect(mapStateToProps, { getVersion })(DefaultLayout));
