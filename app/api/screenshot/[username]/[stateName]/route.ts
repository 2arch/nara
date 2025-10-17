import { NextRequest, NextResponse } from 'next/server';
import { getUidByUsername } from '@/app/firebase';
import { get, ref } from 'firebase/database';
import { database } from '@/app/firebase';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string; stateName: string }> }
) {
  try {
    const { username, stateName } = await params;

    // Log user agent for debugging
    const userAgent = request.headers.get('user-agent') || 'unknown';
    console.log(`📸 Screenshot requested for ${username}/${stateName} by user agent:`, userAgent);

    // Get user UID from username
    const uid = await getUidByUsername(username);
    if (!uid) {
      return new NextResponse('User not found', { status: 404 });
    }

    // Fetch screenshot from database
    const screenshotPath = `worlds/${uid}/${stateName}/screenshot`;
    const screenshotRef = ref(database, screenshotPath);
    const snapshot = await get(screenshotRef);

    if (!snapshot.exists()) {
      return new NextResponse('Screenshot not found', { status: 404 });
    }

    const dataUrl = snapshot.val() as string;

    // Convert data URL to buffer
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Detect content type from data URL
    const contentType = dataUrl.match(/^data:(image\/\w+);base64,/)?.[1] || 'image/jpeg';

    // Return image with appropriate headers
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
      },
    });
  } catch (error) {
    console.error('Error serving screenshot:', error);
    return new NextResponse('Internal server error', { status: 500 });
  }
}
