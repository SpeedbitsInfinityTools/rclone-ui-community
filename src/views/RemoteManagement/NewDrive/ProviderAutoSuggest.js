import Autosuggest from 'react-autosuggest';
import React from "react";
import {findFromConfig} from "../../../utils/Tools";

// Teach Autosuggest how to calculate suggestions for any given input value.
const getSuggestions = (config, value) => {
    // Ensure value is a string (handle undefined/null)
    const safeValue = value || '';
    const inputValue = safeValue.trim().toLowerCase();
    const inputLength = inputValue.length;

    // If no input, show all providers
    if (inputLength === 0) {
        return config;
    }

    // Filter providers that match the input
    return config.filter(lang =>
        lang.Description.toLowerCase().includes(inputValue) ||
        lang.Prefix.toLowerCase().includes(inputValue)
    );
};

// When suggestion is clicked, Autosuggest needs to populate the input
// based on the clicked suggestion. Teach Autosuggest how to calculate the
// input value for every given suggestion.
const getSuggestionValue = suggestion => suggestion.Prefix;

// Use your imagination to render suggestions.
const renderSuggestion = suggestion => (
    <div>
        {suggestion.Description}
    </div>
);

class ProviderAutoSuggest extends React.Component {
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
        // console.log(value);
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


    handleClear = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.props.onClear) {
            this.props.onClear();
        }
    };

    handleFocus = (e) => {
        // When focused, show all suggestions
        this.setState({
            suggestions: this.props.suggestions
        });
    };

    render() {
        const {value, onChange, suggestions} = this.props;
        // Ensure value is always a string (handle undefined/null)
        const safeValue = value || '';
        const currentConfig = findFromConfig(suggestions, safeValue);
        let renderVal = "";
        if (currentConfig === undefined) {
            renderVal = safeValue;
        } else {
            renderVal = currentConfig.Description;
        }

        // Autosuggest will pass through all these props to the input.
        const inputProps = {
            placeholder: 'Type a provider type',
            value: renderVal,
            onChange: onChange,
            onFocus: this.handleFocus
        };

        // Finally, render it!
        return (
            <div style={{position: 'relative', display: 'inline-block', width: '100%'}}>
                <style>
                    {`
                        .react-autosuggest__input {
                            text-align: left !important;
                            direction: ltr !important;
                            padding-left: 8px !important;
                        }
                        .react-autosuggest__input:focus {
                            text-align: left !important;
                        }
                        .react-autosuggest__container {
                            text-align: left !important;
                        }
                    `}
                </style>
                <Autosuggest
                    suggestions={this.state.suggestions}
                    onSuggestionsFetchRequested={this.onSuggestionsFetchRequested}
                    onSuggestionsClearRequested={this.onSuggestionsClearRequested}
                    getSuggestionValue={getSuggestionValue}
                    renderSuggestion={renderSuggestion}
                    alwaysRenderSuggestions={false}
                    shouldRenderSuggestions={() => true}
                    highlightFirstSuggestion={true}
                    inputProps={inputProps}
                />
                {value && value !== "" && (
                    <button
                        type="button"
                        onClick={this.handleClear}
                        style={{
                            position: 'absolute',
                            right: '10px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            background: '#999',
                            border: 'none',
                            borderRadius: '50%',
                            color: '#fff',
                            fontSize: '16px',
                            cursor: 'pointer',
                            padding: '0',
                            width: '20px',
                            height: '20px',
                            lineHeight: '20px',
                            textAlign: 'center',
                            zIndex: 1000,
                            transition: 'background 0.2s'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = '#666'}
                        onMouseLeave={(e) => e.currentTarget.style.background = '#999'}
                        aria-label="Clear selection"
                    >
                        ×
                    </button>
                )}
            </div>
        );
    }
}

export default ProviderAutoSuggest;