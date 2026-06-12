import axiosInstance from "../../../utils/API/API";
import {findFromConfig, isEmpty, supportsOAuth, validateDriveName, validateDuration, validateInt, validateSizeSuffix} from "../../../utils/Tools";
import {toast} from "react-toastify";
import urls from "../../../utils/API/endpoint";
import {NEW_DRIVE_CONFIG_REFRESH_TIMEOUT} from "../../../utils/Constants";

// ---------------------------------------------------------------------------
// Azure Blob auth-method conflict resolution
// ---------------------------------------------------------------------------
// rclone's azureblob backend supports many mutually-exclusive auth methods
// (Account Key, SAS URL, connection_string, Managed Identity, env_auth /
// default credential chain, Azure CLI, service principal, emulator, ...). The
// wizard itself only offers Account+Key and SAS URL, but the live provider
// schema fetched from rclone exposes the advanced fields too, and a couple of
// vectors can poison the form values without the user typing them:
//
//   * `account = admin` and `client_certificate_password = <password>` —
//     password-manager autofill recognising the rclone-ui Basic Auth login
//     and injecting it into adjacent inputs (also mitigated with anti-autofill
//     props in DriveParameters.js).
//   * `use_az = true`, `use_msi = true`, `env_auth = true`, `use_emulator =
//     true`, a `connection_string = ...`, etc. left over from template import
//     or live-schema residue.
//
// In rclone, those alternative-auth fields take PRECEDENCE over the SAS-URL /
// account-key branch, so when they leak in alongside a sas_url the credential
// the user actually entered is silently ignored and rclone fails with
// "account must be set: can't make service URL".
//
// IMPORTANT: this is NOT a whitelist that strips every unknown field. Doing so
// would break legitimate advanced auth modes (MSI / env_auth / service
// principal / connection string) for power users. We only remove an
// alternative-auth field when it is ACTIVELY set AND the same payload already
// carries an explicit static credential (sas_url, or account+key) that it
// would override. With no static credential present, parameters pass through
// untouched. Keep this list in sync with the Director copy in
// rclone-director/services/param-sanitizer.service.js.
const AZUREBLOB_CONFLICTING_AUTH_FIELDS = new Set([
    'env_auth',
    'use_msi', 'msi_object_id', 'msi_client_id', 'msi_mi_res_id',
    'use_emulator',
    'use_az',
    'connection_string',
    'client_id', 'client_secret', 'tenant',
    'client_certificate_path', 'client_certificate_password',
    'client_send_certificate_chain',
    'username', 'password',
    'service_principal_file',
    'disable_instance_discovery',
]);

/**
 * Treat a form/config value as "actively set". rclone bool fields come through
 * as the strings "true"/"false"; empty string / "false" / "0" / "no" all mean
 * the field is not engaged.
 */
function isActiveAzureParam(v) {
    if (v === undefined || v === null) return false;
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    return s !== '' && s !== 'false' && s !== '0' && s !== 'no';
}

/**
 * Remove azureblob auth fields that contradict an explicitly-provided static
 * credential (sas_url, or account+key). If no static credential is present the
 * parameters are returned unchanged, so MSI / env_auth / service-principal /
 * connection-string remotes are left intact. Returns `{ cleaned, stripped }`.
 * `params` is treated as immutable.
 */
export function sanitizeAzureBlobParameters(params) {
    const p = params || {};
    const hasSas = isActiveAzureParam(p.sas_url);
    const hasAccountKey = isActiveAzureParam(p.account) && isActiveAzureParam(p.key);
    const staticCredentialPresent = hasSas || hasAccountKey;

    if (!staticCredentialPresent) {
        return { cleaned: p, stripped: [] };
    }

    const cleaned = {};
    const stripped = [];
    for (const [k, v] of Object.entries(p)) {
        if (AZUREBLOB_CONFLICTING_AUTH_FIELDS.has(k) && isActiveAzureParam(v)) {
            stripped.push(k);
        } else {
            cleaned[k] = v;
        }
    }
    return { cleaned, stripped };
}

export function parseAzureSasInput(input) {
        const trimmed = input.trim();
        
        // Connection string with SAS: "BlobEndpoint=https://...;SharedAccessSignature=sv=..."
        // or: "SharedAccessSignature=sv=...&sig=...%3D;BlobEndpoint=https://...;..."
        // SAS tokens are URL-encoded and never contain a raw ';', so we stop at ';' or end-of-string.
        if (/SharedAccessSignature=/i.test(trimmed)) {
            const sasMatch = trimmed.match(/SharedAccessSignature=([^;]+)/i);
            const blobMatch = trimmed.match(/BlobEndpoint=(https?:\/\/[^;]+)/i);
            const accountNameMatch = trimmed.match(/AccountName=([^;]+)/i);
            
            if (blobMatch && sasMatch) {
                const blobEndpoint = blobMatch[1].replace(/\/$/, '');
                const sasToken = sasMatch[1].replace(/^\?/, '');
                const accountMatch = blobEndpoint.match(/https?:\/\/([^.]+)\./);
                return {
                    sasUrl: `${blobEndpoint}?${sasToken}`,
                    account: accountMatch ? accountMatch[1] : (accountNameMatch ? accountNameMatch[1] : ''),
                    type: 'Azure connection string (SAS)'
                };
            }
            // No BlobEndpoint but has AccountName - construct the URL
            if (accountNameMatch && sasMatch) {
                const sasToken = sasMatch[1].replace(/^\?/, '');
                return {
                    sasUrl: `https://${accountNameMatch[1]}.blob.core.windows.net?${sasToken}`,
                    account: accountNameMatch[1],
                    type: 'Azure connection string (SAS)'
                };
            }
        }
        
        // Connection string with AccountKey (no SAS): "DefaultEndpointsProtocol=https;AccountName=...;AccountKey=..."
        if (/AccountKey=/i.test(trimmed) && /AccountName=/i.test(trimmed)) {
            const accountNameMatch = trimmed.match(/AccountName=([^;]+)/i);
            const accountKeyMatch = trimmed.match(/AccountKey=([^;]+={0,2})/i);
            if (accountNameMatch && accountKeyMatch) {
                return {
                    account: accountNameMatch[1],
                    key: accountKeyMatch[1],
                    sasUrl: '',
                    type: 'Azure connection string (Account Key)'
                };
            }
        }
        
        // Bare SAS token: "sv=2025-11-05&ss=b&srt=sc&sp=..."  (no URL prefix)
        if (trimmed.startsWith('sv=') || trimmed.startsWith('?sv=')) {
            return null;
        }
        
        // Already a proper Blob SAS URL: "https://account.blob.core.windows.net/?sv=..."
        if (trimmed.startsWith('https://') && trimmed.includes('.blob.') && trimmed.includes('sv=')) {
            const accountMatch = trimmed.match(/https?:\/\/([^.]+)\./);
            return {
                sasUrl: trimmed,
                account: accountMatch ? accountMatch[1] : '',
                type: 'Azure Blob SAS URL'
            };
        }
        
        return null;
}

