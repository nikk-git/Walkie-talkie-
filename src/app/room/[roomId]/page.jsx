'use client';

import { useEffect, useState, use } from 'react';
import WalkieTalkie from '@/components/WalkieTalkie';
import { useRouter } from 'next/navigation';

export default function RoomPage({ params }) {
  const { roomId } = use(params);
  const router = useRouter();
  const [username, setUsername] = useState(null);

  useEffect(() => {
    const storedUsername = sessionStorage.getItem('wt_username');
    if (!storedUsername) {
      router.push('/');
    } else {
      setUsername(storedUsername);
    }
  }, [router]);

  if (!username) return <div style={{ padding: '2rem', textAlign: 'center' }}>Loading...</div>;

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <WalkieTalkie roomId={roomId} username={username} />
    </main>
  );
}
