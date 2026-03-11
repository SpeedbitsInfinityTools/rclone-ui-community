/**
 * Configure proxy for Create React App dev server
 * Handles both localhost and network IP access
 */
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // Proxy all /api requests to Rclone Director
  // Use 127.0.0.1 instead of localhost to avoid IPv6 issues
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'http://127.0.0.1:5573',
      changeOrigin: true,
      pathRewrite: {
        '^/api': '' // Remove /api prefix when forwarding
      },
      onProxyReq: (proxyReq, req, res) => {
        // Log proxied requests for debugging
        console.log(`[PROXY] ${req.method} ${req.url} -> http://127.0.0.1:5573${req.url.replace('/api', '')}`);
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