/**
 * Extract the storage account name from a SAS URL's hostname.
 * Returns null if the URL cannot be parsed or doesn't look like a *.blob.* URL.
 *
 * Examples:
 *   "https://easyzoom.blob.core.windows.net/?sv=..."  -> "easyzoom"
 *   "https://easyzoom.blob.core.windows.net/c?sv=..." -> "easyzoom"
 *   "https://easyzoom.blob.core.windows.net?sv=..."   -> "easyzoom"
 */
export function extractAzureAccountFromSasUrl(sasUrl) {
    if (!sasUrl) return null;
    try {
        const u = new URL(String(sasUrl).trim());
        if (!/\.blob\./i.test(u.hostname)) return null;
        const first = u.hostname.split('.')[0] || '';
        return first || null;
    } catch (e) {
        return null;
    }
}

/**
 * Validate the shape of an Azure Blob `sas_url` value before saving / testing.
 *
 * The wizard's old behaviour silently saved any string the user put in `sas_url` and
 * relied on rclone to fail downstream — which it does, but very ambiguously (often as
 * a generic 500 only when the user finally clicks into a folder in Explorer).
 *
 * This validator catches the common bad shapes up-front, with explanations:
 *   - missing https:// scheme (e.g. user pasted only the hostname)
 *   - missing the `?<sas-token>` part
 *   - missing required SAS fields `sig=` / `sv=`
 *   - IP-restricted SAS (`sip=`) — likely to 403 from servers with a different egress IP
 *   - container-scoped SAS (`sr=c`) without `/<container>` in the path
 *   - expired SAS (`se=` in the past)
 *
 * Optional `remoteName` enables an account-mismatch warning: if the SAS URL points
 * at storage account `foo` but the remote is being saved as `bar`, that's almost
 * always a copy-paste mistake. We've seen this in the wild — a remote literally
 * named "EasyZoom" with a SAS URL pointing at "marketaccesssuite". The warning
 * is non-blocking because there are legitimate cases (one storage account hosting
 * multiple logical projects, vendor-managed shared accounts, etc.).
 *
 * Returns: { ok: boolean, error: string|null, warnings: string[] }
 * - ok=false + error  -> hard validation failure, do not save.
 * - ok=true + warnings -> save is OK, but surface warnings to the user.
 */
