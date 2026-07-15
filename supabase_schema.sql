-- Create rooms table
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  password_hash TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create signaling table (ephemeral messages for WebRTC)
CREATE TABLE signaling (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  target_id TEXT,
  type TEXT NOT NULL, -- 'offer', 'answer', 'ice-candidate'
  payload JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Realtime for signaling table
ALTER PUBLICATION supabase_realtime ADD TABLE signaling;
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;

-- RLS Policies
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE signaling ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read and insert rooms
CREATE POLICY "Public all rooms" ON rooms FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public all signaling" ON signaling FOR ALL USING (true) WITH CHECK (true);
