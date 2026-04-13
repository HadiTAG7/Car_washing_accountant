import { Trash2, BookOpen, TrendingDown, CalendarDays } from 'lucide-react';
import {
  formatCurrency,
  calcAnnualDepreciation,
  calcBookValue,
} from '../data/initialData';

function DepreciationSummaryCard({ totalBookValue, totalPurchaseCost, assetCount }) {
  const totalDepreciated = totalPurchaseCost - totalBookValue;
  const depPercent = totalPurchaseCost > 0
    ? ((totalDepreciated / totalPurchaseCost) * 100).toFixed(1)
    : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      {/* Total Book Value */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
        <div className="flex items-center justify-between mb-4">
          <div className="bg-primary-50 text-primary-600 p-3 rounded-xl">
            <BookOpen size={24} />
          </div>
        </div>
        <p className="text-sm text-gray-500 mb-1">إجمالي القيمة الدفترية للأصول</p>
        <p className="text-2xl font-bold text-gray-800">{formatCurrency(totalBookValue)}</p>
      </div>

      {/* Total Accumulated Depreciation */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
        <div className="flex items-center justify-between mb-4">
          <div className="bg-amber-50 text-amber-600 p-3 rounded-xl">
            <TrendingDown size={24} />
          </div>
        </div>
        <p className="text-sm text-gray-500 mb-1">إجمالي الإهلاك المتراكم</p>
        <p className="text-2xl font-bold text-gray-800">
          {formatCurrency(totalDepreciated)}
          <span className="text-sm font-normal text-gray-400 mr-2">({depPercent}%)</span>
        </p>
      </div>

      {/* Asset Count */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 hover:shadow-md transition-shadow">
        <div className="flex items-center justify-between mb-4">
          <div className="bg-violet-50 text-violet-600 p-3 rounded-xl">
            <CalendarDays size={24} />
          </div>
        </div>
        <p className="text-sm text-gray-500 mb-1">عدد الأصول المسجلة</p>
        <p className="text-2xl font-bold text-gray-800">{assetCount}</p>
      </div>
    </div>
  );
}

function formatDate(dateStr) {
  return new Intl.DateTimeFormat('ar-SA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(dateStr));
}

function DepreciationBar({ purchaseCost, bookValue, salvageValue }) {
  const totalRange = purchaseCost - salvageValue;
  if (totalRange <= 0) return null;
  const depreciatedAmount = purchaseCost - bookValue;
  const depPercent = Math.min((depreciatedAmount / totalRange) * 100, 100);

  return (
    <div className="w-full bg-gray-100 rounded-full h-2 mt-1">
      <div
        className="bg-primary-500 h-2 rounded-full transition-all duration-500"
        style={{ width: `${depPercent}%` }}
      />
    </div>
  );
}

export default function DepreciationTable({ assets, onDeleteAsset }) {
  const totalPurchaseCost = assets.reduce((s, a) => s + a.purchaseCost, 0);
  const totalBookValue = assets.reduce(
    (s, a) => s + calcBookValue(a.purchaseCost, a.salvageValue, a.usefulLife, a.purchaseDate),
    0
  );

  return (
    <>
      <DepreciationSummaryCard
        totalBookValue={totalBookValue}
        totalPurchaseCost={totalPurchaseCost}
        assetCount={assets.length}
      />

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-800">سجل إهلاك الأصول</h2>
          <p className="text-xs text-gray-400 mt-0.5">طريقة القسط الثابت (Straight-Line)</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-600">
                <th className="px-4 py-3 text-right font-semibold">اسم الأصل</th>
                <th className="px-4 py-3 text-right font-semibold">تاريخ الشراء</th>
                <th className="px-4 py-3 text-right font-semibold">تكلفة الشراء</th>
                <th className="px-4 py-3 text-right font-semibold">القيمة التخريدية</th>
                <th className="px-4 py-3 text-right font-semibold">العمر الإنتاجي</th>
                <th className="px-4 py-3 text-right font-semibold">الإهلاك السنوي</th>
                <th className="px-4 py-3 text-right font-semibold">القيمة الدفترية</th>
                <th className="px-4 py-3 text-center font-semibold">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {assets.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-gray-400">
                    لا توجد أصول مسجلة بعد. أضف أصلاً جديداً للبدء.
                  </td>
                </tr>
              )}
              {assets.map((asset) => {
                const annual = calcAnnualDepreciation(asset.purchaseCost, asset.salvageValue, asset.usefulLife);
                const bookValue = calcBookValue(asset.purchaseCost, asset.salvageValue, asset.usefulLife, asset.purchaseDate);

                return (
                  <tr key={asset.id} className="border-t border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-800">{asset.assetName}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(asset.purchaseDate)}</td>
                    <td className="px-4 py-3 text-gray-700">{formatCurrency(asset.purchaseCost)}</td>
                    <td className="px-4 py-3 text-gray-500">{formatCurrency(asset.salvageValue)}</td>
                    <td className="px-4 py-3 text-gray-600">{asset.usefulLife} سنوات</td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-amber-600">{formatCurrency(annual)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-primary-700">{formatCurrency(bookValue)}</span>
                      <DepreciationBar
                        purchaseCost={asset.purchaseCost}
                        bookValue={bookValue}
                        salvageValue={asset.salvageValue}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center">
                        <button
                          onClick={() => onDeleteAsset(asset.id)}
                          className="text-gray-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                          title="حذف"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
