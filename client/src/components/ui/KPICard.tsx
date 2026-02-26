import { ReactNode } from 'react';

interface KPICardProps {
  title: string;
  value: string | number;
  icon: ReactNode;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  color?: 'blue' | 'green' | 'red' | 'yellow' | 'purple';
}

const bgColors = {
  blue: 'bg-blue-50',
  green: 'bg-green-50',
  red: 'bg-red-50',
  yellow: 'bg-yellow-50',
  purple: 'bg-purple-50',
};

const iconColors = {
  blue: 'text-blue-600',
  green: 'text-green-600',
  red: 'text-red-600',
  yellow: 'text-yellow-600',
  purple: 'text-purple-600',
};

export default function KPICard({ title, value, icon, change, changeType = 'neutral', color = 'blue' }: KPICardProps) {
  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
          {change && (
            <p className={`text-xs mt-1 ${
              changeType === 'positive' ? 'text-green-600' :
              changeType === 'negative' ? 'text-red-600' : 'text-gray-500'
            }`}>
              {change}
            </p>
          )}
        </div>
        <div className={`p-3 rounded-xl ${bgColors[color]}`}>
          <div className={iconColors[color]}>{icon}</div>
        </div>
      </div>
    </div>
  );
}
