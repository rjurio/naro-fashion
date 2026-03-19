'use client';

import { useParams } from 'next/navigation';
import SizeGuideEditor from '../editor';

export default function EditSizeGuidePage() {
  const params = useParams();
  const id = params?.id as string;
  return <SizeGuideEditor id={id} />;
}