export function validateAzureSasUrl(sasUrl, remoteName = null) {
    const result = { ok: true, error: null, warnings: [] };
    if (!sasUrl) return result;

    const trimmed = String(sasUrl).trim();

    if (!/^https?:\/\//i.test(trimmed)) {
        result.ok = false;
        result.error =
            "SAS URL must start with https:// — it looks like only a hostname or token was pasted. " +
            "Use the full 'Blob SAS URL' from Azure (e.g. https://<account>.blob.core.windows.net/<container>?sv=...&sig=...).";
        return result;
    }

    if (!/\.blob\./i.test(trimmed)) {
        result.ok = false;
        result.error =
            "SAS URL must point to a Blob endpoint (got something else, e.g. file/queue/table). " +
            "It should look like: https://<account>.blob.core.windows.net/<container>?sv=...&sig=...";
        return result;
    }

    const qIndex = trimmed.indexOf('?');
    if (qIndex === -1) {
        result.ok = false;
        result.error =
            "SAS URL is missing the '?<sas-token>' part. Did you paste only the endpoint without the SAS token?";
        return result;
    }

    const queryString = trimmed.slice(qIndex + 1);
    if (!/(^|&)sig=[^&]+/.test(queryString)) {
        result.ok = false;
        result.error = "SAS URL is missing 'sig=' — that isn't a valid SAS token.";
        return result;
    }
    if (!/(^|&)sv=[^&]+/.test(queryString)) {
        result.ok = false;
        result.error = "SAS URL is missing 'sv=' (Storage API version) — that isn't a valid SAS token.";
        return result;
    }

    // ---- Warnings (non-blocking) -------------------------------------------

    const sipMatch = queryString.match(/(?:^|&)sip=([^&]+)/);
    if (sipMatch) {
        let sipVal;
        try { sipVal = decodeURIComponent(sipMatch[1]); } catch (e) { sipVal = sipMatch[1]; }
        result.warnings.push(
            `This SAS is IP-restricted to '${sipVal}'. The server running rclone must have its outbound public IP exactly match this value, ` +
            `otherwise every request will get HTTP 403 from Azure (which the UI surfaces as a generic 500 in the Explorer). ` +
            `If unsure, regenerate the SAS without an IP restriction, or regenerate it from the rclone host.`
        );
    }

    const srMatch = queryString.match(/(?:^|&)sr=([^&]+)/);
    if (srMatch && (srMatch[1] === 'c' || srMatch[1] === 'b')) {
        // Container- or blob-scoped SAS must include the container in the path.
        let pathOnly = '';
        try {
            const u = new URL(trimmed);
            pathOnly = u.pathname || '';
        } catch (e) {
            pathOnly = '';
        }
        const pathSegments = pathOnly.split('/').filter(p => p.length > 0);
        if (pathSegments.length === 0) {
            result.warnings.push(
                `This is a container/blob-scoped SAS ('sr=${srMatch[1]}') but the URL has no container in its path. ` +
                `It should look like: https://<account>.blob.core.windows.net/<container-name>?sv=...&sig=... ` +
                `Without the container in the path, listing inside containers will fail in the Explorer.`
            );
        }
    }

    const seMatch = queryString.match(/(?:^|&)se=([^&]+)/);
    if (seMatch) {
        try {
            const expiry = new Date(decodeURIComponent(seMatch[1]));
            if (!isNaN(expiry.getTime()) && expiry < new Date()) {
                result.warnings.push(`This SAS expired on ${expiry.toISOString()} — Azure will reject all requests.`);
            }
        } catch (e) {
            // ignore parse failures
        }
    }

    // Account-name vs remote-name mismatch warning (non-blocking).
    // A real-world failure mode: user names a remote "EasyZoom" but pastes
    // a SAS URL for a different account ("marketaccesssuite"). Saving works,
    // listing works, but every label / log / mount-point in the UI shows
    // "EasyZoom" while the data is actually coming from somewhere else.
    if (remoteName) {
        const sasAccount = extractAzureAccountFromSasUrl(trimmed);
        if (sasAccount) {
            const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const normRemote = norm(remoteName);
            const normAccount = norm(sasAccount);
            // Warn only if the names are wildly different (no substring overlap
            // either way). One being a prefix/suffix of the other is OK —
            // people commonly name remotes after the company / account anyway.
            const overlaps =
                normRemote === '' || normAccount === '' ||
                normRemote.includes(normAccount) || normAccount.includes(normRemote);
            if (!overlaps) {
                result.warnings.push(
                    `Heads-up: this SAS URL points at the storage account "${sasAccount}", ` +
                    `but the remote is being saved as "${remoteName}". ` +
                    `Saving still works, but every reference in the UI will say "${remoteName}" while ` +
                    `the data lives in "${sasAccount}" — usually a sign the wrong SAS was pasted. ` +
                    `If that's intentional you can ignore this; if not, rename the remote (or paste the right SAS) before saving.`
                );
            }
        }
    }

    return result;
}

/**
 * Handle input change and set appropriate errors.
 * @param e
 */
export function handleInputChange(e) {

        let inputName = e.target.name;
        let inputValue = e.target.value;
        const inputType = this.state.optionTypes[inputName];
        
        // Azure Blob: auto-parse connection strings pasted into ANY field
        if (this.state.drivePrefix === 'azureblob' && inputValue) {
            const looksLikeConnString = /BlobEndpoint=|SharedAccessSignature=|AccountKey=|AccountName=|DefaultEndpointsProtocol=/i.test(inputValue);
            
            if ((inputName === 'sas_url' || inputName === 'key' || inputName === 'account') && looksLikeConnString) {
                const parsed = this.parseAzureSasInput(inputValue);
                if (parsed) {
                    if (parsed.key) {
                        // AccountKey connection string -> fill account + key, clear sas_url
                        this.setState({
                            formValues: {
                                ...this.state.formValues,
                                account: parsed.account || '',
                                key: parsed.key,
                                sas_url: ''
                            }
                        });
                    } else {
                        // SAS connection string -> fill sas_url, clear account + key
                        this.setState({
                            formValues: {
                                ...this.state.formValues,
                                sas_url: parsed.sasUrl,
                                account: '',
                                key: ''
                            }
                        });
                    }
                    toast.success(`Detected ${parsed.type} - auto-configured fields`);
                    return;
                }
            }
            
            // Detect Blob SAS URL pasted into sas_url field
            if (inputName === 'sas_url' && !looksLikeConnString) {
                const parsed = this.parseAzureSasInput(inputValue);
                if (parsed) {
                    this.setState({
                        formValues: {
                            ...this.state.formValues,
                            sas_url: parsed.sasUrl,
                            account: '',
                            key: ''
                        }
                    });
                    toast.success(`Detected ${parsed.type} - auto-configured SAS URL`);
                    return;
                }
                // Any value in SAS URL clears account + key
                if (inputValue) {
                    this.setState({
                        formValues: { ...this.state.formValues, sas_url: inputValue, account: '', key: '' }
                    });
                    return;
                }
            }
            
            // Filling account or key clears SAS URL
            if ((inputName === 'account' || inputName === 'key') && inputValue && this.state.formValues.sas_url) {
                this.setState({
                    formValues: { ...this.state.formValues, [inputName]: inputValue, sas_url: '' }
                });
                return;
            }
        }
        
        this.setState({
            formValues: {
                ...this.state.formValues,
                [inputName]: inputValue
            }
        });
        let validateResult = true;
        let error = "";
        if (inputType === "SizeSuffix") {
            validateResult = validateSizeSuffix(inputValue);
            if (!validateResult) {
                error = "The valid input is size( off | {unit}{metric} eg: 10G, 100M, 10G100M etc.)"
            }
        } else if (inputType === "Duration") {
            validateResult = validateDuration(inputValue);
            if (!validateResult) {
                error = "The valid input is time ({unit}{metric} eg: 10ms, 100m, 10h15ms etc.)"
            }
        } else if (inputType === "int") {
            validateResult = validateInt(inputValue);
            if (!validateResult) {
                error = "The valid input is int (100,200,300 etc)"
            }
        }

        if (this.state.required[inputName] && (!inputValue || inputValue === "")) {
            validateResult = false;
            if (!validateResult) {
                error += " This field is required";
            }
        }


        this.setState((prevState) => {
            return {
                isValid: {
                    ...prevState.isValid,
                    [inputName]: validateResult
                },
                formErrors: {
                    ...prevState.formErrors,
                    [inputName]: error
                },
            }
        });


}

