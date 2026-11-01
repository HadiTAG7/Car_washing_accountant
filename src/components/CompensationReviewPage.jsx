import TopBar from './TopBar';
import { useCompensationReview, callCompensationReview } from '../hooks/useCompensationReview';
import { CompensationReviewWorkspace } from './CompensationReviewWorkspace';
export default function CompensationReviewPage() {
  const read = useCompensationReview();
  return <><TopBar title="مراجعة التعويضات والاعتراضات" subtitle="دليل المصدر وقرار هادي · دون إرسال تلقائي" />
    <CompensationReviewWorkspace read={read} call={callCompensationReview} /></>;
}
