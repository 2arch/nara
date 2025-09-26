import { NextRequest, NextResponse } from 'next/server';
import { database } from '@/app/firebase';
import { ref, set } from 'firebase/database';

export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'Missing userId' },
        { status: 400 }
      );
    }

    console.log('Upgrading user:', userId);
    
    // Direct Firebase call
    await set(ref(database, `users/${userId}/membership`), 'pro');
    
    console.log('User upgraded successfully');
    return NextResponse.json({ success: true, message: 'User upgraded to pro' });
    
  } catch (error) {
    console.error('Upgrade user error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}