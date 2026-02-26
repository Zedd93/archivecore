import { ReactNode } from 'react';
import { AlertTriangle, Trash2, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ConfirmDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: string | ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  isLoading?: boolean;
}

const variantConfig = {
  danger: {
    icon: Trash2,
    iconBg: 'bg-red-50',
    iconColor: 'text-red-500',
    confirmBtn: 'bg-red-600 hover:bg-red-700 text-white',
  },
  warning: {
    icon: AlertTriangle,
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-500',
    confirmBtn: 'bg-amber-600 hover:bg-amber-700 text-white',
  },
  info: {
    icon: Info,
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-500',
    confirmBtn: 'bg-blue-600 hover:bg-blue-700 text-white',
  },
};

export default function ConfirmDialog({
  isOpen,
  onConfirm,
  onCancel,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = 'danger',
  isLoading = false,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  if (!isOpen) return null;
  const resolvedConfirmLabel = confirmLabel || t('common.confirm');
  const resolvedCancelLabel = cancelLabel || t('common.cancel');

  const config = variantConfig[variant];
  const Icon = config.icon;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" role="alertdialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/50" onClick={isLoading ? undefined : onCancel} aria-hidden="true" />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
        <div className="flex gap-4">
          <div className={`shrink-0 w-12 h-12 rounded-full ${config.iconBg} flex items-center justify-center`}>
            <Icon className={config.iconColor} size={24} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">{title}</h3>
            <div className="text-sm text-gray-500">{message}</div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="btn-secondary"
          >
            {resolvedCancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${config.confirmBtn}`}
          >
            {isLoading ? t('common.processing') : resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