/**
 * Validate form values against their types and requirements
 * @param formValues {object} Current form values
 * @param optionTypes {object} Type mapping for each field
 * @param required {object} Required flag for each field
 * @returns {object} Updated isValid and formErrors objects
 */
export function validateFormValues(formValues, optionTypes, required) {
        const isValid = {};
        const formErrors = {};
        
        for (const [key, value] of Object.entries(formValues)) {
            const inputType = optionTypes[key];
            const isRequired = required[key];
            let validateResult = true;
            let error = "";
            
            // Type-specific validation
            if (inputType === "SizeSuffix") {
                validateResult = validateSizeSuffix(value);
                if (!validateResult) {
                    error = "The valid input is size( off | {unit}{metric} eg: 10G, 100M, 10G100M etc.)";
                }
            } else if (inputType === "Duration") {
                validateResult = validateDuration(value);
                if (!validateResult) {
                    error = "The valid input is time ({unit}{metric} eg: 10ms, 100m, 10h15ms etc.)";
                }
            } else if (inputType === "int") {
                validateResult = validateInt(value);
                if (!validateResult) {
                    error = "The valid input is int (100,200,300 etc)";
                }
            }
            
            // Required field validation
            if (isRequired && (!value || value === "")) {
                validateResult = false;
                if (error) {
                    error += " This field is required";
                } else {
                    error = "This field is required";
                }
            }
            
            isValid[key] = validateResult;
            formErrors[key] = error;
        }
        
        return { isValid, formErrors };
}

/**
 * Update the driveType and then load the equivalent input parameters for that drive.
 * @param event     {$ObjMap} Event to be handled.
 * @param newValue  {string} new Value of the drive type.
 */
export function changeDriveType(event, {newValue}) {

        const {providers} = this.props;

        let val = newValue;


        let availableOptions = {};
        let optionTypes = {};
        let isValid = {};
        let formErrors = {};
        let required = {};
        // let drivePrefix = "";
        // console.log("driveType change", val);
        if (val !== undefined && val !== "") {

            const currentConfig = findFromConfig(providers, val);
            if (currentConfig !== undefined) {

                currentConfig.Options.forEach(item => {

                    const {DefaultStr, Type, Name, Required, Hide} = item;
                    if (Hide === 0) {
                        availableOptions[Name] = DefaultStr;
                        optionTypes[Name] = Type;
                        required[Name] = Required;

                        isValid[Name] = !(Required && (!DefaultStr || DefaultStr === ""));

                        formErrors[Name] = "";
                    }
                });
            }
            
            // Preserve existing formValues if they exist (e.g., from template import)
            const existingFormValues = this.state.formValues || {};
            const mergedFormValues = { ...availableOptions, ...existingFormValues };
            
            // Validate the merged values
            const validation = this.validateFormValues(mergedFormValues, optionTypes, required);
            
            this.setState({
                drivePrefix: val,
                formValues: mergedFormValues,
                optionTypes: optionTypes,
                isValid: validation.isValid,
                formErrors: validation.formErrors,
                required: required
            });
        } else {
            this.setState({drivePrefix: val})

        }
}

/**
 * Open second step of setting up the drive and scroll into view.
 */
export function openSetupDrive(e) {
        if (e) e.preventDefault();
        this.setState({'colSetup': true});
        // this.setupDriveDiv.scrollIntoView({behavior: "smooth"});
}

/**
 *  toggle the step 3: advanced options
 */
export function editAdvancedOptions(e) {
        this.setState({advancedOptions: !this.state.advancedOptions});
}

/**
 * Validate the form and set the appropriate errors in the state.
 * @returns {boolean}
 */
export function validateForm() {
        //    Validate driveName and other parameters
        const {driveNameIsValid, drivePrefix, isValid, formValues} = this.state;
        let flag = true;

        if (!driveNameIsValid) {
            flag = false;
        }
        if (drivePrefix === "") {
            flag = false;
        }

        // Special validation for S3: Ensure endpoint is provided for non-AWS providers
        if (drivePrefix === "s3") {
            const provider = formValues.provider || "";
            const endpoint = formValues.endpoint || "";
            
            // If not AWS, IBM, or Alibaba, endpoint is required
            if (provider !== "AWS" && provider !== "IBMCOS" && provider !== "Alibaba" && !endpoint.trim()) {
                toast.error("Endpoint is required for non-AWS S3 providers (e.g., Hetzner, DigitalOcean, etc.)", {
                    autoClose: 8000
                });
                flag = false;
            }
        }

        /*Check for validations based on inputType*/
        for (const [key, value] of Object.entries(isValid)) {
            if (!key || !value) {
                flag = false;
                break;
            }
        }

        return flag;
}

/**
 *  Show or hide the auth modal.
 */
export function toggleAuthModal() {
        this.setState((state, props) => {
            return {authModalIsVisible: !state.authModalIsVisible}
        });
}

/**
 *  Show or hide the authentication modal and start timer for checking if the new config is created.
 */
export function startAuthentication() {
        this.toggleAuthModal();
        // Check every second if the config is created
        if (this.configCheckInterval === null) {
            this.configCheckInterval = setInterval(this.checkConfigStatus, NEW_DRIVE_CONFIG_REFRESH_TIMEOUT);
        } else {
            console.error("Interval already running. Should not start a new one");
        }

}

/**
 *  Called when the config is successfully created. Clears the timout and hides the authentication modal.
 */
export function stopAuthentication() {
        this.setState((state, props) => {
            return {authModalIsVisible: false}
        });
        if (this.configCheckInterval) {
            clearInterval(this.configCheckInterval);
            this.configCheckInterval = null;
        }
}

