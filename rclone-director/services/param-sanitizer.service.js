/**
 * Backend parameter sanitizer for rclone config writes.
 *
 * This is the server-side mirror of the conflict-resolution applied in the
 * Rclone UI wizard (src/views/RemoteManagement/NewDrive/formHandlers.js ->
 * sanitizeAzureBlobParameters). The Director proxy is a general API surface —
 * the UI is not its only client (curl, scripts, automation, a different
 * front-end can all POST config/create | config/update). This module enforces
 * one narrow invariant at the proxy boundary: a remote must not carry two
 * mutually-exclusive auth methods at once.
 *
 * IMPORTANT — what this is NOT:
 *   This is deliberately NOT a whitelist that strips every unknown field.
 *   An earlier version did that and would have silently broken every
 *   legitimate advanced Azure auth mode (Managed Identity, env_auth / default
 *   credential chain, Azure CLI, service principal, connection string) for any
 *   API client. Those are all valid ways to configure azureblob and must keep
 *   working. We only remove fields that ACTIVELY CONTRADICT an explicit static
 *   credential the caller also provided.
 *
 * Background — the bug this fixes:
 *   We observed azureblob remotes whose stored rclone.conf carried a valid
 *   `sas_url` AND, simultaneously, `env_auth=true`, `use_msi=true`,
 *   `use_az=true`, `use_emulator=true`, a `connection_string`, and assorted
 *   service-principal/cert fields. In rclone's azureblob backend those
 *   "auth-mode selector" fields take precedence over the SAS-URL branch, so
 *   the sas_url was silently ignored at runtime and rclone failed with
 *   "account must be set: can't make service URL". The stray fields came from
 *   password-manager autofill and live-schema form residue on the UI side.
 *
 * The rule:
 *   - If the caller provided an explicit STATIC credential — a `sas_url`, or an
 *     `account`+`key` pair — then any *active* alternative-auth-method field is
 *     a contradiction and is stripped (logged, not silently swallowed elsewhere).
 *   - If NO static credential is present, the parameters are passed through
 *     untouched. A caller doing pure MSI / env_auth / service-principal /
 *     connection-string auth is left completely alone.
 *
 * "Active" means the field is actually set to a meaningful value — a bool that
 * is true, or a string that is non-empty. A field explicitly set to its
 * default (env_auth=false, connection_string="") changes nothing and is left
 * in place.
 */

// Auth-method selector / modifier fields for azureblob. When ANY of these is
// active alongside an explicit static credential (sas_url or account+key) it
// will hijack rclone's auth dispatch and override the credential the caller
// clearly intended to use. Keep this in sync with the UI copy in
// formHandlers.js (AZUREBLOB_CONFLICTING_AUTH_FIELDS).
const AZUREBLOB_CONFLICTING_AUTH_FIELDS = new Set([
    // Default-credential chain / environment auth
    'env_auth',
    // Managed Service Identity
    'use_msi',
    'msi_object_id',
    'msi_client_id',
    'msi_mi_res_id',
    // Local emulator
    'use_emulator',
    // Azure CLI delegation
    'use_az',
    // Connection string (its own complete auth method)
    'connection_string',
    // Service principal (client credentials / certificate / user-pass flows)
    'client_id',
    'client_secret',
    'tenant',
    'client_certificate_path',
    'client_certificate_password',
    'client_send_certificate_chain',
    'username',
    'password',
    'service_principal_file',
    'disable_instance_discovery',
]);

/**
 * Treat an rclone config value as "actively set".
 * rclone RC values usually arrive as strings, so "false" / "" / "0" / "no"
 * all mean "not engaged".
 * @param {*} v
 * @returns {boolean}
 */
function isActiveParam(v) {
    if (v === undefined || v === null) return false;
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    return s !== '' && s !== 'false' && s !== '0' && s !== 'no';
}

/**
 * azureblob conflict resolver. See module header for the rule.
 * @param {Object} parameters
 * @returns {{cleaned: Object, stripped: string[]}}
 */
function sanitizeAzureBlobParameters(parameters) {
    const hasSas = isActiveParam(parameters.sas_url);
    const hasAccountKey = isActiveParam(parameters.account) && isActiveParam(parameters.key);
    const staticCredentialPresent = hasSas || hasAccountKey;

    // No explicit static credential => caller is using an alternative auth
    // mode on purpose. Do not touch anything.
    if (!staticCredentialPresent) {
        return { cleaned: parameters, stripped: [] };
    }

    const cleaned = {};
    const stripped = [];
    for (const [key, value] of Object.entries(parameters)) {
        // Only strip a conflicting field if it's actually engaged; a field left
        // at its default value is harmless and we preserve it.
        if (AZUREBLOB_CONFLICTING_AUTH_FIELDS.has(key) && isActiveParam(value)) {
            stripped.push(key);
        } else {
            cleaned[key] = value;
        }
    }
    return { cleaned, stripped };
}

// Per-backend sanitizers. Only backends listed here are processed at all;
// every other backend type is passed through untouched.
const BACKEND_SANITIZERS = {
    azureblob: sanitizeAzureBlobParameters,
};

/**
 * Returns true if we have a sanitizer for the given backend type.
 * @param {string} type rclone backend type (e.g. "azureblob")
 * @returns {boolean}
 */
function hasSanitizer(type) {
    return !!(type && BACKEND_SANITIZERS[type]);
}

/**
 * Resolve auth-method conflicts for `type`.
 *
 * If there is no sanitizer for `type` (or `parameters` isn't a plain object),
 * the input is returned unchanged with an empty `stripped` array — callers can
 * safely forward the result either way.
 *
 * @param {string} type        rclone backend type.
 * @param {Object} parameters  the parameters object from config/create|update.
 * @returns {{cleaned: Object, stripped: string[]}}
 */
function sanitizeRcloneParameters(type, parameters) {
    const sanitizer = BACKEND_SANITIZERS[type];
    if (!sanitizer || !parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
        return { cleaned: parameters, stripped: [] };
    }
    return sanitizer(parameters);
}

module.exports = {
    AZUREBLOB_CONFLICTING_AUTH_FIELDS,
    isActiveParam,
    hasSanitizer,
    sanitizeRcloneParameters,
};
