import React from 'react';

const MyDashboard = React.lazy(() => import('./views/RemoteManagement/NewDrive'));
const Home = React.lazy(() => import('./views/Home'));
const ShowConfig = React.lazy(() => import('./views/RemoteManagement/ShowConfig'));
const RemoteExplorerLayout = React.lazy(() => import("./views/Explorer/RemoteExplorerLayout"));
const RCloneDashboard = React.lazy(() => import("./views/RCloneDashboard"));
const MountDashboard = React.lazy(() => import("./views/MountDashboard"));
const RcloneServers = React.lazy(() => import("./views/RcloneServers/RcloneServers"));
const Help = React.lazy(() => import("./views/Help/Help"));
const ChangePassword = React.lazy(() => import("./views/ChangePassword/ChangePassword"));

// https://github.com/ReactTraining/react-router/tree/master/packages/react-router-config
// Define the routes as required
const routes = [
    {path: 'newdrive/edit/:drivePrefix', name: 'Edit Remote', component: MyDashboard},
    {path: 'newdrive', name: 'New Remote', component: MyDashboard},
    {path: 'dashboard', name: 'Dashboard', component: Home},
    {path: 'showconfig', name: 'Remotes', component: ShowConfig},
    {path: 'remoteExplorer/:remoteName/:remotePath', name: 'Explorer', component: RemoteExplorerLayout},
    {path: 'remoteExplorer', name: 'Explorer', component: RemoteExplorerLayout},
    {path: 'rcloneBackend', name: 'Rclone Backend', component: RCloneDashboard},
    {path: 'mountDashboard', name: 'Mount Dashboard', component: MountDashboard},
    {path: 'rcloneServers', name: 'Rclone Director', component: RcloneServers},
    {path: 'help', name: 'Help', component: Help},
    {path: 'changePassword', name: 'Change Password', component: ChangePassword},
];

export default routes;
