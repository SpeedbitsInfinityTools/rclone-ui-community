# OAuth Implementation for Rclone Backends

This module implements OAuth authentication flows for Rclone backends, replacing the previous Rclone `noopauth`-based approach.

## Structure

```
oauth/
├── index.js              # Main OAuth handlers (handleAuthorize, handleCallback, handleCheck)
├── oauth-config.js       # OAuth configurations for all providers
├── utils.js              # Shared utilities (state generation, token formatting, etc.)
└── providers/
    ├── base.js           # Base provider class with common OAuth logic
    └── dropbox.js        # Dropbox-specific implementation
```

## Current Status

### ✅ Implemented: Dropbox

- **Config**: Dropbox OAuth configuration extracted from Rclone source
- **Provider**: DropboxProvider class implemented
- **Integration**: Integrated with `server.js` OAuth endpoints
- **Flow**: Complete OAuth flow (authorize → callback → token exchange → config creation)

### ⚠️ Known Issues

1. **Dropbox Client Secret**: 
   - Rclone obscures the client secret using `obscure.MustReveal()`
   - Current implementation requires users to provide their own `client_id` and `client_secret`
   - TODO: Implement Rclone's obscure reveal function or find the actual secret

2. **Other Providers**: 
   - Not yet implemented - will fall back to old Rclone `noopauth` implementation
   - See `_resources/rclone-portals-with-oauth/list-with-oauth.md` for full list

## Usage

The OAuth module is automatically used when:
1. User clicks "Authenticate" button in the wizard for a supported provider (currently Dropbox)
2. Frontend calls `/api/director/oauth/authorize` with `type: "dropbox"`
3. Backend routes to `oauthHandlers.handleAuthorize()`
4. User authenticates with Dropbox
5. Dropbox redirects to `/director/oauth/callback`
6. Backend exchanges code for token and creates Rclone config

## Adding New Providers

1. Add provider config to `oauth-config.js`
2. Create provider class in `providers/{provider}.js` extending `BaseProvider`
3. Register provider in `index.js` providers object
4. Test the complete flow

## Files Created

- `rclone-director/oauth/index.js` - Main handlers
- `rclone-director/oauth/oauth-config.js` - Provider configurations
- `rclone-director/oauth/utils.js` - Shared utilities
- `rclone-director/oauth/providers/base.js` - Base provider class
- `rclone-director/oauth/providers/dropbox.js` - Dropbox provider

## Integration Points

- `server.js` imports `oauthHandlers` module
- OAuth endpoints check if provider is in `oauthHandlers.providers`
- If yes → use new implementation
- If no → fall back to old Rclone `noopauth` implementation

