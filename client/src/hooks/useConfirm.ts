import { useState, useCallback, createElement } from 'react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
}

export function useConfirm() {
  const [state, setState] = useState<{
    isOpen: boolean;
    options: ConfirmOptions;
    resolve: ((value: boolean) => void) | null;
  }>({
    isOpen: false,
    options: { title: '', message: '' },
    resolve: null,
  });

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ isOpen: true, options, resolve });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    state.resolve?.(true);
    setState((prev) => ({ ...prev, isOpen: false, resolve: null }));
  }, [state.resolve]);

  const handleCancel = useCallback(() => {
    state.resolve?.(false);
    setState((prev) => ({ ...prev, isOpen: false, resolve: null }));
  }, [state.resolve]);

  const ConfirmDialogElement = createElement(ConfirmDialog, {
    isOpen: state.isOpen,
    onConfirm: handleConfirm,
    onCancel: handleCancel,
    title: state.options.title,
    message: state.options.message,
    confirmLabel: state.options.confirmLabel,
    cancelLabel: state.options.cancelLabel,
    variant: state.options.variant,
  });

  return { confirm, ConfirmDialogElement };
}
