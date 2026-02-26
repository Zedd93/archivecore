import {
  BOX_STATUS_LABELS, BOX_STATUS_COLORS,
  ORDER_STATUS_LABELS, ORDER_STATUS_COLORS,
  EMPLOYMENT_STATUS_LABELS, PRIORITY_LABELS,
} from '@archivecore/shared';

interface StatusBadgeProps {
  status: string;
  type?: 'box' | 'order' | 'employment' | 'priority';
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

export default function StatusBadge({ status, type = 'box' }: StatusBadgeProps) {
  let label = status;
  let color = 'gray';

  switch (type) {
    case 'box':
      label = BOX_STATUS_LABELS[status] || status;
      color = BOX_STATUS_COLORS[status] || 'gray';
      break;
    case 'order':
      label = ORDER_STATUS_LABELS[status] || status;
      color = ORDER_STATUS_COLORS[status] || 'gray';
      break;
    case 'employment':
      label = EMPLOYMENT_STATUS_LABELS[status] || status;
      color = status === 'active' ? 'green' : status === 'terminated' ? 'red' : 'gray';
      break;
    case 'priority':
      label = PRIORITY_LABELS[status] || status;
      color = status === 'urgent' ? 'red' : status === 'high' ? 'orange' : 'blue';
      break;
  }

  const className = colorMap[color] || colorMap.gray;

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}
