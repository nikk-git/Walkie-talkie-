'use client';

import { useCallback } from 'react';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useRouter } from 'next/navigation';

export default function WalkieTalkie({ roomId, username }) {
  const router = useRouter();
  const { peers, talkingUsers, isMuted, toggleMute, myId, connectionStatus } = useWebRTC(roomId, username);

  // Resume any blocked audio on user interaction (mobile autoplay policy)
  const handleInteraction = useCallback(() => {
    document.querySelectorAll('audio').forEach(el => {
      if (el.paused && el.srcObject) el.play().catch(() => {});
    });
  }, []);

  const handleLeave = () => {
    sessionStorage.removeItem('wt_username');
    router.push('/');
  };

  const isConnected = connectionStatus === 'SUBSCRIBED';
  const peerList = Object.entries(peers);

  return (
    <div
      style={{ padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2rem' }}
      onClick={handleInteraction}
      onTouchStart={handleInteraction}
    >
      {/* Header */}
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ marginBottom: '0.5rem' }}>Room {roomId}</h2>
        <p style={{ color: 'var(--text-muted)' }}>Connected as: {username}</p>
        <p style={{
          fontSize: '0.75rem',
          marginTop: '0.5rem',
          color: isConnected ? '#4ade80' : '#f87171',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.4rem'
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            backgroundColor: isConnected ? '#4ade80' : '#f87171',
            display: 'inline-block',
            animation: isConnected ? 'none' : 'pulse 1.5s infinite'
          }} />
          {connectionStatus} &bull; {myId?.slice(0, 8)}
        </p>
      </div>

      {/* Main panel */}
      <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3rem', width: '100%', maxWidth: '500px' }}>

        {/* PTT Button */}
        <div
          className={`ptt-button ${!isMuted ? 'active' : ''}`}
          onMouseDown={() => toggleMute(false)}
          onMouseUp={() => toggleMute(true)}
          onMouseLeave={() => toggleMute(true)}
          onTouchStart={(e) => { e.preventDefault(); toggleMute(false); }}
          onTouchEnd={(e) => { e.preventDefault(); toggleMute(true); }}
        >
          {!isMuted ? 'TALKING' : 'PUSH TO TALK'}
        </div>

        {/* Participants */}
        <div style={{ width: '100%' }}>
          <h3 style={{
            marginBottom: '1rem', color: 'var(--text-muted)',
            fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '1px'
          }}>
            Participants ({peerList.length + 1})
          </h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
            <div className={`user-badge ${!isMuted ? 'talking' : ''}`}>
              {username} (You)
            </div>
            {peerList.map(([peerId, peer]) => (
              <div key={peerId} className={`user-badge ${talkingUsers.has(peerId) ? 'talking' : ''}`}>
                {peer.username || 'Unknown'}
              </div>
            ))}
          </div>
        </div>
      </div>

      <button className="btn btn-danger" onClick={handleLeave}>
        Leave Room
      </button>
    </div>
  );
}
