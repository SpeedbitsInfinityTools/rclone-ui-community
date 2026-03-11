import React from 'react';
import PropTypes from 'prop-types';
import {Modal, ModalHeader, ModalBody, ModalFooter, Button} from 'reactstrap';

/**
 * Reusable confirmation modal component
 * Replaces window.confirm() with a professional modal dialog
 */
class ConfirmModal extends React.Component {
    render() {
        const {
            isOpen,
            toggle,
            onConfirm,
            title,
            message,
            confirmText,
            cancelText,
            confirmColor,
            icon,
            isLoading
        } = this.props;

        const handleConfirm = () => {
            // If already loading, prevent multiple calls
            if (isLoading) {
                return;
            }
            
            // Call onConfirm - if it's async, don't auto-close
            // The handler should manage closing the modal via state
            const result = onConfirm();
            
            // Only auto-close for synchronous operations
            // For async operations, the handler should close the modal explicitly
            if (!isLoading && (!result || typeof result.then !== 'function')) {
                // Synchronous operation - close immediately
                toggle();
            }
            // For async operations, don't auto-close - let the handler manage it
        };

        return (
            <Modal isOpen={isOpen} toggle={toggle}>
                <ModalHeader toggle={toggle}>
                    {icon && <i className={`fa ${icon}`} style={{marginRight: '8px'}}></i>}
                    {title}
                </ModalHeader>
                <ModalBody>
                    {message}
                </ModalBody>
                <ModalFooter>
                    <Button 
                        color="secondary" 
                        onClick={toggle}
                        disabled={isLoading}>
                        {cancelText}
                    </Button>
                    <Button 
                        color={confirmColor} 
                        onClick={handleConfirm}
                        disabled={isLoading}>
                        {isLoading ? (
                            <><i className="fa fa-spinner fa-spin"></i> Processing...</>
                        ) : (
                            confirmText
                        )}
                    </Button>
                </ModalFooter>
            </Modal>
        );
    }
}

ConfirmModal.propTypes = {
    isOpen: PropTypes.bool.isRequired,
    toggle: PropTypes.func.isRequired,
    onConfirm: PropTypes.func.isRequired,
    title: PropTypes.string,
    message: PropTypes.oneOfType([PropTypes.string, PropTypes.node]),
    confirmText: PropTypes.string,
    cancelText: PropTypes.string,
    confirmColor: PropTypes.string,
    icon: PropTypes.string,
    isLoading: PropTypes.bool
};

ConfirmModal.defaultProps = {
    title: 'Confirm Action',
    message: 'Are you sure you want to proceed?',
    confirmText: 'Confirm',
    cancelText: 'Cancel',
    confirmColor: 'danger',
    icon: 'fa-exclamation-triangle',
    isLoading: false
};

export default ConfirmModal;

