import React from 'react';
import {HashRouter, Route, Routes} from 'react-router-dom';
import './App.scss';
import {ToastContainer} from "react-toastify";
import 'react-toastify/dist/ReactToastify.css';
import ErrorBoundary from "./ErrorHandling/ErrorBoundary";

const loading = () => <div className="animated fadeIn pt-3 text-center">Loading...</div>;

// Containers
const DefaultLayout = React.lazy(() => import('./containers/DefaultLayout'));

// Pages
const Login = React.lazy(() => import('./views/Pages/Login'));
const Register = React.lazy(() => import('./views/Pages/Register'));
const Page404 = React.lazy(() => import('./views/Pages/Page404'));
const Page500 = React.lazy(() => import('./views/Pages/Page500'));

function App() {
    return (
        <div data-test="appComponent">
            <ErrorBoundary>
                <ToastContainer autoClose={5000} />
                <HashRouter>
                    <React.Suspense fallback={loading()}>
                        <Routes>
                            <Route path="/login" element={<Login />} />
                            <Route path="/register" element={<Register />} />
                            <Route path="/404" element={<Page404 />} />
                            <Route path="/500" element={<Page500 />} />
                            <Route path="/*" element={<DefaultLayout />} />
                        </Routes>
                    </React.Suspense>
                </HashRouter>
            </ErrorBoundary>
        </div>
    );
}

export default App;
