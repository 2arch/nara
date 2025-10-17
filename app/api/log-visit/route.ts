import { NextRequest, NextResponse } from 'next/server';
import { ref, push } from 'firebase/database';
import { database } from '@/app/firebase';

export async function GET(request: NextRequest) {
  try {
    const userAgent = request.headers.get('user-agent') || 'unknown';
    const referer = request.headers.get('referer') || 'unknown';
    const url = request.nextUrl.searchParams.get('url') || 'unknown';

    // Log to Firebase
    const logsRef = ref(database, 'visitor-logs');
    await push(logsRef, {
      userAgent,
      referer,
      url,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json({
      logged: true,
      userAgent,
      referer
    });
  } catch (error) {
    console.error('Error logging visit:', error);
    return NextResponse.json({ error: 'Failed to log' }, { status: 500 });
  }
}
