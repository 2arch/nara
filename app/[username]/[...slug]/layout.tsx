import { Metadata } from 'next';

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

  // Generate metadata with potential screenshot URL
  // The API route will return 404 if screenshot doesn't exist
  const screenshotUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'https://nara.ws'}/api/screenshot/${username}/${stateName}`;

  const title = `Nara · ${username}/${stateName}`;
  const description = `view ${stateName} on Nara — a tool for thinking, writing, and creating across boundless space.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: screenshotUrl }],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [screenshotUrl],
    },
  };
}

export default function UserStateLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
