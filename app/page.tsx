// app/page.tsx
import FullScreenAnimation from './landing/full';
import Half from './landing/half';
import Carousel from './landing/carousel';
import Footer from './landing/footer';
import DialogueHeader from './landing/dialogue-header';
import BouncingBallAnimation from './animations/main';
import InfiniteGridAnimation from './animations/infinite-grid';
import GesturesAnimation from './animations/gestures';
import CopilotAnimation from './animations/copilot';

export default function Home() {
  const carouselItems1 = [
    { id: 1, content: <p>Item 1</p> },
    { id: 2, content: <p>Item 2</p> },
    { id: 3, content: <p>Item 3 with Learn More</p> },
  ];

  const finalCarouselItems = [
    { id: 1, content: <p>Feature One</p> },
    { id: 2, content: <p>Feature Two</p> },
    { id: 3, content: <p>Final Feature</p> },
  ];

  return (
    <main className="bg-white">
      {/* Interactive Dialogue Header */}
      <DialogueHeader 
        dialogueType={{
          type: 'navigation',
          leftText: 'nara web services',
          rightButtons: {
            features: 'features',
            tryToday: 'try today'
          },
          interactive: {
            features: true,
            tryToday: true
          }
        }}
        className="fixed top-0 left-0 z-50"
      />

      <section className="pt-16">
        <FullScreenAnimation blurb="intelligence, simplified." animation={<BouncingBallAnimation />} />
      </section>

      {/* Title / Subtitle / Half + Carousel */}
      <section className="my-8" id="features">
        <div className="p-4">
          <h1 className="inline-block line-height-1" style={{ backgroundColor: 'rgba(0,0,0,1)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace' }}>features</h1>
        </div>
        <div className="px-4 pb-2">
          <h2 className="inline-block px-2 py-1" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace' }}>truly infinite</h2>
        </div>
        <Half animation={<InfiniteGridAnimation />}>
          <div className="inline-block px-2 py-1" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace' }}>
            <p>Content for the right side of the Half component.</p>
          </div>
        </Half>
        <Carousel items={carouselItems1} />
      </section>
      
      {/* Another Carousel Section */}
      <section className="my-8">
        <div className="px-4 pb-2">
          <h2 className="inline-block px-2 py-1" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace' }}>gestures</h2>
        </div>
        <Half animation={<GesturesAnimation />}>
          <div className="inline-block px-2 py-1" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace' }}>
            <p>Content for the right side of the Half component.</p>
          </div>
        </Half>
        <Carousel items={carouselItems1} />
      </section>

      {/* Another Carousel Section */}
      <section className="my-8">
        <div className="px-4 pb-2">
          <h2 className="inline-block px-2 py-1" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace' }}>co-pilot</h2>
        </div>
        <Half animation={<CopilotAnimation />}>
          <div className="inline-block px-2 py-1" style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace' }}>
            <p>Content for the right side of the Half component.</p>
          </div>
        </Half>
        <Carousel items={carouselItems1} />
      </section>

      {/* Title / Carousel */}
      <section className="my-8">
        <div className="p-4">
          <h1 className="inline-block line-height-1" style={{ backgroundColor: 'rgba(0,0,0,1)', color: '#FFFFFF', fontFamily: 'IBM Plex Mono, monospace' }}>and more...!</h1>
        </div>
        <Carousel items={finalCarouselItems} />
      </section>

      {/* Footer */}
      <Footer />
    </main>
  );
}