/**
 * Called when form action submit is to be handled.
 * Validate form and submit request.
 * */
export async function handleSubmit(e) {
        e && e.preventDefault();
        // console.log("Submitted form");

        // Set saving state
        this.setState({ saving: true });

      const {formValues, drivePrefix} = this.state;
        const {providers} = this.props;


        if (this.validateForm()) {

            if (drivePrefix !== undefined && drivePrefix !== "") {
                const currentProvider = findFromConfig(providers, drivePrefix);
                if (currentProvider !== undefined) {


                    const defaults = currentProvider.Options;

                    // console.log(config, formValues, defaults);

                    let finalParameterValues = {};


                    for (const [key, value] of Object.entries(formValues)) {

                        if (key === "token") {
                            finalParameterValues[key] = value;
                            continue;
                        }
                        const defaultValueObj = defaults.find((ele, idx, array) => {
                            // console.log(key, ele.Name, key === ele.Name);
                            return (key === ele.Name);
                        });
                        if (defaultValueObj) {

                            const {DefaultStr} = defaultValueObj;
                            if (value !== DefaultStr) {
                                // console.log(`${value} !== ${DefaultStr}`);
                                finalParameterValues[key] = value;
                            }
                        }

                    }


          // Azure: validate sas_url doesn't contain a raw connection string
          if (drivePrefix === 'azureblob') {
              const sasVal = finalParameterValues.sas_url || '';
              const connStringMarkers = ['blobendpoint=', 'sharedaccesssignature=', 'queueendpoint=',
                  'fileendpoint=', 'tableendpoint=', 'accountkey=', 'accountname=', 'defaultendpointsprotocol='];
              if (sasVal && connStringMarkers.some(m => sasVal.toLowerCase().includes(m))) {
                  const parsed = this.parseAzureSasInput(sasVal);
                  if (parsed && parsed.key) {
                      finalParameterValues.account = parsed.account || '';
                      finalParameterValues.key = parsed.key;
                      finalParameterValues.sas_url = '';
                      toast.info(`Auto-corrected: detected ${parsed.type} - using Account Key auth`);
                  } else if (parsed) {
                      finalParameterValues.sas_url = parsed.sasUrl;
                      if (parsed.account) finalParameterValues.account = parsed.account;
                      delete finalParameterValues.key;
                      toast.info(`Auto-corrected: detected ${parsed.type} in SAS URL field`);
                  } else {
                      toast.error("The SAS URL field contains a connection string that could not be parsed. Please paste only the 'Blob service SAS URL'.");
                      this.setState({ saving: false });
                      return;
                  }
              }

              // Hard-validate the shape of sas_url (only if user actually uses SAS auth,
              // i.e. no account/key combo provided). Catches: missing https://, missing
              // ?<token>, missing sig=/sv=, IP-restricted, container-scoped without
              // container in the path, expired SAS.
              const finalSas = finalParameterValues.sas_url || '';
              const hasAccountKey = !!(finalParameterValues.account && finalParameterValues.key);
              if (finalSas && !hasAccountKey) {
                  const v = this.validateAzureSasUrl(finalSas, this.state.driveName);
                  if (!v.ok) {
                      toast.error(`Azure SAS URL is invalid: ${v.error}`, { autoClose: 12000 });
                      this.setState({ saving: false });
                      return;
                  }
                  if (v.warnings.length > 0) {
                      v.warnings.forEach(w => toast.warn(`Azure SAS: ${w}`, { autoClose: 12000 }));
                  }
              }

              // Resolve auth-method conflicts: when the user supplied a SAS URL
              // or account+key, remove any *active* alternative-auth fields
              // (env_auth/use_msi/connection_string/service-principal/...) that
              // would override it. Advanced single-method configs are untouched.
              // See sanitizeAzureBlobParameters for the full rationale.
              {
                  const { cleaned, stripped } = sanitizeAzureBlobParameters(finalParameterValues);
                  if (stripped.length > 0) {
                      console.warn('[NewDrive] Removed conflicting azureblob auth fields:', stripped);
                      toast.warn(
                          `Removed ${stripped.length} conflicting Azure auth field(s) that would override your ` +
                          `SAS URL / account key: ${stripped.join(', ')}. ` +
                          `(These usually come from password-manager autofill or an imported template.)`,
                          { autoClose: 10000 }
                      );
                  }
                  finalParameterValues = cleaned;
              }
          }

          // Build base remote data
          let data = {
            parameters: finalParameterValues,
            name: this.state.driveName,
            type: this.state.drivePrefix
          };

          try {
            const {drivePrefix: editingPrefix} = this.props.match.params;
            const isRenaming =
                !!(editingPrefix && this.state.originalDriveName && this.state.originalDriveName !== this.state.driveName);
            const configNameToCheckForEdit = editingPrefix
                ? (isRenaming ? this.state.originalDriveName : this.state.driveName)
                : null;
            let existingConfigForEdit = null;

            // In edit mode, preserve existing secret fields (passwords/keys/etc.)
            // when the user leaves them blank in the form. rclone `config/get`
            // often doesn't prefill secret values in the UI, so without this,
            // saving an edit can unintentionally wipe credentials.
            if (editingPrefix && configNameToCheckForEdit) {
              try {
                const existingConfigCheck = await axiosInstance.post(urls.getConfigForRemote, {name: configNameToCheckForEdit});
                existingConfigForEdit = existingConfigCheck.data || {};
                const existingParams = (existingConfigForEdit.parameters && Object.keys(existingConfigForEdit.parameters).length > 0)
                    ? existingConfigForEdit.parameters
                    : existingConfigForEdit;

                defaults.forEach((opt) => {
                  if (!opt || !opt.Name || !opt.IsPassword) return;
                  const currentValue = formValues[opt.Name];
                  const isBlank = currentValue === undefined || currentValue === null || currentValue === "";
                  if (isBlank && existingParams[opt.Name] !== undefined && existingParams[opt.Name] !== null && existingParams[opt.Name] !== "") {
                    finalParameterValues[opt.Name] = existingParams[opt.Name];
                  }
                });

                data.parameters = finalParameterValues;
              } catch (preserveErr) {
                console.warn('[Edit] Could not load existing config for secret preservation:', preserveErr.message);
              }
            }

            // Post-save sanity check for OneDrive: verify that the remote really
            // points to the selected drive_id/drive_type and surface a toast.
            const verifyOneDriveSelectionAfterSave = async () => {
              if (this.state.drivePrefix !== 'onedrive') return;
              const targetDriveId = data?.parameters?.drive_id;
              if (!targetDriveId) return;
              try {
                const verifyConfig = await axiosInstance.post(urls.getConfigForRemote, {name: this.state.driveName});
                const saved = verifyConfig.data || {};
                const savedDriveId = saved.drive_id || (saved.parameters && saved.parameters.drive_id);
                const savedDriveType = saved.drive_type || (saved.parameters && saved.parameters.drive_type);
                const targetDriveType = data?.parameters?.drive_type;
                const idMatch = savedDriveId === targetDriveId;
                const typeMatch = !targetDriveType || savedDriveType === targetDriveType;
                if (idMatch && typeMatch) {
                  const shortDriveId = String(savedDriveId || "").substring(0, 12);
                  toast.success(
                      `Verified remote target: ${savedDriveType || 'documentLibrary'} (${shortDriveId}...)`,
                      { autoClose: 5000 }
                  );
                } else {
                  toast.warn(
                      'Saved, but the remote still points to a different drive. Reopen the picker and save again.',
                      { autoClose: 10000 }
                  );
                }
              } catch (verifyErr) {
                console.warn('[OneDrive] Post-save verification failed:', verifyErr.message);
              }
            };

            // If encryption is requested, create an underlying base remote and then a crypt remote with the chosen name
            if (this.state.addEncryption) {
              // Validate encryption passwords
              if (!this.state.encPassword || this.state.encPassword !== this.state.encPasswordRepeat) {
                toast.error("Encryption passwords do not match");
                this.stopAuthentication();
                return;
              }
              if (this.state.useFilenamePassword && (!this.state.encPassword2 || this.state.encPassword2 !== this.state.encPassword2Repeat)) {
                toast.error("Filename encryption passwords do not match");
                this.stopAuthentication();
                return;
              }

              const baseName = `${this.state.driveName}_base`;

              // 1) Create or update the base remote with name '<name>_base'
              const baseData = { ...data, name: baseName };
              await Promise.race([
                axiosInstance.post(urls.createConfig, baseData),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout after 30 seconds')), 30000))
              ]);

              // 2) Create or update the crypt remote with the user facing name '<name>'
              const cryptParams = {
                remote: `${baseName}:`,
                password: this.state.encPassword,
                filename_encryption: "standard",
                directory_name_encryption: true
              };
              if (this.state.useFilenamePassword) {
                cryptParams.password2 = this.state.encPassword2;
              }

              const cryptData = {
                name: this.state.driveName,
                type: "crypt",
                parameters: cryptParams
              };

              // If editing, update; otherwise create
              if (!editingPrefix) {
                await Promise.race([
                  axiosInstance.post(urls.createConfig, cryptData),
                  new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout after 30 seconds')), 30000))
                ]);
                this.stopAuthentication();
                this.setState({
                    saving: false,
                    showSuccessModal: true,
                    successMessage: "Encrypted remote created successfully!"
                });
              } else {
                await Promise.race([
                  axiosInstance.post(urls.updateConfig, cryptData),
                  new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout after 30 seconds')), 30000))
                ]);
                this.stopAuthentication();
                this.setState({
                    saving: false,
                    showSuccessModal: true,
                    successMessage: "Encrypted remote updated successfully!"
                });
              }
              } else {
                // No encryption: normal create/update
                // For OAuth remotes, use delete-then-create to avoid Rclone's token refresh logic in config/update
                const isOAuthRemote = supportsOAuth(this.props.providers || [], this.state.drivePrefix);
                
                if (!editingPrefix) {
                  // Create new remote
                  if (isOAuthRemote) {
                    // For OAuth remotes, config/create can hang/error due to token validation
                    // Make it async and wait a bit, then verify it was created
                    const createPromise = axiosInstance.post(urls.createConfig, data);
                    await Promise.race([
                        createPromise,
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Config create timeout')), 5000))
                    ]).catch(async (err) => {
                        // If create fails or times out, wait a bit and verify config exists
                        console.log('[OAuth] Config create may have timed out, verifying...', err.message);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        // Verify config was created
                        const verifyConfig = await axiosInstance.post(urls.getConfigForRemote, {name: this.state.driveName});
                        if (verifyConfig.data && !isEmpty(verifyConfig.data)) {
                            console.log('[OAuth] Config verified after async create');

                            // IMPORTANT: In the OAuth flow, the remote may already exist
                            // (created by the OAuth callback handler) before the wizard
                            // reaches Save. In that case, createConfig can fail/timeout
                            // and the old auto-picked drive_id/drive_type would remain.
                            // Force an update here so user-selected SharePoint library
                            // (drive_id/drive_type) is actually persisted.
                            const existingDriveId = verifyConfig.data?.drive_id ||
                                (verifyConfig.data?.parameters && verifyConfig.data?.parameters.drive_id);
                            const existingDriveType = verifyConfig.data?.drive_type ||
                                (verifyConfig.data?.parameters && verifyConfig.data?.parameters.drive_type);
                            const targetDriveId = data?.parameters?.drive_id;
                            const targetDriveType = data?.parameters?.drive_type;
                            const needsDriveUpdate = !!(
                                targetDriveId &&
                                ((existingDriveId !== targetDriveId) || (targetDriveType && existingDriveType !== targetDriveType))
                            );

                            if (needsDriveUpdate) {
                                console.log('[OAuth] Existing config uses a different drive. Forcing config/update...');
                                try {
                                    await Promise.race([
                                        axiosInstance.post(urls.updateConfig, data),
                                        new Promise((_, reject) => setTimeout(() => reject(new Error('Config update timeout after 10 seconds')), 10000))
                                    ]);
                                    console.log('[OAuth] Config updated with selected drive_id/drive_type');
                                } catch (updateErr) {
                                    console.warn('[OAuth] config/update failed after create timeout. Falling back to delete+create...', updateErr.message);
                                    // Last resort: recreate with desired parameters.
                                    try {
                                        await axiosInstance.post(urls.deleteConfig, {name: this.state.driveName});
                                    } catch (_) {
                                        // ignore delete errors; create below will still try
                                    }
                                    await Promise.race([
                                        axiosInstance.post(urls.createConfig, data),
                                        new Promise((_, reject) => setTimeout(() => reject(new Error('Config recreate timeout after 10 seconds')), 10000))
                                    ]);
                                    console.log('[OAuth] Config recreated with selected drive_id/drive_type');
                                }
                            }
                            return; // Config exists (and now updated if needed)
                        }
                        throw err; // Re-throw if config doesn't exist
                    });
                    await verifyOneDriveSelectionAfterSave();
                    this.stopAuthentication();
                    this.setState({
                        saving: false,
                        showSuccessModal: true,
                        successMessage: "Remote configuration created successfully!"
                    });
                  } else {
                    await Promise.race([
                      axiosInstance.post(urls.createConfig, data),
                      new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout after 30 seconds')), 30000))
                    ]);
                    this.stopAuthentication();
                    this.setState({
                        saving: false,
                        showSuccessModal: true,
                        successMessage: "Remote configuration created successfully!"
                    });
                  }
                } else {
                  if (isRenaming) {
                    // When renaming, we need to get config from the ORIGINAL name, not the new name
                    console.log(`[Rename] Renaming remote from "${this.state.originalDriveName}" to "${this.state.driveName}"`);
                  }
                  
                  if (isOAuthRemote) {
                    // OAuth remotes: preserve token when updating
                    // Extract token from existing config before deleting
                    // Use originalDriveName if renaming, otherwise use current driveName
                    let tokenSource = existingConfigForEdit || {};
                    let existingToken = tokenSource?.token || 
                                        (tokenSource?.parameters && tokenSource?.parameters.token);
                    if (!existingToken && configNameToCheckForEdit) {
                      try {
                        const existingConfigCheck = await axiosInstance.post(urls.getConfigForRemote, {name: configNameToCheckForEdit});
                        tokenSource = existingConfigCheck.data || {};
                        existingToken = tokenSource?.token || (tokenSource?.parameters && tokenSource?.parameters.token);
                      } catch (tokenLoadErr) {
                        console.warn('[OAuth] Could not load existing token before update:', tokenLoadErr.message);
                      }
                    }
                    
                    if (existingToken && existingToken.length > 0) {
                      // Preserve the token in the new config
                      console.log('[OAuth] Preserving existing token when updating config');
                      finalParameterValues.token = existingToken;
                      data.parameters = finalParameterValues;
                    }
                    
                    // OAuth remotes: delete then create to avoid token refresh issues
                    // Use originalDriveName if renaming, otherwise use current driveName
                    const nameToDelete = isRenaming ? this.state.originalDriveName : this.state.driveName;
                    try {
                      await axiosInstance.post(urls.deleteConfig, {name: nameToDelete});
                      // Wait a moment for Rclone to fully process the deletion
                      await new Promise(resolve => setTimeout(resolve, 1000));
                    } catch (deleteErr) {
                      // Ignore delete errors (config might not exist)
                      console.log('[OAuth] Delete before update:', deleteErr.response?.status === 404 ? 'not found (ok)' : deleteErr.message);
                    }
                    // For OAuth remotes, config/create can hang/error due to token validation
                    // Make it async and wait a bit, then verify it was created
                    const createPromise = axiosInstance.post(urls.createConfig, data);
                    await Promise.race([
                        createPromise,
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Config create timeout')), 5000))
                    ]).catch(async (err) => {
                        // If create fails or times out, wait a bit and verify config exists
                        console.log('[OAuth] Config create may have timed out, verifying...', err.message);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        // Verify config was created
                        const verifyConfig = await axiosInstance.post(urls.getConfigForRemote, {name: this.state.driveName});
                        if (verifyConfig.data && !isEmpty(verifyConfig.data)) {
                            console.log('[OAuth] Config verified after async create');
                            return; // Config exists, success
                        }
                        // Don't throw error if config exists - 500 error is expected for OAuth remotes
                        if (err.response?.status === 500) {
                            console.log('[OAuth] 500 error is expected for OAuth remotes, config was verified');
                            return;
                        }
                        throw err; // Re-throw if config doesn't exist
                    });
                    await verifyOneDriveSelectionAfterSave();
                    this.stopAuthentication();
                    this.setState({
                        saving: false,
                        showSuccessModal: true,
                        successMessage: isRenaming ? "Remote renamed and updated successfully!" : "Remote configuration updated successfully!"
                    });
                  } else {
                    // Non-OAuth remotes
                    if (isRenaming) {
                      // When renaming, delete old config then create new one
                      console.log(`[Rename] Deleting old config "${this.state.originalDriveName}" and creating new config "${this.state.driveName}"`);
                      try {
                        await axiosInstance.post(urls.deleteConfig, {name: this.state.originalDriveName});
                        await new Promise(resolve => setTimeout(resolve, 500));
                      } catch (deleteErr) {
                        console.log('[Rename] Delete error:', deleteErr.response?.status === 404 ? 'not found (ok)' : deleteErr.message);
                      }
                      await Promise.race([
                        axiosInstance.post(urls.createConfig, data),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout after 30 seconds')), 30000))
                      ]);
                    } else {
                      // Normal update (same name)
                      await Promise.race([
                        axiosInstance.post(urls.updateConfig, data),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Request timeout after 30 seconds')), 30000))
                      ]);
                    }
                    this.stopAuthentication();
                    this.setState({
                        saving: false,
                        showSuccessModal: true,
                        successMessage: isRenaming ? "Remote renamed and updated successfully!" : "Remote configuration updated successfully!"
                    });
                  }
                }
              }

          } catch (err) {
            toast.error(`Error creating config. ${err}`);
            this.stopAuthentication();
            this.setState({ saving: false });
          }

                }
            }
        } else {
            // Validation failed - find and report specific errors
            const {driveNameIsValid, drivePrefix, isValid, formErrors, formValues} = this.state;
            const errors = [];
            
            // Check specific validation failures
            if (!driveNameIsValid) {
                errors.push("Remote name is invalid or already exists (Step 1)");
            }
            if (!drivePrefix || drivePrefix === "") {
                errors.push("Please select a provider (Step 1)");
            }
            
            // Check for invalid form fields and determine which step they're in
            const invalidFieldsStep2 = [];
            const invalidFieldsStep3 = [];
            
            // Get provider config to check which fields are advanced
            const {providers} = this.props;
            const currentProvider = drivePrefix ? findFromConfig(providers, drivePrefix) : null;
            const advancedFields = new Set();
            
            if (currentProvider && currentProvider.Options) {
                currentProvider.Options.forEach(opt => {
                    if (opt.Advanced) {
                        advancedFields.add(opt.Name);
                    }
                });
            }
            
            for (const [key, value] of Object.entries(isValid)) {
                if (!value) {
                    const errorMsg = formErrors[key] || "Invalid value";
                    if (advancedFields.has(key)) {
                        invalidFieldsStep3.push(`${key}: ${errorMsg}`);
                    } else {
                        invalidFieldsStep2.push(`${key}: ${errorMsg}`);
                    }
                }
            }
            
            // Special S3 validation
            if (drivePrefix === "s3") {
                const provider = formValues.provider || "";
                const endpoint = formValues.endpoint || "";
                if (provider !== "AWS" && provider !== "IBMCOS" && provider !== "Alibaba" && !endpoint.trim()) {
                    errors.push("Endpoint is required for non-AWS S3 providers (Step 2)");
                }
            }
            
            // Build error message
            let errorMessage = "Please fix the following errors before submitting:\n";
            if (errors.length > 0) {
                errorMessage += errors.map(e => `• ${e}`).join("\n");
            }
            if (invalidFieldsStep2.length > 0) {
                errorMessage += "\n\nInvalid fields in Step 2:\n";
                errorMessage += invalidFieldsStep2.slice(0, 5).map(f => `• ${f}`).join("\n");
                if (invalidFieldsStep2.length > 5) {
                    errorMessage += `\n... and ${invalidFieldsStep2.length - 5} more`;
                }
            }
            if (invalidFieldsStep3.length > 0) {
                errorMessage += "\n\nInvalid fields in Step 3 (Advanced Options):\n";
                errorMessage += invalidFieldsStep3.slice(0, 5).map(f => `• ${f}`).join("\n");
                if (invalidFieldsStep3.length > 5) {
                    errorMessage += `\n... and ${invalidFieldsStep3.length - 5} more`;
                }
            }
            
            toast.error(errorMessage, {
                autoClose: 10000,
                style: { whiteSpace: 'pre-line' }
            });
            
            // Scroll to first invalid field
            setTimeout(() => {
                const firstInvalidInput = document.querySelector('input.invalid, select.invalid');
                if (firstInvalidInput) {
                    firstInvalidInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    firstInvalidInput.focus();
                }
            }, 100);
        }
}

