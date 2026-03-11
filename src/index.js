import './polyfill'
import React from 'react';
import {createRoot} from 'react-dom/client';
import './index.css';
import App from './App';
import * as serviceWorker from './serviceWorker';
import {Provider} from "react-redux";
import store from './store';

// Patch rclone-api library's axios instance to include our custom headers
import {axiosInstance as rcloneAxios} from 'rclone-api/lib/axiosInstance';
import {SESSION_KEY, AUTH_KEY, IP_ADDRESS_KEY} from './utils/Constants';

// Normalize localStorage for rclone-api on app boot (force)
try {
  localStorage.setItem(IP_ADDRESS_KEY, '/api/rclone');
  sessionStorage.setItem(IP_ADDRESS_KEY, '/api/rclone');
  console.log('🔧 Forced rclone-api baseURL to', localStorage.getItem(IP_ADDRESS_KEY));
  // Ensure Authorization key exists in localStorage if present in session
  const sessAuth = sessionStorage.getItem(AUTH_KEY);
  if (sessAuth && !localStorage.getItem(AUTH_KEY)) {
    localStorage.setItem(AUTH_KEY, sessAuth);
    console.log('🔧 Initialized rclone-api authKey from session');
  }
} catch (e) {
  // no-op
}

// Add interceptor to rclone-api's axios instance to include required headers
// IMPORTANT: We need to ensure this runs AFTER rclone-api's own interceptor
// So we check and override baseURL if it's not set correctly
rcloneAxios.interceptors.request.use(
    config => {
        // CRITICAL: Force baseURL to /api/rclone for all rclone-api requests
        // The rclone-api library's interceptor reads from localStorage, but we override it here
        // to ensure it's always /api/rclone
        if (!config.baseURL || config.baseURL !== '/api/rclone') {
            config.baseURL = '/api/rclone';
            console.warn('🔧 rclone-api baseURL was incorrect, fixed to /api/rclone');
        }
        
        // Ensure localStorage is also set (for rclone-api's interceptor on next request)
        try {
            localStorage.setItem(IP_ADDRESS_KEY, '/api/rclone');
        } catch (e) {
            // localStorage might be disabled, ignore
        }
        
        // Add X-Session-Key header from sessionStorage (random token, not password)
        const sessionKey = sessionStorage.getItem(SESSION_KEY);
        if (sessionKey && sessionKey !== 'null' && sessionKey !== 'undefined') {
            config.headers['X-Session-Key'] = sessionKey;
        }
        
        // Add X-Rclone-Server header from sessionStorage (set by ServerSelector)
        const selectedServerId = sessionStorage.getItem('RCLONE_SERVER_ID');
        if (selectedServerId && selectedServerId !== 'null' && selectedServerId !== 'undefined') {
            config.headers['X-Rclone-Server'] = selectedServerId;
        }
        
        // CRITICAL FIX: If URL starts with '/', axios will ignore baseURL
        // Remove leading slash so axios combines baseURL + url correctly
        if (config.url && config.url.startsWith('/')) {
            config.url = config.url.substring(1);
        }
        
        console.log('🔧 rclone-api request:', {
            url: config.url,
            baseURL: config.baseURL,
            fullURL: (config.baseURL || '') + '/' + config.url,
            headers: {
                'X-Session-Key': config.headers['X-Session-Key'] ? '***' : 'missing',
                'X-Rclone-Server': config.headers['X-Rclone-Server'],
                'Authorization': config.headers.Authorization ? 'Basic ***' : 'missing'
            }
        });
        
        return config;
    },
    error => Promise.reject(error)
);

// Add response interceptor to handle 401 and 503 errors globally
rcloneAxios.interceptors.response.use(
    response => response, // Pass through successful responses
    error => {
        // IMPORTANT: Don't redirect if we're already on the login page to prevent infinite loops
        // HashRouter uses #/login format, so check hash exactly
        const currentHash = window.location.hash;
        const isLoginPage = currentHash === '#/login' || currentHash === '#/login/' || 
                           currentHash.startsWith('#/login?') || currentHash.startsWith('#/login/?');
        
        // Handle 503 Service Unavailable - RCD backend not reachable
        // IMPORTANT: Do NOT redirect to login, just pass through the error
        // Dashboard will handle it gracefully with a banner
        if (error.response && error.response.status === 503) {
            console.warn('[RCLONE] Backend unavailable (503) - dashboard will show error banner');
            return Promise.reject(error);
        }
        
        // Handle 401 Unauthorized - session expired or invalid
        if (error.response && error.response.status === 401) {
            // If we're already on the login page, just pass through the error
            if (isLoginPage) {
                console.log('[AUTH] 401 on login page - ignoring (prevents redirect loop)');
                return Promise.reject(error);
            }
            
            console.error('[AUTH] Session expired or invalid (401). Redirecting to login...');
            
            // Preserve server selection across logout/login
            const lastServerId = localStorage.getItem('RCLONE_LAST_SERVER_ID');
            
            // Clear all session data
            sessionStorage.clear();
            localStorage.clear();
            
            // Restore server selection
            if (lastServerId) {
                localStorage.setItem('RCLONE_LAST_SERVER_ID', lastServerId);
            }
            
            // Store error message for login page
            sessionStorage.setItem('LOGIN_ERROR', 'Your session has expired or is invalid. Please log in again.');
            
            // Redirect to login page (use hash routing)
            window.location.hash = '#/login';
            
            // Return a rejected promise to prevent further processing
            return Promise.reject(error);
        }
        
        // For all other errors, pass them through
        return Promise.reject(error);
    }
);

console.log('✅ rclone-api axios instance patched with custom headers and 401 handler');

const container = document.getElementById('root');
const root = createRoot(container);

root.render(
    <Provider store={store}>
        <App/>
    </Provider>
);

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: http://bit.ly/CRA-PWA
serviceWorker.unregister();