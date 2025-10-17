import { Metadata } from 'next';
import { getUidByUsername } from '../../firebase';
import { get, ref } from 'firebase/database';
import { database } from '../../firebase';

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{
    username: string;
    slug: string[];
  }>;
}

export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const resolvedParams = await params;
  const username = decodeURIComponent(resolvedParams.username).replace('@', '');
  const stateName = resolvedParams.slug?.[0] || 'default';

  try {
    // Check if screenshot exists
    const uid = await getUidByUsername(username);
    let screenshotUrl: string | null = null;

    if (uid) {
      const screenshotPath = `worlds/${uid}/${stateName}/screenshot`;
      const screenshotRef = ref(database, screenshotPath);
      const snapshot = await get(screenshotRef);

      if (snapshot.exists()) {
        // Use API route to serve screenshot
        screenshotUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'https://nara.ws'}/api/screenshot/${username}/${stateName}`;
      }
    }

    // Generate metadata with og:image
    const title = `Nara · ${username}/${stateName}`;
    const description = `view ${stateName} on Nara — a tool for thinking, writing, and creating across boundless space.`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        images: screenshotUrl ? [{ url: screenshotUrl }] : [],
        type: 'website',
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: screenshotUrl ? [screenshotUrl] : [],
      },
    };
  } catch (error) {
    console.error('Error generating metadata:', error);
    return {
      title: `${username}/${stateName}`,
    };
  }
}

export default function UserStateLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
