import { TrendingUp, TrendingDown, Wallet, CircleDollarSign, Scale } from 'lucide-react';
import { formatCurrency } from '../data/initialData';

export default function SummaryCards({ totalBudgeted, totalActual, totalVariance }) {
  const isUnder = totalVariance > 0;
  const isOver = totalVariance < 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      {/* Total Budgeted */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
        <div className="flex items-center justify-between mb-4">
          <div className="bg-primary-50 text-primary-600 p-3 rounded-xl">
            <Wallet size={24} />
          </div>
        </div>
        <p className="text-sm text-gray-500 mb-1">إجمالي الميزانية المحددة</p>
        <p className="text-2xl font-bold text-gray-800">{formatCurrency(totalBudgeted)}</p>
      </div>

      {/* Total Actual */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
        <div className="flex items-center justify-between mb-4">
          <div className="bg-amber-50 text-amber-600 p-3 rounded-xl">
            <CircleDollarSign size={24} />
          </div>
        </div>
        <p className="text-sm text-gray-500 mb-1">إجمالي التكلفة الفعلية</p>
        <p className="text-2xl font-bold text-gray-800">{formatCurrency(totalActual)}</p>
      </div>

      {/* Total Variance */}
      <div
        className={`rounded-2xl shadow-sm border p-6 hover:shadow-md transition-shadow ${
          isOver
            ? 'bg-red-50 border-red-100'
            : isUnder
              ? 'bg-emerald-50 border-emerald-100'
              : 'bg-white border-gray-100'
        }`}
      >
        <div className="flex items-center justify-between mb-4">
          <div
            className={`p-3 rounded-xl ${
              isOver
                ? 'bg-red-100 text-red-600'
                : isUnder
                  ? 'bg-emerald-100 text-emerald-600'
                  : 'bg-gray-100 text-gray-600'
            }`}
          >
            {isOver ? <TrendingDown size={24} /> : isUnder ? <TrendingUp size={24} /> : <Scale size={24} />}
          </div>
        </div>
        <p className="text-sm text-gray-500 mb-1">إجمالي الانحراف</p>
        <p
          className={`text-2xl font-bold ${
            isOver ? 'text-red-700' : isUnder ? 'text-emerald-700' : 'text-gray-800'
          }`}
        >
          {formatCurrency(Math.abs(totalVariance))}
          <span className="text-sm font-normal mr-2">
            {isOver ? '(تجاوز الميزانية)' : isUnder ? '(أقل من الميزانية)' : '(مطابق)'}
          </span>
        </p>
      </div>
    </div>
  );
}
