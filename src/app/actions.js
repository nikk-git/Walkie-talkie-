'use server'

import { supabase } from '@/lib/supabase';
import bcrypt from 'bcryptjs';

export async function createRoom(name, password) {
  try {
    const password_hash = await bcrypt.hash(password, 10);
    const { data, error } = await supabase
      .from('rooms')
      .insert([{ name, password_hash }])
      .select()
      .single();
      
    if (error) throw error;
    return { success: true, room: data };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

import { validate as uuidValidate } from 'uuid';

export async function joinRoom(roomId, password) {
  try {
    if (!uuidValidate(roomId)) {
      return { success: false, error: 'Invalid Room ID. Please copy the exact Room ID from the URL.' };
    }
    
    const { data: room, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('id', roomId)
      .single();
      
    if (error) throw error;
    if (!room) return { success: false, error: 'Room not found' };
    
    const isValid = await bcrypt.compare(password, room.password_hash);
    if (!isValid) return { success: false, error: 'Invalid password' };
    
    return { success: true, room };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
