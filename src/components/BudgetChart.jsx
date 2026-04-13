import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { getCategoryLabel } from '../data/initialData';

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-sm" dir="rtl">
      <p className="font-semibold text-gray-800 mb-2">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="flex items-center gap-2 py-0.5">
          <span
            className="w-3 h-3 rounded-full inline-block"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-gray-600">{entry.name}:</span>
          <span className="font-semibold text-gray-800">
            {new Intl.NumberFormat('ar-SA').format(entry.value)} ر.س
          </span>
        </p>
      ))}
    </div>
  );
}

export default function BudgetChart({ items }) {
  // Aggregate by category
  const categoryMap = {};
  items.forEach((item) => {
    if (!categoryMap[item.category]) {
      categoryMap[item.category] = { budgeted: 0, actual: 0 };
    }
    categoryMap[item.category].budgeted += item.budgeted;
    categoryMap[item.category].actual += item.actual;
  });

  const chartData = Object.keys(categoryMap).map((catId) => ({
    name: getCategoryLabel(catId),
    'الميزانية': categoryMap[catId].budgeted,
    'الفعلي': categoryMap[catId].actual,
  }));

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mt-8">
      <h2 className="text-lg font-bold text-gray-800 mb-6">مقارنة الميزانية والتكلفة الفعلية</h2>

      <div className="w-full h-80" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 12, fill: '#6b7280' }}
              axisLine={{ stroke: '#d1d5db' }}
            />
            <YAxis
              tick={{ fontSize: 12, fill: '#6b7280' }}
              axisLine={{ stroke: '#d1d5db' }}
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: '13px', paddingTop: '16px' }}
            />
            <Bar dataKey="الميزانية" fill="#3b82f6" radius={[6, 6, 0, 0]} barSize={32} />
            <Bar dataKey="الفعلي" fill="#f59e0b" radius={[6, 6, 0, 0]} barSize={32} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
