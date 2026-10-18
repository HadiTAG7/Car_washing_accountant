// Deliberately synthetic; never the CEO's real reviewed report.
export function executiveFixture(overrides={}){return {schemaVersion:1,reportId:'ceo-digest-2026-10-18',revision:1,dateRiyadh:'2026-10-18',
  cutAtRiyadh:'2026-10-18T23:00:00+03:00',title:'تقرير اختبار وهمي',summary:'ملخص معزول لا يمثل بيانات التشغيل.',
  metrics:[{id:'test-count',label:'مؤشر اختباري',value:12,unit:'وحدة',coverage:'عينة وهمية فقط'}],
  visibleWarnings:[{id:'sample',severity:'limitation',text:'تغطية وهمية غير إنتاجية'}],
  decisions:[{caseId:'CASE-TEST',priority:2,ownerRole:11,status:'open_result_unverified',decision:'تجربة عرض فقط',evidenceLevel:'دليل اختباري',next:'التحقق في العزل',history:[]}],
  weekly:{status:'not_due_for_this_date',text:'الأحد لا يتضمن مراجعة أسبوعية',details:[]},
  ownerAction:{requiredAtCut:false,text:'لا قرار في بيانات الاختبار'},provenance:{sourceRef:'SYNTHETIC-TEST',reviewedByRole:0,sourceCutRiyadh:'2026-10-18T23:00:00+03:00'},
  historicalIntegrity:'لقطة اختبار ثابتة لا تتغير تلقائيًا',details:[],...overrides};}
