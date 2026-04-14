/**
 * Configure proxy for Create React App dev server
 * Handles both localhost and network IP access
 */
const { createProxyMiddleware } = require('http-proxy-middleware');

const DIRECTOR_PORT = process.env.REACT_APP_DIRECTOR_PORT || '5573';
const DIRECTOR_URL = `http://127.0.0.1:${DIRECTOR_PORT}`;

module.exports = function(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: DIRECTOR_URL,
      changeOrigin: true,
      pathRewrite: {
        '^/api': ''
      },
      onProxyReq: (proxyReq, req, res) => {
        console.log(`[PROXY] ${req.method} ${req.url} -> ${DIRECTOR_URL}${req.url.replace('/api', '')}`);
      },
      onError: (err, req, res) => {
        console.error(`[PROXY ERROR] ${req.url}:`, err.message);
        res.status(500).json({
          error: 'Proxy Error',
          message: 'Failed to connect to Rclone Director backend',
          details: err.message
        });
      }
    })
  );
};
