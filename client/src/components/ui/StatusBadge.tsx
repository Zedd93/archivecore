import { useTranslation } from 'react-i18next';
import { BOX_STATUS_COLORS, ORDER_STATUS_COLORS } from '@archivecore/shared';

interface StatusBadgeProps {
  status: string;
  type?: 'box' | 'order' | 'employment' | 'priority' | 'disposal' | 'transferList';
}

const colorMap: Record<string, string> = {
  green: 'bg-green-100 text-green-800',
  blue: 'bg-blue-100 text-blue-800',
  red: 'bg-red-100 text-red-800',
  yellow: 'bg-yellow-100 text-yellow-800',
  orange: 'bg-orange-100 text-orange-800',
  gray: 'bg-gray-100 text-gray-800',
  purple: 'bg-purple-100 text-purple-800',
  indigo: 'bg-indigo-100 text-indigo-800',
};

const EMPLOYMENT_COLORS: Record<string, string> = {
  active: 'green',
  terminated: 'red',
  retired: 'gray',
  deceased: 'gray',
};

const PRIORITY_COLORS: Record<string, string> = {
  normal: 'blue',
  high: 'orange',
  urgent: 'red',
};

const DISPOSAL_COLORS: Record<string, string> = {
  active: 'green',
  pending_review: 'orange',
  approved: 'blue',
  disposed: 'gray',
};

const TRANSFER_LIST_COLORS: Record<string, string> = {
  draft: 'gray',
  confirmed: 'green',
  archived: 'blue',
};

export default function StatusBadge({ status, type = 'box' }: StatusBadgeProps) {
  const { t } = useTranslation();

  const label = t(`statuses.${type}.${status}`, { defaultValue: status });

  let color = 'gray';
  switch (type) {
    case 'box':
      color = BOX_STATUS_COLORS[status] || 'gray';
      break;
    case 'order':
      color = ORDER_STATUS_COLORS[status] || 'gray';
      break;
    case 'employment':
      color = EMPLOYMENT_COLORS[status] || 'gray';
      break;
    case 'priority':
      color = PRIORITY_COLORS[status] || 'blue';
      break;
    case 'disposal':
      color = DISPOSAL_COLORS[status] || 'gray';
      break;
    case 'transferList':
      color = TRANSFER_LIST_COLORS[status] || 'gray';
      break;
  }

  const className = colorMap[color] || colorMap.gray;

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}
