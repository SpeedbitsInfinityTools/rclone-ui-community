import {GET_CONFIG_DUMP, GET_PROVIDERS, REMOVE_CONFIG_DUMP_ENTRY, REQUEST_ERROR, REQUEST_SUCCESS} from "../actions/types";

const initialState = {
    providers: [],
    configDump: {},
    hasError: false,
};
/**
 * Specifies redux reduce operations for the config module.
 * @param state {$ObjMap}
 * @param action {$ObjMap}
 * @returns {({hasError, providers, configDump}&{providers: *})|({hasError, providers, configDump}&{hasError: boolean, error: *})|({hasError, providers, configDump}&{hasError: boolean, configDump: *})|{hasError: boolean, providers: Array, configDump: {}}}
 */
function configReducer(state = initialState, action) {
    switch (action.type) {
        case GET_PROVIDERS:
            return {
                ...state,
                providers: action.payload,
            };

        case GET_CONFIG_DUMP:
            if (action.status === REQUEST_SUCCESS)
                return {
                    ...state,
                    configDump: action.payload,
                    hasError: false
                };
            if (action.status === REQUEST_ERROR)
                return {
                    ...state,
                    hasError: true,
                    error: action.payload
                };
            return state;

        case REMOVE_CONFIG_DUMP_ENTRY: {
            // Optimistic local removal so the row disappears immediately after
            // a successful config/delete, even if the follow-up config/dump
            // call hasn't returned yet (or transiently returns stale data
            // from rclone-rcd).
            const names = Array.isArray(action.payload) ? action.payload : [action.payload];
            const next = { ...state.configDump };
            let changed = false;
            for (const n of names) {
                if (n && Object.prototype.hasOwnProperty.call(next, n)) {
                    delete next[n];
                    changed = true;
                }
            }
            if (!changed) return state;
            return { ...state, configDump: next };
        }

        default:
            return state;
    }
}

export default configReducer;