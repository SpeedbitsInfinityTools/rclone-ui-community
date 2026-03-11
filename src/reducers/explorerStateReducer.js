import {
	CHANGE_GRID_MODE,
	CHANGE_LOAD_IMAGES,
	CHANGE_PATH,
	CHANGE_REMOTE_NAME,
	CHANGE_REMOTE_PATH,
	CHANGE_SEARCH_QUERY,
	CHANGE_SORT_FILTER,
	CHANGE_VISIBILITY_FILTER,
	CREATE_PATH,
	NAVIGATE_BACK,
	NAVIGATE_FWD,
	NAVIGATE_UP,
	REMOVE_PATH
} from "../actions/types";
import BackStack from "../utils/classes/BackStack";

const initialState = {
    backStacks: {},
    currentPaths: {},
    visibilityFilters: {},
    gridMode: {},
    searchQueries: {},
    loadImages: {},
    sortFilters: {},
    sortFiltersAscending: {}
};

/**
 * Specifies the reducers for explorer state manipulation.
 * @param state {$ObjMap}
 * @param action {$ObjMap}
 * @returns {{currentPaths: {}, visibilityFilters: {}, gridMode: {}, searchQueries: {}, backStacks: {}}|({currentPaths, visibilityFilters, gridMode, searchQueries, backStacks}&{currentPaths: (initialState.currentPaths|{}), visibilityFilters: (initialState.visibilityFilters|{}), gridMode: (initialState.gridMode|{}), searchQueries: (initialState.searchQueries|{}), backStacks: (initialState.backStacks|{})})}
 */
function explorerStateReducer(state = initialState, action) {

    const id = action.id;
    if (id) {

        let backStack = state.backStacks[id];
        if (!backStack || !(backStack instanceof BackStack)) {


            if (!(backStack instanceof BackStack)) {
                // Redux dosen't store the internal functions of class objects when serialized. So as a work around,
                // if the backstack is not an instance of backStack, i.e. its methods are missing,
                // create a new backstack with current data
                backStack = new BackStack(backStack)
            } else {
                backStack = new BackStack();
            }
        }

        let remoteName = action.remoteName;
        let remotePath = action.remotePath;

		if (!remoteName) remoteName = "";
		if (!remotePath) remotePath = "";
		const data = {
			remoteName: remoteName,
			remotePath: remotePath
		};

		let visibilityFilter = state.visibilityFilters[id];
		let gridMode = state.gridMode[id];
		if (!gridMode) gridMode = "list";
		let searchQuery = "";
		let loadImages = state.loadImages[id];
		if (!loadImages) loadImages = false;

		let sortFilterAscending = state.sortFiltersAscending[id];
		if (!sortFilterAscending) sortFilterAscending = true;
		let sortFilter = state.sortFilters[id];
		if (!sortFilter) sortFilter = "name";

		switch (action.type) {
            case CHANGE_PATH:
                backStack.push(data);
                break;

            case CHANGE_REMOTE_NAME:
                if (remoteName.indexOf('/') === 0) {/*The name starts with a /: local Name*/
                    remotePath = remoteName;
                    remoteName = "/";

                } else {
                    remotePath = "";
                }
                backStack.empty();
                backStack.push({remoteName: remoteName, remotePath: remotePath});
                // ptr++;

                break;

            case CHANGE_REMOTE_PATH:
				backStack.push({remoteName: backStack.peek().remoteName, remotePath: remotePath});
				// ptr++;

				break;

			case CREATE_PATH:
				if (!backStack || !(backStack instanceof BackStack))
					backStack = new BackStack();
				break;
			case REMOVE_PATH:
				return {
					...state,
					backStacks: {...state.backStacks, [id]: undefined},
					currentPaths: {...state.currentPaths, [id]: undefined},
					visibilityFilters: {...state.visibilityFilters, [id]: undefined},
					gridMode: {...state.gridMode, [id]: undefined},
					searchQueries: {...state.searchQueries, [id]: undefined},
					loadImages: {...state.loadImages, [id]: undefined},
					sortFilters: {...state.sortFilters, [id]: undefined},
					sortFiltersAscending: {...state.sortFiltersAscending, [id]: undefined},
				};
			// break;
	case NAVIGATE_UP:
		// Navigate one directory up
		let current = {...backStack.peek()}; // Create a copy

		// Check if we're in a bucket (remoteName contains the bucket, remotePath is empty)
		// Format: "remotename:bucketname" with remotePath = ""
		if (current.remotePath === "" || !current.remotePath) {
			// Check if remoteName has a bucket appended (contains colon)
			const colonIndex = current.remoteName.indexOf(':');
			if (colonIndex > 0 && colonIndex < current.remoteName.length - 1) {
				// There's a bucket name after the colon - go back to just the remote
				current.remoteName = current.remoteName.substring(0, colonIndex);
			}
		} else if (current.remotePath === "/" || current.remotePath === "~") {
			// At filesystem root or home, can't go further up - do nothing
		} else {
			// We have a remotePath - navigate to parent directory
			let path = current.remotePath;
			
			// Remove trailing slash if present
			if (path.endsWith('/') && path.length > 1) {
				path = path.slice(0, -1);
			}

			// Split by '/' and remove the last segment
			const pathSegments = path.split('/');
			pathSegments.pop(); // Remove last directory

			// Reconstruct the path
			if (pathSegments.length === 0 || (pathSegments.length === 1 && !pathSegments[0])) {
				// Going to root/remote root
				if (path.startsWith('/')) {
					current.remotePath = "/"; // Absolute path (local) - go to /
				} else {
					current.remotePath = ""; // Relative path (S3/cloud) - go to remote root
				}
			} else {
				current.remotePath = pathSegments.join('/');
				// For absolute paths, ensure leading slash
				if (path.startsWith('/') && !current.remotePath.startsWith('/')) {
					current.remotePath = '/' + current.remotePath;
				}
			}
		}
        backStack.push(current);
		break;

            case NAVIGATE_FWD:
                backStack.moveForward();
				break;

            case NAVIGATE_BACK:
                backStack.moveBack();
				break;
            case CHANGE_VISIBILITY_FILTER:
				if (action.filter)
					visibilityFilter = action.filter;
				else
					visibilityFilter = "";
                break;
            case CHANGE_GRID_MODE:
                if (action.mode) {
                    gridMode = action.mode;
                }
                break;

            case CHANGE_SEARCH_QUERY:
                searchQuery = action.searchQuery;
                break;

            case CHANGE_LOAD_IMAGES:
                loadImages = action.payload;
                break;
            case CHANGE_SORT_FILTER:
                sortFilter = action.payload.sortFilter;
                sortFilterAscending =  action.payload.sortFilterAscending;
                break;
            default:
                break;
        }
        return {
            ...state,
            backStacks: {...state.backStacks, [id]: backStack},
            currentPaths: {...state.currentPaths, [id]: {...backStack.peek()}},
            visibilityFilters: {...state.visibilityFilters, [id]: visibilityFilter},
            gridMode: {...state.gridMode, [id]: gridMode},
            searchQueries: {...state.searchQueries, [id]: searchQuery},
            loadImages: {...state.loadImages, [id]: loadImages},
            sortFilters: {...state.sortFilters, [id]: sortFilter},
            sortFiltersAscending: {...state.sortFiltersAscending, [id]: sortFilterAscending},
        };
    } else {
        // console.error("ID is unexpectedly null");
        return state;
    }


}

export default explorerStateReducer;
