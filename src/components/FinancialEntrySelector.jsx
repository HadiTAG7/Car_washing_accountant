import { X, Receipt, Truck } from 'lucide-react';

const ENTRY_TYPES = [
  {
    id: 'item',
    icon: Receipt,
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    title: 'دفعة لمرة واحدة',
    titleEn: 'One-time Cost',
    description: 'مصاريف تأسيسية غير قابلة للإهلاك تُدفع مرة واحدة فقط',
    examples: 'رسوم قانونية، تراخيص، هوية بصرية',
  },
  {
    id: 'asset',
    icon: Truck,
    iconBg: 'bg-primary-50',
    iconColor: 'text-primary-700',
    title: 'أصل رأسمالي',
    titleEn: 'Depreciable Asset',
    description: 'أصل ثابت ملموس يُستهلك على مدار عمره الإنتاجي',
    examples: 'شاحنات، مولدات، غسالات ضغط عالي',
  },
];

export default function FinancialEntrySelector({ isOpen, onSelect, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50">
          <div>
            <h3 className="text-lg font-bold text-gray-800">إضافة سجل مالي</h3>
            <p className="text-xs text-gray-500 mt-0.5">اختر نوع القيد المالي الذي تريد تسجيله</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 grid grid-cols-1 gap-4">
          {ENTRY_TYPES.map((type) => {
            const Icon = type.icon;
            return (
              <button
                key={type.id}
                type="button"
                onClick={() => onSelect(type.id)}
                className="flex items-start gap-4 p-5 border-2 border-gray-100 rounded-2xl hover:border-primary-300 hover:bg-primary-50/30 transition-all text-right group"
              >
                <div className={`${type.iconBg} ${type.iconColor} w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform`}>
                  <Icon size={22} strokeWidth={2.2} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-base font-bold text-gray-800">{type.title}</span>
                    <span className="text-[11px] text-gray-400">{type.titleEn}</span>
                  </div>
                  <p className="text-sm text-gray-500 mb-1.5">{type.description}</p>
                  <p className="text-[11px] text-gray-400">
                    مثال: {type.examples}
                  </p>
                </div>
                <div className="text-gray-300 group-hover:text-primary-500 transition-colors mt-3">
                  ←
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
