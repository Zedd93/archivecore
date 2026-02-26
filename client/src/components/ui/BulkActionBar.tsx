import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

interface BulkAction {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'danger' | 'secondary';
  disabled?: boolean;
  loading?: boolean;
}

interface BulkActionBarProps {
  count: number;
  actions: BulkAction[];
  onClearSelection: () => void;
}

const variantClasses: Record<string, string> = {
  primary: 'bg-primary-600 text-white hover:bg-primary-700',
  danger: 'bg-red-600 text-white hover:bg-red-700',
  secondary: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50',
};

export default function BulkActionBar({ count, actions, onClearSelection }: BulkActionBarProps) {
  const { t } = useTranslation();
  if (count === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-3 bg-gray-900 text-white rounded-xl shadow-2xl px-5 py-3">
        {/* Count */}
        <span className="text-sm font-medium whitespace-nowrap">
          {t('common.selected', { count })}
        </span>

        {/* Divider */}
        <div className="w-px h-6 bg-gray-600" />

        {/* Actions */}
        <div className="flex items-center gap-2">
          {actions.map((action, i) => (
            <button
              key={i}
              onClick={action.onClick}
              disabled={action.disabled || action.loading}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                variantClasses[action.variant || 'secondary']
              }`}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-gray-600" />

        {/* Clear */}
        <button
          onClick={onClearSelection}
          className="p-1.5 rounded-lg hover:bg-gray-700 transition-colors text-gray-400 hover:text-white"
          title={t('common.clearSelection')}
          aria-label={t('common.clearSelection')}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
