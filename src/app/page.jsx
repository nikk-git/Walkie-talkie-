'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createRoom, joinRoom } from './actions';

export default function Home() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('join'); // 'join' or 'create'
  
  // Join State
  const [joinRoomId, setJoinRoomId] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [joinUsername, setJoinUsername] = useState('');
  
  // Create State
  const [createName, setCreateName] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createUsername, setCreateUsername] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleJoin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    const trimmedRoomId = joinRoomId.trim();
    const trimmedPassword = joinPassword.trim();
    const trimmedUsername = joinUsername.trim();
    
    if (!trimmedRoomId || !trimmedPassword || !trimmedUsername) {
      setError('Please fill in all fields');
      setLoading(false);
      return;
    }
    
    const res = await joinRoom(trimmedRoomId, trimmedPassword);
    if (res.success) {
      sessionStorage.setItem('wt_username', trimmedUsername);
      router.push(`/room/${trimmedRoomId}`);
    } else {
      setError(res.error);
    }
    setLoading(false);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    const trimmedName = createName.trim();
    const trimmedPassword = createPassword.trim();
    const trimmedUsername = createUsername.trim();
    
    if (!trimmedName || !trimmedPassword || !trimmedUsername) {
      setError('Please fill in all fields');
      setLoading(false);
      return;
    }
    
    const res = await createRoom(trimmedName, trimmedPassword);
    if (res.success) {
      sessionStorage.setItem('wt_username', trimmedUsername);
      router.push(`/room/${res.room.id}`);
    } else {
      setError(res.error);
    }
    setLoading(false);
  };

  return (
    <main style={{ padding: '2rem', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: '400px' }}>
        <h1 style={{ textAlign: 'center', marginBottom: '2rem' }}>Walkie-Talkie</h1>
        
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
          <button 
            className={`btn ${activeTab === 'join' ? 'btn-primary' : ''}`}
            style={{ flex: 1 }}
            onClick={() => { setActiveTab('join'); setError(''); }}
          >
            Join Room
          </button>
          <button 
            className={`btn ${activeTab === 'create' ? 'btn-primary' : ''}`}
            style={{ flex: 1 }}
            onClick={() => { setActiveTab('create'); setError(''); }}
          >
            Create Room
          </button>
        </div>

        {error && <div style={{ color: 'var(--danger)', marginBottom: '1rem', textAlign: 'center' }}>{error}</div>}

        {activeTab === 'join' ? (
          <form onSubmit={handleJoin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <input 
              type="text" 
              placeholder="Your Username" 
              value={joinUsername} 
              onChange={e => setJoinUsername(e.target.value)}
            />
            <input 
              type="text" 
              placeholder="Room ID" 
              value={joinRoomId} 
              onChange={e => setJoinRoomId(e.target.value)}
            />
            <input 
              type="password" 
              placeholder="Room Password" 
              value={joinPassword} 
              onChange={e => setJoinPassword(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Joining...' : 'Join Room'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
             <input 
              type="text" 
              placeholder="Your Username" 
              value={createUsername} 
              onChange={e => setCreateUsername(e.target.value)}
            />
            <input 
              type="text" 
              placeholder="Room Name" 
              value={createName} 
              onChange={e => setCreateName(e.target.value)}
            />
            <input 
              type="password" 
              placeholder="Room Password" 
              value={createPassword} 
              onChange={e => setCreatePassword(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Creating...' : 'Create Room'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
