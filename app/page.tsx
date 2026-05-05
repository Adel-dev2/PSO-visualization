'use client';

import dynamic from 'next/dynamic';

const PSOTSPSolver = dynamic(() => import('@/components/PSOTSPSolver'), {
  ssr: false,
  loading: () => <div className="w-full h-screen flex items-center justify-center bg-black text-white">Loading solver...</div>,
});

export default function Home() {
  return <PSOTSPSolver />;
}
