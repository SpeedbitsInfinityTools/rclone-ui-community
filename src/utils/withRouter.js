// Compatibility wrapper for React Router v6 to use with class components
import {useNavigate, useLocation, useParams} from 'react-router-dom';

export function withRouter(Component) {
    function ComponentWithRouterProp(props) {
        let location = useLocation();
        let navigate = useNavigate();
        let params = useParams();
        
        return (
            <Component
                {...props}
                router={{location, navigate, params}}
                history={{push: navigate, location}}
                location={location}
                match={{params}}
            />
        );
    }

    return ComponentWithRouterProp;
}

