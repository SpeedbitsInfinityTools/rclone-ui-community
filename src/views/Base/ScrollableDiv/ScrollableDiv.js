import React from "react";

function ScrollableDiv({height, children, style}) {
    return (
        <div style={{overflow: "auto", height: height, ...style}}>
            {children}
        </div>)
}

export default ScrollableDiv;