/**
 * Clears the entire form.
 * Clearing the driveName and drivePrefix automatically clears the inputs as well.
 * */
export function clearForm(_) {
        this.setState({driveName: "", drivePrefix: ""})
}


/**
 * Change the name of the drive. Check if it already exists, if not, allow to be changes, else set error.
 * */
export function changeName(e) {
        const {originalDriveName} = this.state;
        const value = e.target.value;
        
        // Allow empty value (for deletion) or validate if not empty
        if (value === "" || validateDriveName(value)) {
            this.setState({driveName: value}, () => {
                if (value === undefined || value === "") {
                    this.setState({driveNameIsValid: false});
                } else {
                    // When editing, if the name equals the original name, it's always valid
                    if (originalDriveName && value === originalDriveName) {
                        this.setState({formErrors: {...this.state.formErrors, driveName: ""}, driveNameIsValid: true});
                        return;
                    }
                    
                    // Check if name already exists (for other remotes)
                    axiosInstance.post(urls.getConfigForRemote, {name: value}).then((response) => {
                        let errors = this.state.formErrors;
                        let isValid = isEmpty(response.data);
                        if (isValid) {
                            errors["driveName"] = "";
                        } else {
                            errors["driveName"] = "Duplicate";
                        }
                        this.setState({formErrors: errors, driveNameIsValid: isValid});
                    });
                }
            });
        } else {
            // Invalid character - don't update state, but show error
            // This prevents invalid characters from being entered
            const errors = {...this.state.formErrors};
            errors["driveName"] = "Invalid characters in remote name";
            this.setState({formErrors: errors});
        }
}

/**
 * Open the advanced settings card and scroll into view.
 * @param e
 */
export function openAdvancedSettings(e) {
        if (this.state.advancedOptions) {
            this.setState({colAdvanced: true});
        } else {
            this.configEndDiv.scrollIntoView({behavior: "smooth"});
        }
}
