import Autosuggest from 'react-autosuggest';
import React from "react";
import PropTypes from "prop-types";

// Teach Autosuggest how to calculate suggestions for any given input value.
const getSuggestions = (config, value) => {
    const inputValue = value.trim().toLowerCase();
    const inputLength = inputValue.length;

    // Show all suggestions when input is empty
    if (inputLength === 0) {
        return config;
    }

    // Filter suggestions based on input (use includes for more flexible matching)
    return config.filter(lang =>
        lang.toLowerCase().includes(inputValue)
    );
};

// When suggestion is clicked, Autosuggest needs to populate the input
// based on the clicked suggestion. Teach Autosuggest how to calculate the
// input value for every given suggestion.
const getSuggestionValue = suggestion => suggestion;

// Use your imagination to render suggestions.
const renderSuggestion = suggestion => (
    <div>
        <i className="fa fa-lg fa-hdd-o"/> {suggestion}
    </div>
);

class RemoteListAutoSuggest extends React.Component {
    constructor(props) {
        super(props);

        // Autosuggest is a controlled component.
        // This means that you need to provide an input value
        // and an onChange handler that updates this value (see below).
        // Suggestions also need to be provided to the Autosuggest,
        // and they are initially empty because the Autosuggest is closed.
        this.state = {
            suggestions: []
        };
    }


    // Autosuggest will call this function every time you need to update suggestions.
    // You already implemented this logic above, so just use it.
    onSuggestionsFetchRequested = ({value}) => {
        this.setState({
            suggestions: getSuggestions(this.props.suggestions, value)
        });
    };

    // Autosuggest will call this function every time you need to clear suggestions.
    onSuggestionsClearRequested = () => {
        this.setState({
            suggestions: []
        });
    };

    // Handler for when input is focused - show all suggestions
    handleFocus = () => {
        this.setState({
            suggestions: getSuggestions(this.props.suggestions, this.props.value)
        });
    };

    // Handler for when a suggestion is selected (clicked)
    onSuggestionSelected = (event, { suggestion }) => {
        // Trigger the onChange handler with the selected suggestion
        this.props.onChange(event, { newValue: suggestion });
    };

    render() {
        const {value, onChange, alwaysRenderSuggestions = false} = this.props;


        // Autosuggest will pass through all these props to the input.
        const inputProps = {
            placeholder: 'Click to select or type to filter',
            value: value,
            onChange: onChange,
            onFocus: this.handleFocus
        };

        // Finally, render it!
        return (
            <Autosuggest
                suggestions={this.state.suggestions}
                onSuggestionsFetchRequested={this.onSuggestionsFetchRequested}
                onSuggestionsClearRequested={this.onSuggestionsClearRequested}
                onSuggestionSelected={this.onSuggestionSelected}
                getSuggestionValue={getSuggestionValue}
                renderSuggestion={renderSuggestion}
                alwaysRenderSuggestions={alwaysRenderSuggestions}
                shouldRenderSuggestions={() => true}
                highlightFirstSuggestion={true}
                inputProps={inputProps}
                style={{width:"100%"}}
            />
        );
    }
}

RemoteListAutoSuggest.propTypes = {
    value: PropTypes.string.isRequired,
    onChange: PropTypes.func.isRequired,
    suggestions: PropTypes.array.isRequired,
    alwaysRenderSuggestions: PropTypes.bool
};

export default RemoteListAutoSuggest;